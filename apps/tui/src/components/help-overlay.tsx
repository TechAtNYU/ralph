import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

interface HelpOverlayProps {
	onClose: () => void;
}

interface KeyBinding {
	keys: string;
	desc: string;
}

const GENERAL_BINDINGS: KeyBinding[] = [
	{ keys: "Tab", desc: "Switch focus (tabs / content)" },
	{ keys: "1/2/3", desc: "Jump to tab" },
	{ keys: "q", desc: "Quit (from tabs)" },
	{ keys: "Esc", desc: "Back to tabs" },
	{ keys: "?", desc: "Toggle this help" },
];

const PLAN_BINDINGS: KeyBinding[] = [
	{ keys: "Ctrl+M", desc: "Switch mode (Spec / PRD)" },
	{ keys: "Ctrl+T", desc: "Toggle task list" },
	{ keys: "@", desc: "Insert file reference" },
	{ keys: "/", desc: "Open command palette" },
];

const TASK_BINDINGS: KeyBinding[] = [
	{ keys: "j/k", desc: "Navigate tasks" },
	{ keys: "Esc", desc: "Close task overlay" },
];

const EXECUTE_BINDINGS: KeyBinding[] = [
	{ keys: "j/k", desc: "Select job" },
	{ keys: "r", desc: "Refresh jobs" },
];

function KeyRow({ keys, desc }: KeyBinding) {
	return (
		<box flexDirection="row">
			<text fg="cyan" attributes={TextAttributes.BOLD} width={12}>
				{keys}
			</text>
			<text attributes={TextAttributes.DIM}>{desc}</text>
		</box>
	);
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
	useKeyboard((key) => {
		if (
			key.name === "escape" ||
			key.name === "?" ||
			(key.name === "/" && key.ctrl)
		) {
			onClose();
		}
	});

	return (
		<box
			position="absolute"
			top={0}
			left={0}
			right={0}
			bottom={0}
			border={true}
			borderStyle="rounded"
			borderColor="cyan"
			title="Keyboard Shortcuts"
			flexDirection="column"
			padding={1}
		>
			<box flexDirection="row" flexGrow={1}>
				<box flexDirection="column" width="50%">
					<text attributes={TextAttributes.BOLD}>General</text>
					{GENERAL_BINDINGS.map((b) => (
						<KeyRow key={b.keys} keys={b.keys} desc={b.desc} />
					))}

					<text attributes={TextAttributes.BOLD} marginTop={1}>
						Task Overlay
					</text>
					{TASK_BINDINGS.map((b) => (
						<KeyRow key={b.keys} keys={b.keys} desc={b.desc} />
					))}
				</box>

				<box flexDirection="column" width="50%">
					<text attributes={TextAttributes.BOLD}>Plan Chat</text>
					{PLAN_BINDINGS.map((b) => (
						<KeyRow key={b.keys} keys={b.keys} desc={b.desc} />
					))}

					<text attributes={TextAttributes.BOLD} marginTop={1}>
						Execute
					</text>
					{EXECUTE_BINDINGS.map((b) => (
						<KeyRow key={b.keys} keys={b.keys} desc={b.desc} />
					))}
				</box>
			</box>

			<text attributes={TextAttributes.DIM}>Press ? or Esc to close</text>
		</box>
	);
}
