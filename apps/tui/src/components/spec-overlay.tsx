import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo } from "react";
import type { PlanFilesData } from "../hooks/use-plan-files";

interface SpecOverlayProps {
	focused: boolean;
	data: PlanFilesData;
	onClose: () => void;
}

export function SpecOverlay({ focused, data, onClose }: SpecOverlayProps) {
	const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "escape" || (key.name === "s" && key.ctrl)) {
			onClose();
		}
	});

	return (
		<box
			position="absolute"
			right={1}
			top={0}
			bottom={3}
			zIndex={10}
			width="50%"
			backgroundColor="black"
			border={true}
			borderStyle="rounded"
			borderColor="#555555"
			title="SPEC.md"
			titleAlignment="left"
			flexDirection="column"
			padding={1}
		>
			<scrollbox flexGrow={1} minHeight={0}>
				{data.hasSpec ? (
					<markdown content={data.specContent} syntaxStyle={syntaxStyle} />
				) : (
					<text attributes={TextAttributes.DIM}>No SPEC.md generated yet</text>
				)}
			</scrollbox>

			<box height={1} marginTop={1}>
				<text attributes={TextAttributes.DIM}>Esc/Ctrl+S: close</text>
			</box>
		</box>
	);
}
