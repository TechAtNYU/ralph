import { TextAttributes } from "@opentui/core";

export interface SlashCommand {
	name: string;
	description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: "/spec", description: "Generate project spec (.ralph/SPEC.md)" },
	{ name: "/prd", description: "Create task breakdown (.ralph/prd.json)" },
	{ name: "/tasks", description: "Toggle task overlay" },
	{ name: "/clear", description: "Clear chat messages" },
];

export function filterCommands(query: string): SlashCommand[] {
	return SLASH_COMMANDS.filter((cmd) =>
		cmd.name.toLowerCase().includes(`/${query.toLowerCase()}`),
	);
}

interface CommandPaletteProps {
	commands: SlashCommand[];
	selectedIndex: number;
}

export function CommandPalette({
	commands: filtered,
	selectedIndex,
}: CommandPaletteProps) {
	if (filtered.length === 0) {
		return (
			<box
				width="40%"
				border={true}
				borderStyle="rounded"
				borderColor="cyan"
				title="Commands"
				height={3}
				flexShrink={0}
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
			width="40%"
			border={true}
			borderStyle="rounded"
			borderColor="cyan"
			title="Commands"
			maxHeight={8}
			flexDirection="column"
			flexShrink={0}
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
