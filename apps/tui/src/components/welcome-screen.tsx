import { TextAttributes } from "@opentui/core";
import type { Skill } from "../skills";

interface WelcomeScreenProps {
	skill: Skill | undefined;
}

export function WelcomeScreen({ skill }: WelcomeScreenProps) {
	if (skill?.id === "brainstorm") {
		return (
			<box
				flexDirection="column"
				flexGrow={1}
				alignItems="center"
				justifyContent="center"
			>
				<text attributes={TextAttributes.BOLD}>Plan</text>
				<text attributes={TextAttributes.DIM} marginTop={1}>
					Describe what you want to build.
				</text>
				<text attributes={TextAttributes.DIM}>
					When ready, type /spec to generate the spec.
				</text>
			</box>
		);
	}

	if (skill) {
		return (
			<box
				flexDirection="column"
				flexGrow={1}
				alignItems="center"
				justifyContent="center"
			>
				<text attributes={TextAttributes.BOLD}>{skill.name}</text>
				<text attributes={TextAttributes.DIM} marginTop={1}>
					{skill.inputPlaceholder}
				</text>
			</box>
		);
	}

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			alignItems="center"
			justifyContent="center"
		>
			<text attributes={TextAttributes.BOLD}>ralph</text>
			<text attributes={TextAttributes.DIM} marginTop={1}>
				AI-powered project planning
			</text>

			<box flexDirection="column" marginTop={2}>
				<text attributes={TextAttributes.DIM}>Skills:</text>
				<box flexDirection="row">
					<text fg="cyan">/spec</text>
					<text attributes={TextAttributes.DIM}>
						{"   Generate project spec (.ralph/SPEC.md)"}
					</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">/prd</text>
					<text attributes={TextAttributes.DIM}>
						{"    Create task breakdown (.ralph/prd.json)"}
					</text>
				</box>
			</box>

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>Commands:</text>
				<box flexDirection="row">
					<text fg="cyan">/tasks</text>
					<text attributes={TextAttributes.DIM}>{"   Toggle task list"}</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">/clear</text>
					<text attributes={TextAttributes.DIM}>
						{"   Clear chat messages"}
					</text>
				</box>
			</box>

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>Shortcuts:</text>
				<box flexDirection="row">
					<text fg="cyan">Ctrl+T</text>
					<text attributes={TextAttributes.DIM}>
						{"       Toggle task list"}
					</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">Ctrl+N / P</text>
					<text attributes={TextAttributes.DIM}>
						{"   Next / previous suggestion"}
					</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">@file</text>
					<text attributes={TextAttributes.DIM}>
						{"        Reference a file"}
					</text>
				</box>
			</box>
		</box>
	);
}
