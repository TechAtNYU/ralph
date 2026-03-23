import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import type { ChatMessage, ChatMode } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";

interface PlanChatProps {
	focused: boolean;
	messages: ChatMessage[];
	loading: boolean;
	error: string | undefined;
	planData: PlanFilesData;
	onSend: (prompt: string, mode: ChatMode) => Promise<void>;
}

function getHint(planData: PlanFilesData): string {
	if (!planData.hasSpec) {
		return "No spec found — try Create Spec mode to define your project";
	}
	if (!planData.hasPrd) {
		return "Spec ready — try Create PRD mode to break it into tasks";
	}
	return "Plan ready — switch to Execute to start";
}

const MODES: ChatMode[] = ["create-spec", "create-prd"];
const MODE_LABELS: Record<ChatMode, string> = {
	"create-spec": "Create Spec",
	"create-prd": "Create PRD",
};

export function PlanChat({
	focused,
	messages,
	loading,
	error,
	planData,
	onSend,
}: PlanChatProps) {
	const [inputValue, setInputValue] = useState("");
	const [modeIndex, setModeIndex] = useState(0);
	const mode: ChatMode = MODES[modeIndex] ?? "create-spec";
	const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "m" && !loading) {
			setModeIndex((i) => (i + 1) % MODES.length);
		}
	});

	const handleSubmit = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || loading) return;
		setInputValue("");
		void onSend(trimmed, mode);
	};

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" marginBottom={1}>
				<text attributes={TextAttributes.BOLD}>
					{`Mode: ${MODE_LABELS[mode]}`}
				</text>
				<text attributes={TextAttributes.DIM}>{" (m to switch)"}</text>
			</box>

			<scrollbox flexGrow={1} flexShrink={1} minHeight={0} stickyScroll={true}>
				{messages.length === 0 && !loading ? (
					<text attributes={TextAttributes.DIM}>
						Start a conversation to create your project plan
					</text>
				) : (
					messages.map((msg: ChatMessage, index: number) => {
						const label = msg.role === "user" ? "You" : "Assistant";
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only message list
							<box key={`msg-${index}`} flexDirection="column" marginBottom={1}>
								<text attributes={TextAttributes.BOLD}>{label}</text>
								{msg.role === "assistant" ? (
									<markdown content={msg.content} syntaxStyle={syntaxStyle} />
								) : (
									<text>{msg.content}</text>
								)}
							</box>
						);
					})
				)}
				{loading && <text attributes={TextAttributes.DIM}>Thinking...</text>}
				{error && (
					<text attributes={TextAttributes.BOLD}>{`Error: ${error}`}</text>
				)}
			</scrollbox>

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>{getHint(planData)}</text>
				<box border={true} height={3}>
					<input
						focused={focused}
						value={inputValue}
						placeholder={
							loading ? "Waiting for response..." : "Type a message..."
						}
						onInput={setInputValue}
						onChange={setInputValue}
						// biome-ignore lint/suspicious/noExplicitAny: OpenTUI intersection type requires cast
						onSubmit={handleSubmit as any}
					/>
				</box>
			</box>
		</box>
	);
}
