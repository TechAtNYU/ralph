import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import type { ChatMode } from "../hooks/use-chat";
import { useChat } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";
import { usePlanInstance } from "../hooks/use-plan-instance";
import { ContextSidebar } from "./context-sidebar";
import { PlanChat } from "./plan-chat";
import { TaskOverlay } from "./task-overlay";

const MODES: ChatMode[] = ["create-spec", "create-prd"];
const SIDEBAR_MIN_WIDTH = 120;

interface PlanViewProps {
	focused: boolean;
	planData: PlanFilesData;
}

export function PlanView({ focused, planData }: PlanViewProps) {
	const [showTasks, setShowTasks] = useState(false);
	const [modeIndex, setModeIndex] = useState(0);
	const planInstance = usePlanInstance();
	const chat = useChat(planInstance.ensure);
	const mode: ChatMode = MODES[modeIndex] ?? "create-spec";
	const { width } = useTerminalDimensions();
	const showSidebar = width >= SIDEBAR_MIN_WIDTH;

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "t" && key.ctrl) {
			setShowTasks((s) => !s);
		}
	});

	const toggleMode = () => {
		setModeIndex((i) => (i + 1) % MODES.length);
	};

	const toggleTasks = () => {
		setShowTasks((s) => !s);
	};

	const setMode = (newMode: ChatMode) => {
		const index = MODES.indexOf(newMode);
		if (index !== -1) {
			setModeIndex(index);
		}
	};

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" flexGrow={1}>
				<PlanChat
					focused={focused && !showTasks}
					messages={chat.messages}
					loading={chat.loading}
					error={chat.error}
					planData={planData}
					onSend={chat.send}
					onToggleMode={toggleMode}
					onToggleTasks={toggleTasks}
					onClear={chat.clear}
					onSetMode={setMode}
					mode={mode}
				/>

				{showSidebar && (
					<ContextSidebar
						planData={planData}
						mode={mode}
						messageCount={chat.messages.length}
					/>
				)}
			</box>

			{showTasks && planData.hasPrd && (
				<TaskOverlay
					focused={focused && showTasks}
					data={planData}
					onClose={() => setShowTasks(false)}
				/>
			)}
		</box>
	);
}
