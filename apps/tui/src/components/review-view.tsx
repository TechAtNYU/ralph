import { TextAttributes } from "@opentui/core";

export function ReviewView() {
	return (
		<box
			flexDirection="column"
			flexGrow={1}
			alignItems="center"
			justifyContent="center"
		>
			<text attributes={TextAttributes.DIM}>Review — Coming soon</text>
		</box>
	);
}
