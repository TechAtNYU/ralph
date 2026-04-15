import { TextAttributes } from "@opentui/core";
import type { PlanFilesData } from "../hooks/use-plan-files";

interface StatusBarProps {
	activeTab: number;
	planData: PlanFilesData;
}

const HELP_BY_TAB: Record<number, string> = {
	0: "Tab: tabs  Ctrl+T: tasks  /: commands  ?: help",
	1: "Tab: tabs  j/k: select  r: refresh  ?: help",
	2: "Tab: tabs  ?: help",
};

function getTaskSummary(planData: PlanFilesData): string {
	if (!planData.hasPrd || planData.tasks.length === 0) return "";
	const done = planData.tasks.filter((t) => t.passed).length;
	return `${done}/${planData.tasks.length} tasks done`;
}

export function StatusBar({ activeTab, planData }: StatusBarProps) {
	const help = HELP_BY_TAB[activeTab] ?? "";
	const taskSummary = getTaskSummary(planData);
	const allDone =
		planData.tasks.length > 0 && planData.tasks.every((t) => t.passed);

	return (
		<box flexDirection="row" height={1}>
			<text attributes={TextAttributes.DIM}>{help}</text>
			<box flexGrow={1} />
			{taskSummary && (
				<text fg={allDone ? "green" : "cyan"}>{taskSummary}</text>
			)}
		</box>
	);
}
