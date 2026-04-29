import {
	type AssistantMessage,
	createOpencode,
	type Event as OpencodeEvent,
	type Part,
	type Session,
	type TextPartInput,
} from "@opencode-ai/sdk/v2";

export interface OpencodeSessionClient {
	create(parameters: { directory?: string; title?: string }): Promise<Session>;
	prompt(parameters: {
		sessionID: string;
		directory?: string;
		agent?: string;
		model?: {
			providerID: string;
			modelID: string;
		};
		system?: string;
		variant?: string;
		parts?: Array<TextPartInput>;
	}): Promise<{ info: AssistantMessage; parts: Part[] }>;
	abort(parameters: {
		sessionID: string;
		directory?: string;
	}): Promise<unknown>;
}

export interface ProviderModel {
	id: string;
	name: string;
	family?: string;
	attachment?: boolean;
	reasoning?: boolean;
	tool_call?: boolean;
}

export interface Provider {
	id: string;
	name: string;
	models: Record<string, ProviderModel>;
}

export interface ProviderListResult {
	providers: Provider[];
	connected: string[];
}

export interface OpencodeRuntimeClient {
	session: OpencodeSessionClient;
	question: {
		reply(parameters: {
			requestID: string;
			directory?: string;
			answers: Array<Array<string>>;
		}): Promise<unknown>;
	};
	instance: {
		dispose(parameters?: { directory?: string }): Promise<unknown>;
	};
	provider: {
		list(parameters?: { directory?: string }): Promise<ProviderListResult>;
	};
	ping(): Promise<boolean>;
}

export interface ManagedOpencodeRuntime {
	client: OpencodeRuntimeClient;
	server: {
		url: string;
		close(): void;
	};
}

export type OpencodeRuntimeEvent = OpencodeEvent;

export interface OpencodeRuntimeManager {
	ensureStarted(
		instanceId: string,
		directory: string,
	): Promise<ManagedOpencodeRuntime>;
	get(instanceId: string): ManagedOpencodeRuntime | undefined;
	isRunning(instanceId: string): boolean;
	stop(instanceId: string): Promise<void>;
	stopAll(): Promise<void>;
	/** Register the handler that receives every event surfaced by the shared
	 * runtime. Called by the Daemon during construction so that wiring is
	 * uniform regardless of whether the registry was injected or default. */
	setOnEvent(
		handler: (instanceId: string, event: OpencodeRuntimeEvent) => void,
	): void;
	queryProviders(
		directories: string[],
		directory?: string,
		refresh?: boolean,
	): Promise<ProviderListResult>;
}

interface SharedRuntime extends ManagedOpencodeRuntime {
	rawEventSubscribe(parameters: {
		directory: string;
	}): Promise<{ stream: AsyncIterable<OpencodeRuntimeEvent> }>;
}

interface InstanceSubscription {
	directory: string;
	cancel(): void;
}

export class OpencodeRegistry implements OpencodeRuntimeManager {
	private shared?: SharedRuntime;
	private sharedStarting?: Promise<SharedRuntime>;
	private readonly subscriptions = new Map<string, InstanceSubscription>();
	private onEvent?: (instanceId: string, event: OpencodeRuntimeEvent) => void;

	setOnEvent(
		handler: (instanceId: string, event: OpencodeRuntimeEvent) => void,
	): void {
		this.onEvent = handler;
	}

	async ensureStarted(
		instanceId: string,
		directory: string,
	): Promise<ManagedOpencodeRuntime> {
		const runtime = await this.ensureSharedRuntime();

		const existing = this.subscriptions.get(instanceId);
		if (!existing) {
			const events = await runtime.rawEventSubscribe({ directory });
			const subscription = this.consumeEvents(instanceId, events);
			this.subscriptions.set(instanceId, {
				directory,
				cancel: subscription.cancel,
			});
		}

		return runtime;
	}

	private async ensureSharedRuntime(): Promise<SharedRuntime> {
		if (this.shared) {
			return this.shared;
		}
		if (this.sharedStarting) {
			return this.sharedStarting;
		}

		const starting = createOpencode({ port: 0 }).then(({ client, server }) => {
			const runtime: SharedRuntime = {
				client: {
					instance: {
						dispose: (parameters) => client.instance.dispose(parameters),
					},
					session: {
						create: async (parameters) => {
							const res = await client.session.create(parameters, {
								throwOnError: true,
								responseStyle: "data",
							});
							return res as unknown as Session;
						},
						prompt: async (parameters) => {
							const res = await client.session.prompt(parameters, {
								throwOnError: true,
								responseStyle: "data",
							});
							return res as unknown as {
								info: AssistantMessage;
								parts: Part[];
							};
						},
						abort: (parameters) =>
							client.session.abort(parameters, {
								throwOnError: true,
							}),
					},
					question: {
						reply: (parameters) =>
							client.question.reply(parameters, {
								throwOnError: true,
							}),
					},
					provider: {
						list: async (parameters) => {
							const response = await client.provider.list(parameters, {
								throwOnError: true,
							});
							return {
								providers: response.data.all.map((p) => ({
									id: p.id,
									name: p.name,
									models: Object.fromEntries(
										Object.entries(p.models).map(([k, m]) => [
											k,
											{
												id: m.id,
												name: m.name,
												family: m.family,
												attachment: m.attachment,
												reasoning: m.reasoning,
												tool_call: m.tool_call,
											},
										]),
									),
								})),
								connected: response.data.connected,
							};
						},
					},
					async ping() {
						try {
							await client.path.get({}, { throwOnError: true });
							return true;
						} catch {
							return false;
						}
					},
				},
				server,
				rawEventSubscribe: async (parameters) => {
					return client.event.subscribe(parameters);
				},
			};
			this.shared = runtime;
			return runtime;
		});

		this.sharedStarting = starting;
		try {
			return await starting;
		} finally {
			this.sharedStarting = undefined;
		}
	}

	private consumeEvents(
		instanceId: string,
		events: { stream: AsyncIterable<OpencodeRuntimeEvent> },
	): { cancel(): void } {
		let stopped = false;

		(async () => {
			try {
				for await (const event of events.stream) {
					if (stopped) break;
					this.onEvent?.(instanceId, event);
				}
			} catch {
				// Event stream ended or errored — nothing to do.
			}
		})();

		return {
			cancel: () => {
				stopped = true;
			},
		};
	}

	get(instanceId: string): ManagedOpencodeRuntime | undefined {
		return this.subscriptions.has(instanceId) ? this.shared : undefined;
	}

	isRunning(instanceId: string): boolean {
		return this.subscriptions.has(instanceId);
	}

	async stop(instanceId: string): Promise<void> {
		const subscription = this.subscriptions.get(instanceId);
		if (!subscription) {
			return;
		}
		subscription.cancel();
		this.subscriptions.delete(instanceId);
	}

	async stopAll(): Promise<void> {
		for (const subscription of this.subscriptions.values()) {
			subscription.cancel();
		}
		this.subscriptions.clear();

		const runtime = this.shared;
		this.shared = undefined;
		if (runtime) {
			try {
				runtime.server.close();
			} catch {
				// best-effort shutdown
			}
		}
	}

	async queryProviders(
		directories: string[],
		directory?: string,
		refresh?: boolean,
	): Promise<ProviderListResult> {
		const runtime = await this.ensureSharedRuntime();
		if (refresh) {
			await Promise.allSettled(
				directories.map((dir) =>
					runtime.client.instance.dispose({ directory: dir }),
				),
			);
		}
		return runtime.client.provider.list({ directory });
	}
}
