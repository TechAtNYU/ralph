import type {
	ManagedOpencodeRuntime,
	OpencodeRuntimeManager,
} from "../opencode-registry";

export class FakeOpencodeRegistry implements OpencodeRuntimeManager {
	private readonly runtimes = new Map<string, ManagedOpencodeRuntime>();
	private sessionSequence = 0;
	private messageSequence = 0;
	private readonly activeByInstance = new Map<string, number>();
	readonly maxConcurrentByInstance = new Map<string, number>();
	readonly promptCalls: Array<{
		instanceId: string;
		sessionId: string;
		prompt: string;
	}> = [];
	readonly abortCalls: Array<{ instanceId: string; sessionId: string }> = [];
	globalMaxConcurrent = 0;

	constructor(private readonly delayMs = 25) {}

	async ensureStarted(instanceId: string): Promise<ManagedOpencodeRuntime> {
		const existing = this.runtimes.get(instanceId);
		if (existing) {
			return existing;
		}

		const runtime: ManagedOpencodeRuntime = {
			client: {
				instance: {
					dispose: async () => undefined,
				},
				session: {
					create: async () => ({
						data: {
							id: `session-${instanceId}-${this.sessionSequence++}`,
						},
					}),
					prompt: async (parameters) => {
						const sessionId = parameters.sessionID;
						const prompt =
							parameters.parts?.find((part) => part.type === "text")?.text ??
							"";
						this.promptCalls.push({ instanceId, sessionId, prompt });

						const active = (this.activeByInstance.get(instanceId) ?? 0) + 1;
						this.activeByInstance.set(instanceId, active);
						this.maxConcurrentByInstance.set(
							instanceId,
							Math.max(
								this.maxConcurrentByInstance.get(instanceId) ?? 0,
								active,
							),
						);
						this.globalMaxConcurrent = Math.max(
							this.globalMaxConcurrent,
							[...this.activeByInstance.values()].reduce(
								(sum, count) => sum + count,
								0,
							),
						);

						try {
							await Bun.sleep(this.delayMs);
							if (prompt.includes("fail")) {
								throw new Error(`prompt failed for ${instanceId}`);
							}
							return {
								data: {
									info: {
										id: `message-${this.messageSequence++}`,
									},
									parts: [
										{
											type: "text" as const,
											text: `reply:${prompt}`,
										},
									],
								},
							};
						} finally {
							this.activeByInstance.set(instanceId, active - 1);
						}
					},
					abort: async ({ sessionID }) => {
						this.abortCalls.push({ instanceId, sessionId: sessionID });
						return undefined;
					},
				},
			},
			server: {
				url: `fake://${instanceId}`,
				close: () => undefined,
			},
		};
		this.runtimes.set(instanceId, runtime);
		return runtime;
	}

	get(instanceId: string): ManagedOpencodeRuntime | undefined {
		return this.runtimes.get(instanceId);
	}

	isRunning(instanceId: string): boolean {
		return this.runtimes.has(instanceId);
	}

	async stop(instanceId: string): Promise<void> {
		this.runtimes.delete(instanceId);
	}

	async stopAll(): Promise<void> {
		this.runtimes.clear();
	}
}
