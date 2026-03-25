import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import type { ChatMessage, ChatMode } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";
import type { SlashCommand } from "./command-palette";
import { CommandPalette } from "./command-palette";
import { FilePicker } from "./file-picker";
import { WelcomeScreen } from "./welcome-screen";

interface PlanChatProps {
	focused: boolean;
	messages: ChatMessage[];
	loading: boolean;
	error: string | undefined;
	planData: PlanFilesData;
	onSend: (prompt: string, mode: ChatMode) => Promise<void>;
	onToggleMode: () => void;
	onToggleTasks: () => void;
	onClear: () => void;
	onSetMode: (mode: ChatMode) => void;
	mode: ChatMode;
}

const MODE_LABELS: Record<ChatMode, string> = {
	"create-spec": "Spec",
	"create-prd": "PRD",
};

function extractFileQuery(input: string): string | null {
	const lastAt = input.lastIndexOf("@");
	if (lastAt === -1) return null;
	const afterAt = input.slice(lastAt + 1);
	if (afterAt.includes(" ")) return null;
	return afterAt;
}

function readFileContents(path: string): string {
	try {
		return readFileSync(join(process.cwd(), path), "utf-8");
	} catch {
		return "(file not found)";
	}
}

export function PlanChat({
	focused,
	messages,
	loading,
	error,
	planData,
	onSend,
	onToggleMode,
	onToggleTasks,
	onClear,
	onSetMode,
	mode,
}: PlanChatProps) {
	const [inputValue, setInputValue] = useState("");
	const [fileRefs, setFileRefs] = useState<string[]>([]);
	const [showFilePicker, setShowFilePicker] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "m" && key.ctrl) {
			onToggleMode();
		}
		if (key.name === "t" && key.ctrl) {
			onToggleTasks();
		}
	});

	const handleInputChange = (value: string) => {
		setInputValue(value);

		const fileQuery = extractFileQuery(value);
		setShowFilePicker(fileQuery !== null);

		setShowCommandPalette(value.startsWith("/") && value.length >= 1);
	};

	const handleFileSelect = (path: string) => {
		const lastAt = inputValue.lastIndexOf("@");
		const newValue = `${inputValue.slice(0, lastAt)}@${path} `;
		setInputValue(newValue);
		if (!fileRefs.includes(path)) {
			setFileRefs((prev) => [...prev, path]);
		}
		setShowFilePicker(false);
	};

	const handleCommandSelect = (command: SlashCommand) => {
		setShowCommandPalette(false);
		setInputValue("");

		switch (command.name) {
			case "/spec":
				onSetMode("create-spec");
				setInputValue("Create a spec for this project");
				break;
			case "/prd":
				onSetMode("create-prd");
				setInputValue("Break the spec into tasks");
				break;
			case "/tasks":
				onToggleTasks();
				break;
			case "/clear":
				onClear();
				break;
		}
	};

	const handleSubmit = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || loading) return;

		if (trimmed.startsWith("/")) {
			setInputValue("");
			return;
		}

		let prompt = trimmed;
		if (fileRefs.length > 0) {
			const fileContents = fileRefs
				.map(
					(ref) => `\n\n--- Contents of ${ref} ---\n${readFileContents(ref)}`,
				)
				.join("");
			prompt = `${trimmed}${fileContents}`;
		}

		setInputValue("");
		setFileRefs([]);
		void onSend(prompt, mode);
	};

	const fileQuery = extractFileQuery(inputValue);
	const commandQuery = inputValue.startsWith("/") ? inputValue.slice(1) : "";

	return (
		<box flexDirection="column" flexGrow={1}>
			<scrollbox flexGrow={1} flexShrink={1} minHeight={0} stickyScroll={true}>
				{messages.length === 0 && !loading ? (
					<WelcomeScreen planData={planData} />
				) : (
					messages.map((msg: ChatMessage, index: number) => (
						<box
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only message list
							key={`msg-${index}`}
							flexDirection="column"
							marginBottom={1}
							paddingLeft={2}
						>
							<text
								fg={msg.role === "user" ? "brightWhite" : "cyan"}
								attributes={TextAttributes.BOLD}
							>
								{msg.role === "user" ? "You" : "Assistant"}
							</text>
							{msg.role === "assistant" ? (
								<markdown content={msg.content} syntaxStyle={syntaxStyle} />
							) : (
								<text>{msg.content}</text>
							)}
						</box>
					))
				)}
				{loading && (
					<box marginBottom={1} paddingLeft={2}>
						<text fg="cyan" attributes={TextAttributes.ITALIC}>
							Thinking...
						</text>
					</box>
				)}
				{error && (
					<box paddingLeft={2}>
						<text fg="red">{`Error: ${error}`}</text>
					</box>
				)}
			</scrollbox>

			{showFilePicker && (
				<FilePicker
					query={fileQuery ?? ""}
					onSelect={handleFileSelect}
					onDismiss={() => setShowFilePicker(false)}
					focused={focused}
				/>
			)}

			{showCommandPalette && !showFilePicker && (
				<CommandPalette
					query={commandQuery}
					onSelect={handleCommandSelect}
					onDismiss={() => setShowCommandPalette(false)}
					focused={focused}
				/>
			)}

			<box flexDirection="column" marginTop={1}>
				{fileRefs.length > 0 && (
					<box flexDirection="row" paddingLeft={1} marginBottom={0}>
						{fileRefs.map((ref) => (
							<text key={ref} fg="cyan" attributes={TextAttributes.DIM}>
								{`@${ref} `}
							</text>
						))}
					</box>
				)}
				<box
					border={true}
					borderStyle="rounded"
					borderColor={focused ? "cyan" : "#444444"}
					height={3}
					flexDirection="row"
				>
					<input
						focused={focused && !showFilePicker && !showCommandPalette}
						value={inputValue}
						placeholder={
							loading ? "Waiting for response..." : "Type a message..."
						}
						onInput={handleInputChange}
						onChange={handleInputChange}
						// biome-ignore lint/suspicious/noExplicitAny: OpenTUI intersection type requires cast
						onSubmit={handleSubmit as any}
						flexGrow={1}
					/>
					<text attributes={TextAttributes.DIM} fg="cyan">
						{` ${MODE_LABELS[mode]} `}
					</text>
				</box>
			</box>
		</box>
	);
}
