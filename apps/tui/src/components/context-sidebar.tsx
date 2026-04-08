import { TextAttributes } from "@opentui/core";
import type { ChatMode } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";

const MODE_LABELS: Record<ChatMode, string> = {
	"create-spec": "Spec",
	"create-prd": "PRD",
	"create-prompt": "Prompt",
};

interface ContextSidebarProps {
	planData: PlanFilesData;
	mode: ChatMode;
	messageCount: number;
}

export function ContextSidebar({
	planData,
	mode,
	messageCount,
}: ContextSidebarProps) {
	const doneCount = planData.tasks.filter((t) => t.passed).length;

	return (
		<box
			width="30%"
			border={["left"]}
			borderColor="#444444"
			paddingLeft={1}
			flexDirection="column"
			flexShrink={0}
		>
			<text attributes={TextAttributes.BOLD}>Plan Status</text>
			<text fg={planData.hasSpec ? "green" : "#666666"}>
				{planData.hasSpec ? "✓ SPEC.md" : "○ No spec"}
			</text>
			<text fg={planData.hasPrd ? "green" : "#666666"}>
				{planData.hasPrd ? "✓ prd.json" : "○ No PRD"}
			</text>
			<text fg={planData.hasPrompt ? "green" : "#666666"}>
				{planData.hasPrompt ? "✓ PROMPT.md" : "○ No prompt"}
			</text>
			{planData.tasks.length > 0 && (
				<text fg="cyan">{`${doneCount}/${planData.tasks.length} tasks`}</text>
			)}

			<text attributes={TextAttributes.BOLD} marginTop={1}>
				Session
			</text>
			<text
				attributes={TextAttributes.DIM}
			>{`Mode: ${MODE_LABELS[mode]}`}</text>
			<text attributes={TextAttributes.DIM}>{`${messageCount} messages`}</text>
		</box>
	);
}
