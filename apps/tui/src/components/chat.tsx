import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useMemo, useRef, useState } from "react";

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
	const sendLockRef = useRef(false);
	const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);

	const placeholder = useMemo(() => {
		if (isLoading) {
			return "Waiting for response...";
		}
		return "Type a message and press Enter";
	}, [isLoading]);

	useKeyboard((event) => {
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

			const placeholder = msg("assistant", "");

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

				setMessages((prev) => [...prev, placeholder]);

				for await (const event of daemon.streamJob(submitted.job.id)) {
					if (event.type === "snapshot") {
						// Replace placeholder content with the daemon's current
						// accumulated text. Sent once on subscribe so late joiners
						// catch up before live deltas start streaming.
						setMessages((prev) =>
							prev.map((m) =>
								m.id === placeholder.id ? { ...m, content: event.text } : m,
							),
						);
					} else if (event.type === "delta" && event.field === "text") {
						setMessages((prev) =>
							prev.map((m) =>
								m.id === placeholder.id
									? { ...m, content: m.content + event.delta }
									: m,
							),
						);
					} else if (event.type === "done") {
						if (event.job.sessionId && !sessionId) {
							setSessionId(event.job.sessionId);
						}

						if (event.job.state === "succeeded") {
							// Use outputText as fallback if no deltas were received
							setMessages((prev) =>
								prev.map((m) =>
									m.id === placeholder.id && !m.content.trim()
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
									m.id === placeholder.id
										? {
												...m,
												role: "system",
												content: "Job was cancelled.",
											}
										: m,
								),
							);
						} else {
							const errMsg =
								event.job.error ?? "Job failed with no error message.";
							setErrorMessage(errMsg);
							setMessages((prev) =>
								prev.map((m) =>
									m.id === placeholder.id
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
								m.id === placeholder.id
									? {
											...m,
											role: "system",
											content: `Error: ${event.error}`,
										}
									: m,
							),
						);
						break;
					}
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

	return (
		<box flexDirection="column" flexGrow={1} width="100%">
			<box flexShrink={0} height={1} width="100%">
				<text attributes={TextAttributes.DIM}>
					Ralph Chat · {instanceName}
					{sessionId ? ` · session: ${sessionId.slice(0, 8)}` : ""}
					{errorMessage ? ` · error: ${errorMessage}` : ""} · PgUp/PgDn or
					Ctrl+U/Ctrl+D scroll · esc back · ctrl+c quit
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
