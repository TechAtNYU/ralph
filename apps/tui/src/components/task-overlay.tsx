import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { PlanFilesData, PrdTask } from "../hooks/use-plan-files";

interface TaskOverlayProps {
	focused: boolean;
	data: PlanFilesData;
	onClose: () => void;
}

function clampIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	return Math.min(Math.max(index, 0), length - 1);
}

export function TaskOverlay({ focused, data, onClose }: TaskOverlayProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const { tasks } = data;
	const completedCount = tasks.filter((t) => t.passed).length;

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "escape" || (key.name === "t" && key.ctrl)) {
			onClose();
			return;
		}
		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((i) => clampIndex(i + 1, tasks.length));
		}
		if (key.name === "up" || key.name === "k") {
			setSelectedIndex((i) => clampIndex(i - 1, tasks.length));
		}
	});

	return (
		<box
			position="absolute"
			right={1}
			top={0}
			bottom={3}
			width="40%"
			border={true}
			borderStyle="rounded"
			borderColor="#555555"
			title={`Tasks (${completedCount}/${tasks.length})`}
			titleAlignment="left"
			flexDirection="column"
			padding={1}
		>
			<scrollbox flexGrow={1} minHeight={0}>
				{tasks.map((task: PrdTask, index: number) => {
					const isSelected = focused && index === selectedIndex;
					const icon = task.passed ? "✓" : "○";

					return (
						<box key={task.description} flexDirection="row">
							<text fg={task.passed ? "green" : "#666666"}>{`${icon} `}</text>
							<text
								fg={isSelected ? "white" : task.passed ? "#666666" : "#cccccc"}
								attributes={isSelected ? TextAttributes.BOLD : undefined}
							>
								{task.description}
							</text>
						</box>
					);
				})}
			</scrollbox>

			<box height={1} marginTop={1}>
				<text attributes={TextAttributes.DIM}>j/k: navigate Esc: close</text>
			</box>
		</box>
	);
}
