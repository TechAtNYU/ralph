import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { ensureDaemonRunning } from "@techatnyu/ralphd";
import { App } from "./components/app";
import { ensureOpencodeReady } from "./lib/onboarding";

export async function runTui(): Promise<void> {
	const onboarding = await ensureOpencodeReady();

	if (!onboarding.ok) {
		console.error(onboarding.message);
		return;
	}

	const renderer = await createCliRenderer();
	const root = createRoot(renderer);
	const online = await ensureDaemonRunning();

	if (!online) {
		root.render(
			<box alignItems="center" justifyContent="center" flexGrow={1}>
				<text>Daemon offline. Start it with: `ralph daemon start`</text>
			</box>,
		);
		return;
	}

	const close = () => {
		root.unmount();
		renderer.destroy();
	};

	root.render(<App onQuit={close} />);
}

if (import.meta.main) {
	void runTui();
}
