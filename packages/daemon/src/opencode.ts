import {
	type AssistantMessage,
	createOpencode,
	type Part,
	type Session,
	type TextPartInput,
} from "@opencode-ai/sdk/v2";

export interface OpencodeSessionClient {
	create(parameters: {
		directory?: string;
		title?: string;
	}): Promise<{ data: Session }>;
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
	}): Promise<{ data: { info: AssistantMessage; parts: Part[] } }>;
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
	instance: {
		dispose(): Promise<unknown>;
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

export interface OpencodeRuntimeManager {
	ensureStarted(instanceId: string): Promise<ManagedOpencodeRuntime>;
	get(instanceId: string): ManagedOpencodeRuntime | undefined;
	isRunning(instanceId: string): boolean;
	stop(instanceId: string): Promise<void>;
	stopAll(): Promise<void>;
	queryProviders(directory?: string): Promise<ProviderListResult>;
}

interface RuntimeEntry {
	runtime?: ManagedOpencodeRuntime;
	starting?: Promise<ManagedOpencodeRuntime>;
}

const SYSTEM_INSTANCE_ID = "__system__";

export class OpencodeRegistry implements OpencodeRuntimeManager {
	private readonly runtimes = new Map<string, RuntimeEntry>();

	async ensureStarted(instanceId: string): Promise<ManagedOpencodeRuntime> {
		const entry = this.runtimes.get(instanceId);
		if (entry?.runtime) {
			return entry.runtime;
		}

		if (entry?.starting) {
			return entry.starting;
		}

		const starting = createOpencode().then(({ client, server }) => {
			const runtime: ManagedOpencodeRuntime = {
				client: {
					instance: {
						dispose: () => client.instance.dispose(),
					},
					session: {
						create: async (parameters) => {
							return await client.session.create(parameters, {
								throwOnError: true,
								responseStyle: "data",
							});
						},
						prompt: async (parameters) => {
							return await client.session.prompt(parameters, {
								throwOnError: true,
								responseStyle: "data",
							});
						},
						abort: (parameters) =>
							client.session.abort(parameters, {
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

	get(instanceId: string): ManagedOpencodeRuntime | undefined {
		return this.runtimes.get(instanceId)?.runtime;
	}

	isRunning(instanceId: string): boolean {
		return this.runtimes.has(instanceId) && Boolean(this.get(instanceId));
	}

	async stop(instanceId: string): Promise<void> {
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

	/**
	 * Get or create a long-lived system runtime for provider queries and other
	 * lightweight operations that don't belong to a user-created instance.
	 */
	private ensureSystemRuntime(): Promise<ManagedOpencodeRuntime> {
		return this.ensureStarted(SYSTEM_INSTANCE_ID);
	}

	private async healthCheck(runtime: ManagedOpencodeRuntime): Promise<boolean> {
		return runtime.client.ping();
	}

	async queryProviders(directory?: string): Promise<ProviderListResult> {
		// Prefer an existing user runtime if one is available
		for (const [id, entry] of this.runtimes.entries()) {
			if (id !== SYSTEM_INSTANCE_ID && entry.runtime) {
				try {
					return await entry.runtime.client.provider.list({ directory });
				} catch {}
			}
		}

		// Fall back to the long-lived system runtime
		let runtime = await this.ensureSystemRuntime();

		// Health check — restart if the system instance died
		if (!(await this.healthCheck(runtime))) {
			this.runtimes.delete(SYSTEM_INSTANCE_ID);
			runtime = await this.ensureSystemRuntime();
		}

		return runtime.client.provider.list({ directory });
	}
}
