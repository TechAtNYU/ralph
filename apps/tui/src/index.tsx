import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { OpenRouter } from "@openrouter/sdk";
import { useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

type Role = "user" | "assistant" | "system";

type ChatMessage = {
	role: Role;
	content: string;
};

const OPENROUTER_MODEL = "stepfun/step-3.5-flash:free";

const runtime = {
	isShuttingDown: false,
	abortController: null as AbortController | null
};

function shutdownApp() {
	if (runtime.isShuttingDown) {
		return;
	}

	runtime.isShuttingDown = true;
	runtime.abortController?.abort();
	process.exit(0);
}

function createOpenRouterClient(): OpenRouter {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error("Missing OPENROUTER_API_KEY environment variable.");
	}

	return new OpenRouter({ apiKey });
}

function App() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			role: "assistant",
			content: "Hello! I am connected to OpenRouter. Ask me anything."
		}
	]);
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [reasoningTokens, setReasoningTokens] = useState<number | null>(null);
	const sendLockRef = useRef(false);
	const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);

	const placeholder = useMemo(() => {
		if (isLoading) {
			return "Waiting for model response...";
		}

		return "Type a message and press Enter";
	}, [isLoading]);

	useKeyboard((event) => {
		if (event.ctrl && event.name === "c") {
			shutdownApp();
		}

		if (event.name === "escape") {
			shutdownApp();
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

	const sendMessage = async (rawValue: string) => {
		if (sendLockRef.current) {
			return;
		}

		const trimmedValue = rawValue.trim();
		if (!trimmedValue || isLoading) {
			return;
		}

		sendLockRef.current = true;

		setErrorMessage(null);
		setReasoningTokens(null);
		setInputValue("");

		const nextMessages = [...messages, { role: "user" as const, content: trimmedValue }];
		setMessages(nextMessages);
		setIsLoading(true);

		try {
			const abortController = new AbortController();
			runtime.abortController = abortController;
			setMessages((previous) => [...previous, { role: "assistant", content: "" }]);

			const openrouter = createOpenRouterClient();
			const stream = await openrouter.chat.send({
				httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? "https://github.com/TechAtNYU/ralph",
				xTitle: process.env.OPENROUTER_APP_NAME ?? "Ralph OpenTUI",
				chatGenerationParams: {
					model: OPENROUTER_MODEL,
					messages: nextMessages,
					stream: true
				}
			}, {
				signal: abortController.signal
			});

			for await (const chunk of stream) {
				if (abortController.signal.aborted || runtime.isShuttingDown) {
					break;
				}

				const content = chunk.choices[0]?.delta?.content;
				if (content) {
					setMessages((previous) => {
						const updated = [...previous];
						const assistantIndex = updated.length - 1;
						const assistantMessage = updated[assistantIndex];

						if (assistantMessage?.role === "assistant") {
							updated[assistantIndex] = {
								...assistantMessage,
								content: assistantMessage.content + content
							};
						}

						return updated;
					});
				}

				const tokens = chunk.usage?.completionTokensDetails?.reasoningTokens;
				if (typeof tokens === "number") {
					setReasoningTokens(tokens);
				}
			}
		} catch (error) {
			if (runtime.isShuttingDown) {
				return;
			}

			if (error instanceof Error && error.name === "RequestAbortedError") {
				return;
			}

			const message = error instanceof Error ? error.message : "Unknown error while calling OpenRouter.";
			setErrorMessage(message);
			setMessages((previous) => {
				if (previous.length === 0) {
					return previous;
				}

				const updated = [...previous];
				const lastMessage = updated[updated.length - 1];

				if (lastMessage?.role === "assistant" && lastMessage.content.length === 0) {
					updated.pop();
				}

				return updated;
			});
		} finally {
			sendLockRef.current = false;
			runtime.abortController = null;
			if (!runtime.isShuttingDown) {
				setIsLoading(false);
			}
		}
	};

	return (
		<box flexDirection="column" flexGrow={1} width="100%">
			<box flexShrink={0} height={1} width="100%">
				<text attributes={TextAttributes.DIM}>
					Ralph OpenRouter Chat · model: {OPENROUTER_MODEL}
					{typeof reasoningTokens === "number" ? ` · reasoning tokens: ${reasoningTokens}` : ""}
					{errorMessage ? ` · error: ${errorMessage}` : ""} · PgUp/PgDn or Ctrl+U/Ctrl+D scroll · esc / ctrl+c quit
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
				{messages.map((message, index) => {
					const label = message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System";

					return (
						<box key={`${message.role}-${index}`} flexDirection="column" marginBottom={1}>
							<text attributes={TextAttributes.BOLD}>{label}</text>
							<text>{message.content}</text>
						</box>
					);
				})}
				{isLoading ? (
					<text attributes={TextAttributes.DIM}>Assistant is thinking...</text>
				) : null}
			</scrollbox>

			<box flexShrink={0} height={3} width="100%" border={true} borderColor="#ffffff">
				<input
					focused={true}
					value={inputValue}
					placeholder={placeholder}
					onInput={setInputValue}
					onChange={setInputValue}
					onSubmit={(value) => {
						const submittedValue = typeof value === "string" ? value : inputValue;
						void sendMessage(submittedValue);
					}}
				/>
			</box>
		</box>
	);
}

const renderer = await createCliRenderer({
	onDestroy: () => {
		runtime.abortController?.abort();
		runtime.isShuttingDown = true;
		process.exit(0);
	}
});
createRoot(renderer).render(<App />);
