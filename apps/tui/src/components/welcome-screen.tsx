import { TextAttributes } from "@opentui/core";
import type { PlanFilesData } from "../hooks/use-plan-files";

interface WelcomeScreenProps {
	planData: PlanFilesData;
}

export function WelcomeScreen({ planData }: WelcomeScreenProps) {
	if (planData.hasSpec && planData.hasPrd && planData.hasPrompt) {
		return (
			<box
				flexDirection="column"
				flexGrow={1}
				alignItems="center"
				justifyContent="center"
			>
				<text attributes={TextAttributes.BOLD}>Plan complete!</text>
				<text attributes={TextAttributes.DIM} marginTop={1}>
					Switch to the Execute tab to start building.
				</text>
			</box>
		);
	}

	if (planData.hasSpec && planData.hasPrd) {
		return (
			<box
				flexDirection="column"
				flexGrow={1}
				alignItems="center"
				justifyContent="center"
			>
				<text attributes={TextAttributes.BOLD}>Tasks ready</text>
				<text attributes={TextAttributes.DIM} marginTop={1}>
					Try /prompt to generate the execution prompt.
				</text>
			</box>
		);
	}

	if (planData.hasSpec) {
		return (
			<box
				flexDirection="column"
				flexGrow={1}
				alignItems="center"
				justifyContent="center"
			>
				<text attributes={TextAttributes.BOLD}>Spec ready</text>
				<text attributes={TextAttributes.DIM} marginTop={1}>
					Your spec is ready. Try /prd to break it into tasks.
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

			<text marginTop={2} attributes={TextAttributes.DIM}>
				Describe your project to get started, or use a command:
			</text>

			<box flexDirection="column" marginTop={1} paddingLeft={2}>
				<box flexDirection="row">
					<text fg="cyan">/spec</text>
					<text attributes={TextAttributes.DIM}>
						{"      Generate a project spec"}
					</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">/prd</text>
					<text attributes={TextAttributes.DIM}>
						{"       Break spec into tasks"}
					</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">/prompt</text>
					<text attributes={TextAttributes.DIM}>
						{"    Generate execution prompt"}
					</text>
				</box>
			</box>

			<box flexDirection="column" marginTop={1} paddingLeft={2}>
				<text attributes={TextAttributes.DIM}>Shortcuts:</text>
				<box flexDirection="row">
					<text fg="cyan">Ctrl+M</text>
					<text attributes={TextAttributes.DIM}>
						{"   Switch mode (Spec / PRD / Prompt)"}
					</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">Ctrl+T</text>
					<text attributes={TextAttributes.DIM}>{"   Toggle task list"}</text>
				</box>
				<box flexDirection="row">
					<text fg="cyan">@file</text>
					<text attributes={TextAttributes.DIM}>{"    Reference a file"}</text>
				</box>
			</box>

			<text fg="cyan" attributes={TextAttributes.ITALIC} marginTop={2}>
				Try: "Build me a todo app with auth and real-time sync"
			</text>
		</box>
	);
}
