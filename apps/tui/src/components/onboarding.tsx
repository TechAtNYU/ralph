import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { OnboardingCheck } from "../lib/onboarding";

interface OnboardingErrorProps {
	checks: OnboardingCheck[];
	onQuit(): void;
}

export function OnboardingError({ checks, onQuit }: OnboardingErrorProps) {
	useKeyboard((key) => {
		if (
			key.name === "q" ||
			key.name === "escape" ||
			(key.ctrl && key.name === "c")
		) {
			onQuit();
		}
	});

	return (
		<box flexDirection="column" flexGrow={1} padding={1}>
			<ascii-font font="tiny" text="Ralph" />
			<box flexDirection="column" marginTop={1} marginBottom={1}>
				<text attributes={TextAttributes.BOLD}>
					Setup incomplete — some checks failed:
				</text>
			</box>

			{checks.map((check) => (
				<box key={check.label} flexDirection="column" marginBottom={1}>
					<text
						attributes={check.ok ? TextAttributes.DIM : TextAttributes.BOLD}
					>
						{check.ok ? "[ok]" : "[!!]"} {check.label}
					</text>
					{check.message ? (
						<text attributes={TextAttributes.DIM}>
							{"    "}
							{check.message}
						</text>
					) : null}
				</box>
			))}

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>
					Fix the issues above and restart Ralph. Press q to quit.
				</text>
			</box>
		</box>
	);
}
