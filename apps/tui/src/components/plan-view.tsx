import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import type { ChatMode } from "../hooks/use-chat";
import { useChat } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";
import { usePlanInstance } from "../hooks/use-plan-instance";
import { ContextSidebar } from "./context-sidebar";
import { PlanChat } from "./plan-chat";
import { TaskOverlay } from "./task-overlay";

const SIDEBAR_MIN_WIDTH = 120;

interface PlanViewProps {
	focused: boolean;
	planData: PlanFilesData;
	daemonOnline: boolean;
}

export function PlanView({ focused, planData, daemonOnline }: PlanViewProps) {
	const [showTasks, setShowTasks] = useState(false);
	const [mode, setMode] = useState<ChatMode>("create-spec");
	const planInstance = usePlanInstance();
	const chat = useChat(planInstance.ensure);
	const { width } = useTerminalDimensions();
	const showSidebar = width >= SIDEBAR_MIN_WIDTH;

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "t" && key.ctrl) {
			setShowTasks((s) => !s);
		}
	});

	const toggleTasks = () => {
		setShowTasks((s) => !s);
	};

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" flexGrow={1}>
				<PlanChat
					focused={focused && !showTasks}
					messages={chat.messages}
					loading={chat.loading}
					error={chat.error ?? planInstance.error}
					planData={planData}
					daemonOnline={daemonOnline}
					onSend={chat.send}
					onToggleTasks={toggleTasks}
					onClear={chat.clear}
					onSetMode={setMode}
					mode={mode}
				/>

				{showSidebar && (
					<ContextSidebar
						planData={planData}
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
