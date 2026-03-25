import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";

export interface SlashCommand {
	name: string;
	description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: "/spec", description: "Generate a project spec" },
	{ name: "/prd", description: "Break spec into tasks" },
	{ name: "/tasks", description: "Toggle task overlay" },
	{ name: "/clear", description: "Clear chat messages" },
];

interface CommandPaletteProps {
	query: string;
	onSelect: (command: SlashCommand) => void;
	onDismiss: () => void;
	focused: boolean;
}

export function CommandPalette({
	query,
	onSelect,
	onDismiss,
	focused,
}: CommandPaletteProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	const filtered = SLASH_COMMANDS.filter((cmd) =>
		cmd.name.toLowerCase().includes(`/${query.toLowerCase()}`),
	);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "escape") {
			onDismiss();
			return;
		}
		if (key.name === "down" || (key.name === "j" && key.ctrl)) {
			setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
			return;
		}
		if (key.name === "up" || (key.name === "k" && key.ctrl)) {
			setSelectedIndex((i) => Math.max(i - 1, 0));
			return;
		}
		if (key.name === "return") {
			const selected = filtered[selectedIndex];
			if (selected) {
				onSelect(selected);
			}
			return;
		}
	});

	if (filtered.length === 0) {
		return (
			<box
				position="absolute"
				bottom={4}
				left={0}
				width="40%"
				border={true}
				borderStyle="rounded"
				borderColor="cyan"
				title="Commands"
				height={3}
			>
				<text attributes={TextAttributes.DIM} paddingLeft={1}>
					No matching commands
				</text>
			</box>
		);
	}

	const clampedIndex = Math.min(selectedIndex, filtered.length - 1);

	return (
		<box
			position="absolute"
			bottom={4}
			left={0}
			width="40%"
			border={true}
			borderStyle="rounded"
			borderColor="cyan"
			title="Commands"
			maxHeight={8}
			flexDirection="column"
		>
			{filtered.map((cmd, index) => (
				<box key={cmd.name} flexDirection="row" paddingLeft={1}>
					<text
						fg="cyan"
						attributes={
							index === clampedIndex ? TextAttributes.BOLD : undefined
						}
					>
						{cmd.name}
					</text>
					<text attributes={TextAttributes.DIM}>{`  ${cmd.description}`}</text>
				</box>
			))}
		</box>
	);
}
