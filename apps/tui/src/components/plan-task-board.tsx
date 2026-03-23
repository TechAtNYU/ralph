import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import type { PlanFilesData, PrdTask } from "../hooks/use-plan-files";

interface PlanTaskBoardProps {
	focused: boolean;
	data: PlanFilesData;
}

function clampIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	return Math.min(Math.max(index, 0), length - 1);
}

export function PlanTaskBoard({ focused, data }: PlanTaskBoardProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const { tasks, progress } = data;
	const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

	useKeyboard((key) => {
		if (!focused || tasks.length === 0) return;

		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((i) => clampIndex(i + 1, tasks.length));
		}
		if (key.name === "up" || key.name === "k") {
			setSelectedIndex((i) => clampIndex(i - 1, tasks.length));
		}
	});

	const selected: PrdTask | undefined = tasks[selectedIndex];
	const completedCount = tasks.filter((t) => t.passed).length;

	if (!data.hasPrd) {
		return (
			<box flexDirection="column" flexGrow={1} padding={1}>
				<text attributes={TextAttributes.DIM}>
					No plan found — create a PRD to see tasks here
				</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" flexGrow={1}>
			<text attributes={TextAttributes.BOLD}>
				{`Tasks (${completedCount}/${tasks.length} complete)`}
			</text>

			<box flexDirection="column" marginTop={1}>
				{tasks.map((task: PrdTask, index: number) => {
					const isFocused = focused && index === selectedIndex;
					const icon = task.passed ? "[x]" : "[ ]";
					return (
						<text
							key={task.description}
							attributes={isFocused ? TextAttributes.BOLD : TextAttributes.DIM}
						>
							{`${isFocused ? ">" : " "} ${icon} ${task.description}`}
						</text>
					);
				})}
			</box>

			{selected && (
				<box flexDirection="column" marginTop={1}>
					<text attributes={TextAttributes.BOLD}>Subtasks</text>
					{selected.subtasks.map((subtask: string) => (
						<text key={subtask} attributes={TextAttributes.DIM}>
							{`  - ${subtask}`}
						</text>
					))}
					{selected.notes && (
						<box flexDirection="column" marginTop={1}>
							<text attributes={TextAttributes.BOLD}>Notes</text>
							<text attributes={TextAttributes.DIM}>{selected.notes}</text>
						</box>
					)}
				</box>
			)}

			{progress && (
				<box flexDirection="column" marginTop={1} flexGrow={1}>
					<text attributes={TextAttributes.BOLD}>Progress Log</text>
					<scrollbox flexGrow={1} minHeight={0}>
						<markdown content={progress} syntaxStyle={syntaxStyle} />
					</scrollbox>
				</box>
			)}
		</box>
	);
}
