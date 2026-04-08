import { TextAttributes } from "@opentui/core";

export const FILE_PICKER_VISIBLE_COUNT = 10;

interface FilePickerProps {
	results: string[];
	selectedIndex: number;
}

export function FilePicker({ results, selectedIndex }: FilePickerProps) {
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

	const visibleResults = results.slice(0, FILE_PICKER_VISIBLE_COUNT);
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
