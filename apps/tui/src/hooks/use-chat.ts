import { type DaemonJob, daemon, type PermissionRule } from "@techatnyu/ralphd";
import { useCallback, useRef, useState } from "react";
import { createPromptTask } from "../lib/prompt-task";
import { ralphStore } from "../lib/store";

export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface SendOptions {
	prompt: string;
	systemPrompt: string;
	permission?: PermissionRule[];
	displayAssistant?: boolean;
	displayUser?: boolean;
}

export interface SendResult {
	content: string;
	job?: DaemonJob;
}

interface UseChatReturn {
	messages: ChatMessage[];
	loading: boolean;
	error: string | undefined;
	send: (options: SendOptions) => Promise<SendResult | undefined>;
	addSystemMessage: (content: string) => void;
	resetSession: () => void;
	clear: () => void;
}

export function useChat(ensureInstance: () => Promise<string>): UseChatReturn {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const sessionIdRef = useRef<string | null>(null);
	const cancelledRef = useRef(false);

	const addSystemMessage = useCallback((content: string) => {
		setMessages((prev) => [...prev, { role: "system", content }]);
	}, []);

	const resetSession = useCallback(() => {
		sessionIdRef.current = null;
	}, []);

	const updateLastMessage = useCallback(
		(updater: (msg: ChatMessage) => ChatMessage) => {
			setMessages((prev) => {
				const next = [...prev];
				const last = next[next.length - 1];
				if (last) next[next.length - 1] = updater(last);
				return next;
			});
		},
		[],
	);

	const send = useCallback(
		async ({
			prompt,
			systemPrompt,
			permission,
			displayAssistant = true,
			displayUser = true,
		}: SendOptions) => {
			if (loading) return undefined;

			if (displayUser) {
				setMessages((prev) => [...prev, { role: "user", content: prompt }]);
			}
			setLoading(true);
			setError(undefined);
			cancelledRef.current = false;

			try {
				const instanceId = await ensureInstance();

				const session = sessionIdRef.current
					? { type: "existing" as const, sessionId: sessionIdRef.current }
					: { type: "new" as const, title: "Plan", permission };

				const { model: storedModel } = await ralphStore.read();
				const { events } = await daemon.submitAndStreamJob({
					instanceId,
					session,
					task: {
						...createPromptTask({ prompt, storedModel }),
						system: systemPrompt,
					},
				});

				if (displayAssistant) {
					setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
				}
				let content = "";

				for await (const event of events) {
					if (cancelledRef.current) break;

					if (event.type === "snapshot") {
						content = event.text;
						if (displayAssistant) {
							updateLastMessage(() => ({ role: "assistant", content }));
						}
					} else if (event.type === "delta" && event.field === "text") {
						content += event.delta;
						if (displayAssistant) {
							updateLastMessage(() => ({ role: "assistant", content }));
						}
					} else if (event.type === "done") {
						if (event.job.sessionId) {
							sessionIdRef.current = event.job.sessionId;
						}
						if (event.job.state === "failed") {
							const message = event.job.error || "Job failed";
							setError(message);
							if (displayAssistant) {
								updateLastMessage(() => ({
									role: "system",
									content: `Error: ${message}`,
								}));
							}
							return undefined;
						}
						if (event.job.state !== "succeeded") {
							return undefined;
						}
						let final = content.trim();
						if (!content.trim()) {
							final = event.job.outputText?.trim() || "";
							if (displayAssistant) {
								updateLastMessage(() => ({
									role: "assistant",
									content: final || "(empty response)",
								}));
							}
						}
						return { content: final, job: event.job };
					} else if (event.type === "error") {
						setError(event.error);
						if (displayAssistant) {
							updateLastMessage(() => ({
								role: "system",
								content: `Error: ${event.error}`,
							}));
						}
						return undefined;
					}
				}
				return undefined;
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to submit message");
				return undefined;
			} finally {
				setLoading(false);
			}
		},
		[loading, ensureInstance, updateLastMessage],
	);

	const clear = useCallback(() => {
		cancelledRef.current = true;
		setMessages([]);
		sessionIdRef.current = null;
		setError(undefined);
	}, []);

	return {
		messages,
		loading,
		error,
		send,
		addSystemMessage,
		resetSession,
		clear,
	};
}
