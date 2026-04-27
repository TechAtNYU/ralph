import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import type { ChatMessage } from "../hooks/use-chat";
import { useFileSearch } from "../hooks/use-file-search";
import type { Skill, SkillId } from "../skills";
import { CommandPalette, filterCommands } from "./command-palette";
import { FILE_PICKER_VISIBLE_COUNT, FilePicker } from "./file-picker";
import { WelcomeScreen } from "./welcome-screen";

interface PlanChatProps {
	focused: boolean;
	messages: ChatMessage[];
	loading: boolean;
	error: string | undefined;
	daemonOnline: boolean;
	onSendPrompt: (prompt: string) => Promise<void>;
	onToggleTasks: () => void;
	onClear: () => void;
	onStartSkill: (id: Extract<SkillId, "spec" | "prd">) => void;
	skill: Skill | undefined;
}

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
	daemonOnline,
	onSendPrompt,
	onToggleTasks,
	onClear,
	onStartSkill,
	skill,
}: PlanChatProps) {
	const [inputValue, setInputValue] = useState("");
	const [fileRefs, setFileRefs] = useState<string[]>([]);
	const [pickerIndex, setPickerIndex] = useState(0);
	const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

	const fileQuery = extractFileQuery(inputValue);
	const showFilePicker = fileQuery !== null;
	const showCommandPalette =
		inputValue.startsWith("/") && !inputValue.includes(" ");
	const commandQuery = showCommandPalette ? inputValue.slice(1) : "";
	const { results: fileResults } = useFileSearch(fileQuery ?? "");
	const visibleFiles = fileResults.slice(0, FILE_PICKER_VISIBLE_COUNT);
	const filteredCommands = filterCommands(commandQuery);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "tab" && showCommandPalette && !showFilePicker) {
			const idx = Math.min(pickerIndex, filteredCommands.length - 1);
			const cmd = filteredCommands[idx];
			if (cmd) {
				setInputValue(`${cmd.name} `);
				setPickerIndex(0);
			}
		}
		if (key.name === "tab" && showFilePicker) {
			const idx = Math.min(pickerIndex, visibleFiles.length - 1);
			const file = visibleFiles[idx];
			if (file) {
				handleFileSelect(file);
				setPickerIndex(0);
			}
		}
		if (showCommandPalette || showFilePicker) {
			const maxIndex = showCommandPalette
				? filteredCommands.length - 1
				: visibleFiles.length - 1;
			if (key.name === "n" && key.ctrl) {
				setPickerIndex((i) => Math.min(i + 1, maxIndex));
			}
			if (key.name === "p" && key.ctrl) {
				setPickerIndex((i) => Math.max(0, i - 1));
			}
		}
	});

	const handleInputChange = (value: string) => {
		setInputValue(value);
		setPickerIndex(0);
	};

	const handleFileSelect = (path: string) => {
		const lastAt = inputValue.lastIndexOf("@");
		const newValue = `${inputValue.slice(0, lastAt)}@${path} `;
		setInputValue(newValue);
		if (!fileRefs.includes(path)) {
			setFileRefs((prev) => [...prev, path]);
		}
	};

	const buildPrompt = (text: string): string => {
		if (fileRefs.length === 0) return text;
		const fileContents = fileRefs
			.map((ref) => `\n\n--- Contents of ${ref} ---\n${readFileContents(ref)}`)
			.join("");
		return `${text}${fileContents}`;
	};

	const executeCommand = (cmdName: string) => {
		if (cmdName === "/spec" || cmdName === "/prd") {
			onStartSkill(cmdName.slice(1) as Extract<SkillId, "spec" | "prd">);
			setInputValue("");
			return;
		}
		if (cmdName === "/tasks") {
			onToggleTasks();
			setInputValue("");
			return;
		}
		if (cmdName === "/clear") {
			onClear();
			setInputValue("");
			return;
		}
	};

	const handleSubmit = (value: string) => {
		if (showCommandPalette && !showFilePicker) {
			const idx = Math.min(pickerIndex, filteredCommands.length - 1);
			const cmd = filteredCommands[idx];
			if (cmd) executeCommand(cmd.name);
			return;
		}

		if (showFilePicker) {
			const idx = Math.min(pickerIndex, visibleFiles.length - 1);
			const file = visibleFiles[idx];
			if (file) handleFileSelect(file);
			return;
		}

		const trimmed = value.trim();
		if (!trimmed || loading) return;

		if (trimmed.startsWith("/")) {
			const spaceIdx = trimmed.indexOf(" ");
			const cmdName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
			executeCommand(cmdName);
			return;
		}

		const prompt = buildPrompt(trimmed);
		setInputValue("");
		setFileRefs([]);
		void onSendPrompt(prompt);
	};

	const placeholder = loading
		? "Waiting for response..."
		: (skill?.inputPlaceholder ?? "What do you want to build?");

	return (
		<box flexDirection="column" flexGrow={1}>
			<scrollbox flexGrow={1} flexShrink={1} minHeight={0} stickyScroll={true}>
				{messages.length === 0 && !loading ? (
					<WelcomeScreen skill={skill} />
				) : (
					messages.map((msg: ChatMessage, index: number) =>
						msg.role === "system" ? (
							<box
								// biome-ignore lint/suspicious/noArrayIndexKey: append-only message list
								key={`msg-${index}`}
								marginBottom={1}
								paddingLeft={2}
								paddingRight={2}
							>
								<text fg="yellow" attributes={TextAttributes.DIM}>
									{`— ${msg.content} —`}
								</text>
							</box>
						) : (
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
									{msg.role === "user" ? "You" : "Ralph"}
								</text>
								{msg.role === "assistant" ? (
									<markdown content={msg.content} syntaxStyle={syntaxStyle} />
								) : (
									<text>{msg.content}</text>
								)}
							</box>
						),
					)
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
				<FilePicker results={visibleFiles} selectedIndex={pickerIndex} />
			)}

			{showCommandPalette && !showFilePicker && (
				<CommandPalette
					commands={filteredCommands}
					selectedIndex={pickerIndex}
				/>
			)}

			<box flexDirection="column" marginTop={1}>
				{!daemonOnline && (
					<box paddingLeft={1} marginBottom={0}>
						<text fg="red" attributes={TextAttributes.DIM}>
							{"Daemon offline — start with bun run dev"}
						</text>
					</box>
				)}
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
						focused={focused}
						value={inputValue}
						placeholder={placeholder}
						onInput={handleInputChange}
						onChange={handleInputChange}
						// biome-ignore lint/suspicious/noExplicitAny: OpenTUI intersection type requires cast
						onSubmit={handleSubmit as any}
						flexGrow={1}
					/>
					{skill && (
						<text attributes={TextAttributes.DIM} fg="cyan">
							{` ${skill.name} `}
						</text>
					)}
				</box>
			</box>
		</box>
	);
}
