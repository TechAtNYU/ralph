import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useState } from "react";
import { usePlanFiles } from "../hooks/use-plan-files";
import { Chat } from "./chat";
import { ExecuteView } from "./execute-view";
import { HelpOverlay } from "./help-overlay";
import { PlanView } from "./plan-view";
import { ReviewView } from "./review-view";
import { StatusBar } from "./status-bar";

interface AppProps {
	onQuit(): void;
}

type FocusZone = "tabs" | "content";

interface ActiveChat {
	instanceId: string;
	instanceName: string;
}

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
	const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
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
		if (activeChat) return;
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

	if (activeChat) {
		return (
			<Chat
				instanceId={activeChat.instanceId}
				instanceName={activeChat.instanceName}
				onBack={() => setActiveChat(null)}
				onQuit={onQuit}
			/>
		);
	}

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
				<box
					flexGrow={activeTab === 0 ? 1 : 0}
					overflow={activeTab === 0 ? "visible" : "hidden"}
					height={activeTab === 0 ? undefined : 0}
					flexDirection="column"
				>
					<PlanView
						focused={contentFocused && activeTab === 0}
						planData={planFiles.data}
						daemonOnline={daemonOnline}
					/>
				</box>
				<box
					flexGrow={activeTab === 1 ? 1 : 0}
					overflow={activeTab === 1 ? "visible" : "hidden"}
					height={activeTab === 1 ? undefined : 0}
					flexDirection="column"
				>
					<ExecuteView
						focused={contentFocused && activeTab === 1}
						planData={planFiles.data}
						onOpenChat={(instanceId, instanceName) =>
							setActiveChat({ instanceId, instanceName })
						}
					/>
				</box>
				<box
					flexGrow={activeTab === 2 ? 1 : 0}
					overflow={activeTab === 2 ? "visible" : "hidden"}
					height={activeTab === 2 ? undefined : 0}
					flexDirection="column"
				>
					<ReviewView />
				</box>
			</box>

			{showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

			<StatusBar activeTab={activeTab} planData={planFiles.data} />
		</box>
	);
}
