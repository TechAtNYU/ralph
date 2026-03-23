import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { useChat } from "../hooks/use-chat";
import { usePlanFiles } from "../hooks/use-plan-files";
import { usePlanInstance } from "../hooks/use-plan-instance";
import { PlanChat } from "./plan-chat";
import { PlanTaskBoard } from "./plan-task-board";

type SubFocus = "chat" | "tasks";

interface PlanViewProps {
	focused: boolean;
}

export function PlanView({ focused }: PlanViewProps) {
	const [subFocus, setSubFocus] = useState<SubFocus>("chat");
	const planFiles = usePlanFiles();
	const planInstance = usePlanInstance();
	const chat = useChat(planInstance.ensure);

	useKeyboard((key) => {
		if (!focused) return;

		if (key.name === "l" && key.ctrl) {
			setSubFocus("tasks");
		}
		if (key.name === "h" && key.ctrl) {
			setSubFocus("chat");
		}
	});

	return (
		<box flexDirection="row" flexGrow={1} gap={2}>
			<box flexDirection="column" width="60%">
				<PlanChat
					focused={focused && subFocus === "chat"}
					messages={chat.messages}
					loading={chat.loading}
					error={chat.error}
					planData={planFiles.data}
					onSend={chat.send}
				/>
			</box>
			<box flexDirection="column" width="40%">
				<PlanTaskBoard
					focused={focused && subFocus === "tasks"}
					data={planFiles.data}
				/>
			</box>
		</box>
	);
}
