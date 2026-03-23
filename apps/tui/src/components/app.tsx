import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { ExecuteView } from "./execute-view";
import { PlanView } from "./plan-view";
import { ReviewView } from "./review-view";

interface AppProps {
	onQuit(): void;
}

type FocusZone = "tabs" | "content";

const TAB_OPTIONS = [
	{ name: "Plan", description: "Create spec & PRD" },
	{ name: "Execute", description: "Run agents" },
	{ name: "Review", description: "Review changes" },
];

const HELP_TEXT: Record<number, string> = {
	0: "Tab: focus tabs  Ctrl+H/L: switch panels  m: toggle mode  q: quit",
	1: "Tab: focus tabs  j/k: select  r: refresh  q: quit",
	2: "Tab: focus tabs  q: quit",
};

export function App({ onQuit }: AppProps) {
	const [activeTab, setActiveTab] = useState(0);
	const [focusZone, setFocusZone] = useState<FocusZone>("content");

	useKeyboard((key) => {
		if (key.name === "tab") {
			setFocusZone((z) => (z === "tabs" ? "content" : "tabs"));
			return;
		}

		if (key.name === "q" && focusZone === "tabs") {
			onQuit();
			return;
		}

		if (focusZone === "tabs") {
			if (key.name === "left" || key.name === "h") {
				setActiveTab((t) => Math.max(0, t - 1));
				return;
			}
			if (key.name === "right" || key.name === "l") {
				setActiveTab((t) => Math.min(TAB_OPTIONS.length - 1, t + 1));
				return;
			}
		}
	});

	const contentFocused = focusZone === "content";

	return (
		<box flexDirection="column" flexGrow={1} padding={1}>
			<box flexDirection="column" marginBottom={1}>
				<ascii-font font="tiny" text="Ralph" />
			</box>

			<tab-select
				options={TAB_OPTIONS}
				focused={focusZone === "tabs"}
				onChange={(_index: number) => {
					setActiveTab(_index);
				}}
			/>

			<box flexDirection="column" flexGrow={1} marginTop={1}>
				{activeTab === 0 && <PlanView focused={contentFocused} />}
				{activeTab === 1 && <ExecuteView focused={contentFocused} />}
				{activeTab === 2 && <ReviewView />}
			</box>

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>
					{HELP_TEXT[activeTab] ?? ""}
				</text>
			</box>
		</box>
	);
}
