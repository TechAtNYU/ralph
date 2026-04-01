import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./components/app";
import { OnboardingError } from "./components/onboarding";
import { runOnboardingChecks } from "./lib/onboarding";

const runtime = {
	isShuttingDown: false,
};

export async function runTui(): Promise<void> {
	runtime.isShuttingDown = false;

	const onboarding = await runOnboardingChecks();

	const renderer = await createCliRenderer({
		onDestroy: () => {
			runtime.isShuttingDown = true;
		},
	});
	const root = createRoot(renderer);
	let closed = false;

	const close = () => {
		if (closed) {
			return;
		}

		closed = true;
		runtime.isShuttingDown = true;
		root.unmount();
		renderer.destroy();
	};

	if (onboarding.ok) {
		root.render(<App onQuit={close} />);
	} else {
		root.render(<OnboardingError checks={onboarding.checks} onQuit={close} />);
	}
}

if (import.meta.main) {
	void runTui();
}
