import {
	type AssistantMessage,
	createOpencode,
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

export interface OpencodeRuntimeClient {
	session: OpencodeSessionClient;
	instance: {
		dispose(): Promise<unknown>;
	};
}

export interface ManagedOpencodeRuntime {
	client: OpencodeRuntimeClient;
	server: {
		url: string;
		close(): void;
	};
}

export interface OpencodeRuntimeEvent {
	type: string;
	properties: Record<string, unknown>;
}

export interface OpencodeRuntimeManager {
	ensureStarted(instanceId: string): Promise<ManagedOpencodeRuntime>;
	get(instanceId: string): ManagedOpencodeRuntime | undefined;
	isRunning(instanceId: string): boolean;
	stop(instanceId: string): Promise<void>;
	stopAll(): Promise<void>;
	/** Register the handler that receives every event surfaced by managed
	 * runtimes. Called by the Daemon during construction so that wiring is
	 * uniform regardless of whether the registry was injected or default. */
	setOnEvent(
		handler: (instanceId: string, event: OpencodeRuntimeEvent) => void,
	): void;
}

interface RuntimeEntry {
	runtime?: ManagedOpencodeRuntime;
	starting?: Promise<ManagedOpencodeRuntime>;
}

export class OpencodeRegistry implements OpencodeRuntimeManager {
	private readonly runtimes = new Map<string, RuntimeEntry>();
	private readonly eventSubscriptions = new Map<string, { cancel(): void }>();
	private onEvent?: (instanceId: string, event: OpencodeRuntimeEvent) => void;

	setOnEvent(
		handler: (instanceId: string, event: OpencodeRuntimeEvent) => void,
	): void {
		this.onEvent = handler;
	}

	async ensureStarted(instanceId: string): Promise<ManagedOpencodeRuntime> {
		const entry = this.runtimes.get(instanceId);
		if (entry?.runtime) {
			return entry.runtime;
		}

		if (entry?.starting) {
			return entry.starting;
		}

		const starting = createOpencode().then(async ({ client, server }) => {
			const events = await client.event.subscribe();
			const subscription = this.consumeEvents(instanceId, events);
			this.eventSubscriptions.set(instanceId, subscription);

			const runtime: ManagedOpencodeRuntime = {
				client: {
					instance: {
						dispose: () => client.instance.dispose(),
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
				},
				server,
			};
			this.runtimes.set(instanceId, { runtime });
			return runtime;
		});

		this.runtimes.set(instanceId, { starting });
		try {
			return await starting;
		} catch (error) {
			this.runtimes.delete(instanceId);
			throw error;
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
		return this.runtimes.get(instanceId)?.runtime;
	}

	isRunning(instanceId: string): boolean {
		return this.runtimes.has(instanceId) && Boolean(this.get(instanceId));
	}

	async stop(instanceId: string): Promise<void> {
		this.eventSubscriptions.get(instanceId)?.cancel();
		this.eventSubscriptions.delete(instanceId);

		const entry = this.runtimes.get(instanceId);
		if (!entry) {
			return;
		}

		try {
			const runtime =
				entry.runtime ?? (entry.starting ? await entry.starting : undefined);
			await runtime?.client.instance.dispose();
			runtime?.server.close();
		} finally {
			this.runtimes.delete(instanceId);
		}
	}

	async stopAll(): Promise<void> {
		await Promise.allSettled(
			[...this.runtimes.keys()].map((instanceId) => this.stop(instanceId)),
		);
	}
}
