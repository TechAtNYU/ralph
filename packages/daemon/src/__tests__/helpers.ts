import type { AssistantMessage, Part, Session } from "@opencode-ai/sdk/v2";

import type {
	ManagedOpencodeRuntime,
	OpencodeRuntimeManager,
} from "../opencode";
import type { FileDiff } from "../protocol";

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
	readonly diffCalls: Array<{
		instanceId: string;
		sessionId: string;
		directory: string | undefined;
	}> = [];
	readonly diffsBySession = new Map<string, FileDiff[]>();
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
							await Bun.sleep(this.delayMs);
							if (prompt.includes("fail")) {
								throw new Error(`prompt failed for ${instanceId}`);
							}
							const messageId = `message-${this.messageSequence++}`;
							return {
								info: fakeAssistantMessage({ id: messageId }),
								parts: [fakeTextPart({ text: `reply:${prompt}` })],
							};
						} finally {
							this.activeByInstance.set(instanceId, active - 1);
						}
					},
					abort: async ({ sessionID }) => {
						this.abortCalls.push({ instanceId, sessionId: sessionID });
						return undefined;
					},
					diff: async ({ sessionID, directory }) => {
						this.diffCalls.push({
							instanceId,
							sessionId: sessionID,
							directory,
						});
						return this.diffsBySession.get(sessionID) ?? [];
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
