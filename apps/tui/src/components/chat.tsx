import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { DaemonJob } from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPromptTask } from "../lib/prompt-task";
import { ralphStore } from "../lib/store";
import { DiffViewer } from "./diff-viewer";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
	id: number;
	role: Role;
	content: string;
}

let messageIdCounter = 0;
function msg(role: Role, content: string): ChatMessage {
	return { id: ++messageIdCounter, role, content };
}

/** Convert a terminal job into user + assistant/system message pair. */
function messagesFromJob(job: DaemonJob): ChatMessage[] {
	const prompt =
		job.task.type === "prompt" ? job.task.prompt : "(unknown task)";
	const userMsg = msg("user", prompt);

	if (job.state === "succeeded") {
		return [
			userMsg,
			msg("assistant", job.outputText?.trim() || "(empty response)"),
		];
	}
	if (job.state === "cancelled") {
		return [userMsg, msg("system", "Job was cancelled.")];
	}
	if (job.state === "failed") {
		return [userMsg, msg("system", `Error: ${job.error ?? "Job failed."}`)];
	}
	return [userMsg];
}

interface ChatProps {
	instanceId: string;
	instanceName: string;
	sessionId: string | null;
	onBack(): void;
	onQuit(): void;
}

export function Chat({
	instanceId,
	instanceName,
	sessionId: initialSessionId,
	onBack,
	onQuit,
}: ChatProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
	const [hydrated, setHydrated] = useState(false);
	const [tab, setTab] = useState<"chat" | "diffs">("chat");
	const sendLockRef = useRef(false);
	const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);

	const placeholder = useMemo(() => {
		if (!hydrated) return "Loading history...";
		if (isLoading) return "Waiting for response...";
		return "Type a message and press Enter";
	}, [isLoading, hydrated]);

	// Shared logic for consuming a job stream into a placeholder message.
	const consumeStream = useCallback(
		async (jobId: string, placeholderMsg: ChatMessage) => {
			for await (const event of daemon.streamJob(jobId)) {
				if (event.type === "snapshot") {
					setMessages((prev) =>
						prev.map((m) =>
							m.id === placeholderMsg.id ? { ...m, content: event.text } : m,
						),
					);
				} else if (event.type === "delta" && event.field === "text") {
					setMessages((prev) =>
						prev.map((m) =>
							m.id === placeholderMsg.id
								? { ...m, content: m.content + event.delta }
								: m,
						),
					);
				} else if (event.type === "done") {
					if (event.job.sessionId && !sessionId) {
						setSessionId(event.job.sessionId);
					}

					if (event.job.state === "succeeded") {
						setMessages((prev) =>
							prev.map((m) =>
								m.id === placeholderMsg.id && !m.content.trim()
									? {
											...m,
											content:
												event.job.outputText?.trim() || "(empty response)",
										}
									: m,
							),
						);
					} else if (event.job.state === "cancelled") {
						setMessages((prev) =>
							prev.map((m) =>
								m.id === placeholderMsg.id
									? { ...m, role: "system", content: "Job was cancelled." }
									: m,
							),
						);
					} else {
						const errMsg =
							event.job.error ?? "Job failed with no error message.";
						setErrorMessage(errMsg);
						setMessages((prev) =>
							prev.map((m) =>
								m.id === placeholderMsg.id
									? { ...m, role: "system", content: `Error: ${errMsg}` }
									: m,
							),
						);
					}
					break;
				} else if (event.type === "error") {
					setErrorMessage(event.error);
					setMessages((prev) =>
						prev.map((m) =>
							m.id === placeholderMsg.id
								? { ...m, role: "system", content: `Error: ${event.error}` }
								: m,
						),
					);
					break;
				}
			}
		},
		[sessionId],
	);

	// Hydrate chat history from daemon job state on mount.
	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				// New chat — no session yet, nothing to hydrate.
				if (!sessionId) {
					setMessages([
						msg(
							"assistant",
							`Connected to instance "${instanceName}". Send a message to start.`,
						),
					]);
					setHydrated(true);
					return;
				}

				const result = await daemon.listJobs({ instanceId, sessionId });
				if (cancelled) return;

				const sorted = result.jobs.sort(
					(a, b) =>
						new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
				);

				if (sorted.length === 0) {
					setMessages([
						msg(
							"assistant",
							`Connected to instance "${instanceName}". Send a message to start.`,
						),
					]);
					setHydrated(true);
					return;
				}

				// Render terminal jobs as history.
				const history: ChatMessage[] = [];
				let runningJob: DaemonJob | null = null;

				for (const job of sorted) {
					if (
						job.state === "succeeded" ||
						job.state === "failed" ||
						job.state === "cancelled"
					) {
						history.push(...messagesFromJob(job));
					} else if (job.state === "running" || job.state === "queued") {
						runningJob = job;
					}
				}

				setMessages(history);
				setHydrated(true);

				// Resume streaming for an in-flight job.
				if (runningJob && !cancelled) {
					const prompt =
						runningJob.task.type === "prompt"
							? runningJob.task.prompt
							: "(unknown task)";
					const userMsg = msg("user", prompt);
					const assistantPlaceholder = msg("assistant", "");

					setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
					setIsLoading(true);

					try {
						await consumeStream(runningJob.id, assistantPlaceholder);
					} finally {
						setIsLoading(false);
					}
				}
			} catch {
				if (cancelled) return;
				setMessages([
					msg(
						"assistant",
						`Connected to instance "${instanceName}". Send a message to start.`,
					),
				]);
				setHydrated(true);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [instanceId, instanceName, sessionId, consumeStream]);

	useKeyboard((event) => {
		if (event.ctrl && event.name === "r") {
			if (tab === "chat" && sessionId) {
				setTab("diffs");
			} else if (tab === "diffs") {
				setTab("chat");
			}
			return;
		}

		if (tab !== "chat") {
			return;
		}

		if (event.ctrl && event.name === "c") {
			onQuit();
		}

		if (event.name === "escape") {
			if (!isLoading) {
				onBack();
			}
		}

		if (event.name === "pageup") {
			chatScrollRef.current?.scrollBy(-1, "viewport");
		}

		if (event.name === "pagedown") {
			chatScrollRef.current?.scrollBy(1, "viewport");
		}

		if (event.ctrl && event.name === "u") {
			chatScrollRef.current?.scrollBy(-0.5, "viewport");
		}

		if (event.ctrl && event.name === "d") {
			chatScrollRef.current?.scrollBy(0.5, "viewport");
		}
	});

	const sendMessage = useCallback(
		async (rawValue: string) => {
			if (sendLockRef.current || !hydrated) {
				return;
			}

			const trimmedValue = rawValue.trim();
			if (!trimmedValue || isLoading) {
				return;
			}

			sendLockRef.current = true;
			setErrorMessage(null);
			setInputValue("");

			setMessages((prev) => [...prev, msg("user", trimmedValue)]);
			setIsLoading(true);

			const assistantPlaceholder = msg("assistant", "");

			try {
				const session:
					| { type: "new" }
					| { type: "existing"; sessionId: string } = sessionId
					? { type: "existing", sessionId }
					: { type: "new" };
				const { model: storedModel } = await ralphStore.read();

				const submitted = await daemon.submitJob({
					instanceId,
					session,
					task: createPromptTask({
						prompt: trimmedValue,
						storedModel,
					}),
				});

				setMessages((prev) => [...prev, assistantPlaceholder]);
				await consumeStream(submitted.job.id, assistantPlaceholder);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Unknown error while submitting job.";
				setErrorMessage(message);
				setMessages((prev) => [...prev, msg("system", `Error: ${message}`)]);
			} finally {
				sendLockRef.current = false;
				setIsLoading(false);
			}
		},
		[instanceId, sessionId, isLoading, hydrated, consumeStream],
	);

	if (tab === "diffs" && sessionId) {
		return (
			<DiffViewer
				instanceId={instanceId}
				sessionId={sessionId}
				onBack={() => setTab("chat")}
				onQuit={onQuit}
			/>
		);
	}

	return (
		<box flexDirection="column" flexGrow={1} width="100%">
			<box flexShrink={0} height={1} width="100%">
				<text attributes={TextAttributes.DIM}>
					Ralph Chat · {instanceName}
					{sessionId ? ` · session: ${sessionId.slice(0, 8)}` : ""}
					{errorMessage ? ` · error: ${errorMessage}` : ""} · PgUp/PgDn or
					Ctrl+U/Ctrl+D scroll{sessionId ? " · ctrl+r diffs" : ""} · esc back ·
					ctrl+c quit
				</text>
			</box>

			<scrollbox
				ref={chatScrollRef}
				flexGrow={1}
				flexShrink={1}
				minHeight={0}
				width="100%"
				border={true}
				padding={0}
				stickyScroll={true}
				stickyStart="bottom"
				marginTop={0}
				marginBottom={0}
			>
				{messages.map((message) => {
					if (message.role === "user") {
						return (
							<box key={message.id} flexDirection="row" marginBottom={1}>
								<text fg="#7dd3fc">{"> "}</text>
								<text>{message.content}</text>
							</box>
						);
					}

					if (message.role === "system") {
						return (
							<box key={message.id} flexDirection="row" marginBottom={1}>
								<text attributes={TextAttributes.DIM}>{message.content}</text>
							</box>
						);
					}

					return (
						<box key={message.id} flexDirection="column" marginBottom={1}>
							<text>{message.content}</text>
						</box>
					);
				})}
			</scrollbox>

			<box
				flexShrink={0}
				height={3}
				width="100%"
				border={true}
				borderColor="#ffffff"
			>
				<input
					focused={true}
					value={inputValue}
					placeholder={placeholder}
					onInput={setInputValue}
					onChange={setInputValue}
					onSubmit={(value) => {
						const submittedValue =
							typeof value === "string" ? value : inputValue;
						void sendMessage(submittedValue);
					}}
				/>
			</box>
		</box>
	);
}
