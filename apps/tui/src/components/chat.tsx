import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { DaemonJob } from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useMemo, useRef, useState } from "react";
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

interface ChatProps {
	instanceId: string;
	instanceName: string;
	onBack(): void;
	onQuit(): void;
}

const JOB_POLL_INTERVAL_MS = 500;

async function waitForJob(jobId: string): Promise<DaemonJob> {
	// biome-ignore lint/correctness/noConstantCondition: polling loop
	while (true) {
		const result = await daemon.getJob(jobId);
		if (
			result.job.state === "succeeded" ||
			result.job.state === "failed" ||
			result.job.state === "cancelled"
		) {
			return result.job;
		}
		await Bun.sleep(JOB_POLL_INTERVAL_MS);
	}
}

export function Chat({ instanceId, instanceName, onBack, onQuit }: ChatProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([
		msg(
			"assistant",
			`Connected to instance "${instanceName}". Send a message to start.`,
		),
	]);
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [tab, setTab] = useState<"chat" | "diffs">("chat");
	const sendLockRef = useRef(false);
	const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);

	const placeholder = useMemo(() => {
		if (isLoading) {
			return "Waiting for response...";
		}
		return "Type a message and press Enter";
	}, [isLoading]);

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
			if (sendLockRef.current) {
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

			try {
				const session:
					| { type: "new" }
					| { type: "existing"; sessionId: string } = sessionId
					? { type: "existing", sessionId }
					: { type: "new" };

				const submitted = await daemon.submitJob({
					instanceId,
					session,
					task: {
						type: "prompt",
						prompt: trimmedValue,
					},
				});

				const finished = await waitForJob(submitted.job.id);

				// Track the session for follow-up messages
				if (finished.sessionId && !sessionId) {
					setSessionId(finished.sessionId);
				}

				if (finished.state === "succeeded") {
					const output = finished.outputText?.trim() || "(empty response)";
					setMessages((prev) => [...prev, msg("assistant", output)]);
				} else if (finished.state === "cancelled") {
					setMessages((prev) => [...prev, msg("system", "Job was cancelled.")]);
				} else {
					const errMsg = finished.error ?? "Job failed with no error message.";
					setErrorMessage(errMsg);
					setMessages((prev) => [...prev, msg("system", `Error: ${errMsg}`)]);
				}
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
		[instanceId, sessionId, isLoading],
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
					const label =
						message.role === "user"
							? "You"
							: message.role === "assistant"
								? "Assistant"
								: "System";

					return (
						<box key={message.id} flexDirection="column" marginBottom={1}>
							<text attributes={TextAttributes.BOLD}>{label}</text>
							<text>{message.content}</text>
						</box>
					);
				})}
				{isLoading ? (
					<text attributes={TextAttributes.DIM}>Assistant is thinking...</text>
				) : null}
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
