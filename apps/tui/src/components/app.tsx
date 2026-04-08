import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useState } from "react";
import { usePlanFiles } from "../hooks/use-plan-files";
import { ExecuteView } from "./execute-view";
import { HelpOverlay } from "./help-overlay";
import { PlanView } from "./plan-view";
import { ReviewView } from "./review-view";
import { StatusBar } from "./status-bar";

interface AppProps {
	onQuit(): void;
}

type FocusZone = "tabs" | "content";

const TAB_OPTIONS = [
	{ name: "Plan", description: "" },
	{ name: "Execute", description: "" },
	{ name: "Review", description: "" },
];

export function App({ onQuit }: AppProps) {
	const [activeTab, setActiveTab] = useState(0);
	const [focusZone, setFocusZone] = useState<FocusZone>("content");
	const [daemonOnline, setDaemonOnline] = useState(true);
	const [showHelp, setShowHelp] = useState(false);
	const planFiles = usePlanFiles();

	const checkDaemon = useCallback(async () => {
		try {
			await daemon.health();
			setDaemonOnline(true);
		} catch {
			setDaemonOnline(false);
		}
	}, []);

	useEffect(() => {
		void checkDaemon();
		const interval = setInterval(() => void checkDaemon(), 10_000);
		return () => clearInterval(interval);
	}, [checkDaemon]);

	useKeyboard((key) => {
		if (showHelp) {
			if (
				key.name === "escape" ||
				key.name === "?" ||
				(key.name === "/" && key.ctrl)
			) {
				setShowHelp(false);
			}
			return;
		}

		if (key.name === "/" && key.ctrl) {
			setShowHelp(true);
			return;
		}

		if (key.name === "tab") {
			if (focusZone === "tabs") {
				setFocusZone("content");
			}
			return;
		}

		if (key.name === "escape") {
			setFocusZone("tabs");
			return;
		}

		if (focusZone === "tabs") {
			if (key.name === "q") {
				onQuit();
				return;
			}
			if (key.name === "?") {
				setShowHelp(true);
				return;
			}
		}
	});

	const contentFocused = focusZone === "content";

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" height={1}>
				<text attributes={TextAttributes.BOLD}>ralph</text>
				<box flexGrow={1} />
				<text fg={daemonOnline ? "green" : "red"}>{"● "}</text>
				<text attributes={TextAttributes.DIM}>
					{daemonOnline ? "online" : "offline"}
				</text>
			</box>

			<tab-select
				options={TAB_OPTIONS}
				focused={focusZone === "tabs"}
				showDescription={false}
				onChange={(index: number) => {
					setActiveTab(index);
				}}
			/>

			<box flexDirection="column" flexGrow={1} marginTop={1}>
				{activeTab === 0 && (
					<PlanView focused={contentFocused} planData={planFiles.data} />
				)}
				{activeTab === 1 && <ExecuteView focused={contentFocused} />}
				{activeTab === 2 && <ReviewView />}
			</box>

			{showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

			<StatusBar activeTab={activeTab} planData={planFiles.data} />
		</box>
	);
}
