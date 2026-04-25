import { TextAttributes } from "@opentui/core";
import type { PlanFilesData } from "../hooks/use-plan-files";
import type { ActiveSkill } from "../skills";

interface ContextSidebarProps {
	planData: PlanFilesData;
	messageCount: number;
	activeSkill: ActiveSkill;
}

export function ContextSidebar({
	planData,
	messageCount,
	activeSkill,
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
			<text attributes={TextAttributes.BOLD}>Skill</text>
			<text fg={activeSkill ? "cyan" : "#666666"}>
				{activeSkill ? activeSkill.toUpperCase() : "None"}
			</text>

			<text attributes={TextAttributes.BOLD} marginTop={1}>
				Artifacts
			</text>
			{planData.specError ? (
				<>
					<text fg="red">✗ SPEC.md</text>
					<text fg="#aa6666" attributes={TextAttributes.DIM}>
						{`  ${planData.specError}`}
					</text>
				</>
			) : (
				<text fg={planData.hasSpec ? "green" : "#666666"}>
					{`${planData.hasSpec ? "✓" : "○"} SPEC.md`}
				</text>
			)}
			{planData.prdError ? (
				<>
					<text fg="red">✗ prd.json</text>
					<text fg="#aa6666" attributes={TextAttributes.DIM}>
						{`  ${planData.prdError}`}
					</text>
				</>
			) : (
				<text fg={planData.hasPrd ? "green" : "#666666"}>
					{`${planData.hasPrd ? "✓" : "○"} prd.json`}
				</text>
			)}

			{planData.tasks.length > 0 && (
				<>
					<text attributes={TextAttributes.BOLD} marginTop={1}>
						Tasks
					</text>
					<text fg="cyan">{`${doneCount}/${planData.tasks.length} done`}</text>
				</>
			)}

			<text attributes={TextAttributes.BOLD} marginTop={1}>
				Session
			</text>
			<text attributes={TextAttributes.DIM}>{`${messageCount} messages`}</text>
		</box>
	);
}
