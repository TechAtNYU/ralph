import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { useFileSearch } from "../hooks/use-file-search";

interface FilePickerProps {
	query: string;
	onSelect: (path: string) => void;
	onDismiss: () => void;
	focused: boolean;
}

export function FilePicker({
	query,
	onSelect,
	onDismiss,
	focused,
}: FilePickerProps) {
	const { results } = useFileSearch(query);
	const [selectedIndex, setSelectedIndex] = useState(0);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "escape") {
			onDismiss();
			return;
		}
		if (key.name === "down" || (key.name === "j" && key.ctrl)) {
			setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
			return;
		}
		if (key.name === "up" || (key.name === "k" && key.ctrl)) {
			setSelectedIndex((i) => Math.max(i - 1, 0));
			return;
		}
		if (key.name === "return") {
			const selected = results[selectedIndex];
			if (selected) {
				onSelect(selected);
			}
			return;
		}
	});

	if (results.length === 0) {
		return (
			<box
				position="absolute"
				bottom={4}
				left={0}
				width="60%"
				border={true}
				borderStyle="rounded"
				borderColor="cyan"
				title="Files"
				height={3}
			>
				<text attributes={TextAttributes.DIM} paddingLeft={1}>
					No matching files
				</text>
			</box>
		);
	}

	const visibleResults = results.slice(0, 10);
	const clampedIndex = Math.min(selectedIndex, visibleResults.length - 1);

	return (
		<box
			position="absolute"
			bottom={4}
			left={0}
			width="60%"
			border={true}
			borderStyle="rounded"
			borderColor="cyan"
			title="Files"
			maxHeight={12}
			flexDirection="column"
		>
			<scrollbox flexGrow={1} minHeight={0}>
				{visibleResults.map((file, index) => (
					<text
						key={file}
						fg={index === clampedIndex ? "white" : "#aaaaaa"}
						attributes={
							index === clampedIndex ? TextAttributes.BOLD : undefined
						}
						paddingLeft={1}
					>
						{index === clampedIndex ? `> ${file}` : `  ${file}`}
					</text>
				))}
			</scrollbox>
		</box>
	);
}
