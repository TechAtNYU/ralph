import {
	type AssistantMessage,
	createOpencode,
	type Part,
	type Session,
	type TextPartInput,
} from "@opencode-ai/sdk/v2";

import type { FileDiff } from "./protocol";

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
	diff(parameters: {
		sessionID: string;
		directory?: string;
	}): Promise<FileDiff[]>;
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

export interface OpencodeRuntimeManager {
	ensureStarted(instanceId: string): Promise<ManagedOpencodeRuntime>;
	get(instanceId: string): ManagedOpencodeRuntime | undefined;
	isRunning(instanceId: string): boolean;
	stop(instanceId: string): Promise<void>;
	stopAll(): Promise<void>;
}

interface RuntimeEntry {
	runtime?: ManagedOpencodeRuntime;
	starting?: Promise<ManagedOpencodeRuntime>;
}

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

		const starting = createOpencode().then(async ({ client, server }) => {
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
						diff: async (parameters) => {
							const res = await client.session.diff(parameters, {
								throwOnError: true,
								responseStyle: "data",
							});
							return res as unknown as FileDiff[];
						},
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
}
