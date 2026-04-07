import type { AssistantMessage, Part, Session } from "@opencode-ai/sdk/v2";

import type {
	ManagedOpencodeRuntime,
	OpencodeRuntimeEvent,
	OpencodeRuntimeManager,
} from "../opencode";

function fakeSession(overrides: Partial<Session> & { id: string }): Session {
	return {
		slug: overrides.id,
		projectID: "fake-project",
		directory: "/fake",
		title: "fake",
		version: "1",
		time: { created: Date.now(), updated: Date.now() },
		...overrides,
	};
}

function fakeAssistantMessage(
	overrides: Partial<AssistantMessage> & { id: string },
): AssistantMessage {
	return {
		sessionID: "fake-session",
		role: "assistant",
		time: { created: Date.now() },
		parentID: "fake-parent",
		modelID: "fake-model",
		providerID: "fake-provider",
		mode: "default",
		agent: "default",
		path: { cwd: "/fake", root: "/fake" },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		...overrides,
	};
}

function fakeTextPart(
	overrides: { text: string } & Partial<Extract<Part, { type: "text" }>>,
): Extract<Part, { type: "text" }> {
	return {
		id: "fake-part",
		sessionID: "fake-session",
		messageID: "fake-message",
		type: "text",
		...overrides,
	};
}

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
	/** Configurable per-test: an array of text deltas the fake will emit
	 * via the wired onEvent handler before returning the final response
	 * from prompt(). */
	streamingDeltas: string[] = [];
	/** Delay between successive emitted deltas. */
	deltaIntervalMs = 5;
	private onEvent?: (instanceId: string, event: OpencodeRuntimeEvent) => void;

	constructor(private readonly delayMs = 25) {}

	setOnEvent(
		handler: (instanceId: string, event: OpencodeRuntimeEvent) => void,
	): void {
		this.onEvent = handler;
	}

	/** Manually emit an event as if it came from a managed runtime. Used
	 * by tests that want fine-grained control over timing. */
	emitEvent(instanceId: string, event: OpencodeRuntimeEvent): void {
		this.onEvent?.(instanceId, event);
	}

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
					create: async () => {
						const id = `session-${instanceId}-${this.sessionSequence++}`;
						return fakeSession({ id });
					},
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
							const messageId = `message-${this.messageSequence++}`;

							// Emit configured streaming deltas via the wired event
							// handler. Each one routes to routeDeltaToJob in the
							// daemon, accumulating into job.outputText and
							// dispatching to subscribers.
							if (this.streamingDeltas.length > 0) {
								for (const delta of this.streamingDeltas) {
									await Bun.sleep(this.deltaIntervalMs);
									this.onEvent?.(instanceId, {
										type: "message.part.delta",
										properties: {
											sessionID: sessionId,
											messageID: messageId,
											partID: `part-${messageId}`,
											field: "text",
											delta,
										},
									});
								}
							} else {
								await Bun.sleep(this.delayMs);
							}

							if (prompt.includes("fail")) {
								throw new Error(`prompt failed for ${instanceId}`);
							}
							const finalText =
								this.streamingDeltas.length > 0
									? this.streamingDeltas.join("")
									: `reply:${prompt}`;
							return {
								info: fakeAssistantMessage({ id: messageId }),
								parts: [fakeTextPart({ text: finalText })],
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
