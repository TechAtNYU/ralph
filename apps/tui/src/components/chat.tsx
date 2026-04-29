import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { DaemonJob, QuestionInfo } from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPromptTask } from "../lib/prompt-task";
import { ralphStore } from "../lib/store";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
	id: number;
	role: Role;
	content: string;
}

interface PendingQuestion {
	requestId: string;
	questions: QuestionInfo[];
	currentIndex: number;
	selectedIndex: number;
	answers: string[][];
}

let messageIdCounter = 0;
function msg(role: Role, content: string): ChatMessage {
	return { id: ++messageIdCounter, role, content };
}

function answerSummary(questions: QuestionInfo[], answers: string[][]): string {
	return questions
		.map((question, index) => {
			const labels = answers[index] ?? [];
			return `${question.header}: ${labels.join(", ") || "(no answer)"}`;
		})
		.join("\n");
}

function initialQuestionDialog(
	requestId: string,
	questions: QuestionInfo[],
): PendingQuestion {
	return {
		requestId,
		questions,
		currentIndex: 0,
		selectedIndex: 0,
		answers: questions.map(() => []),
	};
}

function clampOptionIndex(index: number, question: QuestionInfo): number {
	if (question.options.length === 0) {
		return 0;
	}
	return Math.min(Math.max(index, 0), question.options.length - 1);
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
	const [pendingQuestion, setPendingQuestion] =
		useState<PendingQuestion | null>(null);
	const sendLockRef = useRef(false);
	const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);

	const placeholder = useMemo(() => {
		if (!hydrated) return "Loading history...";
		if (pendingQuestion) return "Answer OpenCode's question and press Enter";
		if (isLoading) return "Waiting for response...";
		return "Type a message and press Enter";
	}, [isLoading, hydrated, pendingQuestion]);

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
				} else if (event.type === "question") {
					setPendingQuestion(
						initialQuestionDialog(event.requestId, event.questions),
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

	const submitQuestionAnswers = useCallback(
		async (question: PendingQuestion, answers: string[][]) => {
			sendLockRef.current = true;
			setErrorMessage(null);
			setPendingQuestion(null);
			try {
				await daemon.replyToQuestion({
					instanceId,
					requestId: question.requestId,
					answers,
				});
				setMessages((prev) => [
					...prev,
					msg("user", answerSummary(question.questions, answers)),
				]);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Unknown error while answering question.";
				setErrorMessage(message);
				setPendingQuestion(question);
				setMessages((prev) => [...prev, msg("system", `Error: ${message}`)]);
			} finally {
				sendLockRef.current = false;
			}
		},
		[instanceId],
	);

	useKeyboard((event) => {
		if (event.ctrl && event.name === "c") {
			onQuit();
		}

		if (pendingQuestion) {
			const currentQuestion =
				pendingQuestion.questions[pendingQuestion.currentIndex];
			if (!currentQuestion) {
				return;
			}

			if (event.name === "up" || event.name === "k") {
				setPendingQuestion((prev) =>
					prev
						? {
								...prev,
								selectedIndex: clampOptionIndex(
									prev.selectedIndex - 1,
									currentQuestion,
								),
							}
						: prev,
				);
				return;
			}

			if (event.name === "down" || event.name === "j") {
				setPendingQuestion((prev) =>
					prev
						? {
								...prev,
								selectedIndex: clampOptionIndex(
									prev.selectedIndex + 1,
									currentQuestion,
								),
							}
						: prev,
				);
				return;
			}

			if (event.name === "space" && currentQuestion.multiple) {
				const option = currentQuestion.options[pendingQuestion.selectedIndex];
				if (!option) {
					return;
				}
				setPendingQuestion((prev) => {
					if (!prev) return prev;
					const answers = prev.answers.map((answer) => [...answer]);
					const selected = answers[prev.currentIndex] ?? [];
					answers[prev.currentIndex] = selected.includes(option.label)
						? selected.filter((label) => label !== option.label)
						: [...selected, option.label];
					return { ...prev, answers };
				});
				return;
			}

			if (event.name === "return") {
				const option = currentQuestion.options[pendingQuestion.selectedIndex];
				const answers = pendingQuestion.answers.map((answer) => [...answer]);
				if (!currentQuestion.multiple && option) {
					answers[pendingQuestion.currentIndex] = [option.label];
				}
				if (
					currentQuestion.multiple &&
					(answers[pendingQuestion.currentIndex]?.length ?? 0) === 0
				) {
					return;
				}

				const nextIndex = pendingQuestion.currentIndex + 1;
				if (nextIndex < pendingQuestion.questions.length) {
					setPendingQuestion({
						...pendingQuestion,
						answers,
						currentIndex: nextIndex,
						selectedIndex: 0,
					});
				} else {
					void submitQuestionAnswers(pendingQuestion, answers);
				}
				return;
			}

			return;
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
			if (sendLockRef.current || pendingQuestion || !hydrated) {
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
		[
			instanceId,
			sessionId,
			isLoading,
			hydrated,
			pendingQuestion,
			consumeStream,
		],
	);

	const activeQuestion = pendingQuestion
		? pendingQuestion.questions[pendingQuestion.currentIndex]
		: undefined;
	const activeAnswers =
		pendingQuestion?.answers[pendingQuestion.currentIndex] ?? [];

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

			{pendingQuestion && activeQuestion ? (
				<box
					position="absolute"
					top="20%"
					left="15%"
					width="70%"
					flexDirection="column"
					border={true}
					borderStyle="double"
					borderColor="#facc15"
					padding={1}
					backgroundColor="#111827"
				>
					<text attributes={TextAttributes.BOLD}>
						{`Question ${pendingQuestion.currentIndex + 1}/${pendingQuestion.questions.length}: ${activeQuestion.header}`}
					</text>
					<text>{activeQuestion.question}</text>
					{activeQuestion.options.map((option, index) => {
						const focused = index === pendingQuestion.selectedIndex;
						const selected = activeAnswers.includes(option.label);
						const marker = activeQuestion.multiple
							? selected
								? "[x]"
								: "[ ]"
							: focused
								? "(*)"
								: "( )";
						return (
							<text
								key={option.label}
								attributes={focused ? TextAttributes.BOLD : TextAttributes.DIM}
							>
								{`${focused ? ">" : " "} ${marker} ${option.label} - ${option.description}`}
							</text>
						);
					})}
					<text attributes={TextAttributes.DIM}>
						{activeQuestion.multiple
							? "j/k: move  space: toggle  enter: submit"
							: "j/k: move  enter: select"}
					</text>
				</box>
			) : null}

			<box
				flexShrink={0}
				height={3}
				width="100%"
				border={true}
				borderColor={pendingQuestion ? "#666666" : "#ffffff"}
			>
				<input
					focused={!pendingQuestion}
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
