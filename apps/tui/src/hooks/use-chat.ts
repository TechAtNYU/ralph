import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useRef, useState } from "react";
import { CREATE_PRD_SYSTEM_PROMPT, CREATE_SPEC_SYSTEM_PROMPT } from "../skills";

export type ChatMode = "create-spec" | "create-prd";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

interface UseChatReturn {
	messages: ChatMessage[];
	loading: boolean;
	error: string | undefined;
	send: (prompt: string, mode: ChatMode) => Promise<void>;
}

const SKILL_PROMPTS: Record<ChatMode, string> = {
	"create-spec": CREATE_SPEC_SYSTEM_PROMPT,
	"create-prd": CREATE_PRD_SYSTEM_PROMPT,
};

export function useChat(ensureInstance: () => Promise<string>): UseChatReturn {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const sessionIdRef = useRef<string | null>(null);
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const stopPolling = useCallback(() => {
		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => stopPolling();
	}, [stopPolling]);

	const send = useCallback(
		async (prompt: string, mode: ChatMode) => {
			if (loading) return;

			setMessages((prev) => [...prev, { role: "user", content: prompt }]);
			setLoading(true);
			setError(undefined);

			try {
				const instanceId = await ensureInstance();

				const session = sessionIdRef.current
					? { type: "existing" as const, sessionId: sessionIdRef.current }
					: { type: "new" as const, title: `Plan: ${mode}` };

				const { job } = await daemon.submitJob({
					instanceId,
					session,
					task: {
						type: "prompt",
						prompt,
						system: SKILL_PROMPTS[mode],
					},
				});

				pollingRef.current = setInterval(async () => {
					try {
						const { job: updated } = await daemon.getJob(job.id);

						if (updated.state === "succeeded") {
							stopPolling();
							if (updated.sessionId) {
								sessionIdRef.current = updated.sessionId;
							}
							setMessages((prev) => [
								...prev,
								{
									role: "assistant",
									content: updated.outputText ?? "(no response)",
								},
							]);
							setLoading(false);
						} else if (
							updated.state === "failed" ||
							updated.state === "cancelled"
						) {
							stopPolling();
							setError(updated.error ?? "Job failed");
							setLoading(false);
						}
					} catch (pollError) {
						stopPolling();
						setError(
							pollError instanceof Error ? pollError.message : "Polling failed",
						);
						setLoading(false);
					}
				}, 1000);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to submit message");
				setLoading(false);
			}
		},
		[loading, ensureInstance, stopPolling],
	);

	return { messages, loading, error, send };
}
