import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { health, isDaemonRunning, listJobs } from "./daemon/client";
import { ensureDaemonRunning } from "./daemon/launcher";

interface AppProps {
	daemonOnline: boolean;
	statusLine: string;
	jobLine: string;
}

function App({ daemonOnline, statusLine, jobLine }: AppProps) {
	return (
		<box alignItems="center" justifyContent="center" flexGrow={1}>
			<box justifyContent="center" alignItems="flex-end" flexDirection="column">
				<ascii-font font="tiny" text="Ralph" />
				<text
					attributes={daemonOnline ? TextAttributes.BOLD : TextAttributes.DIM}
				>
					{statusLine}
				</text>
				<text attributes={TextAttributes.DIM}>{jobLine}</text>
				<text attributes={TextAttributes.DIM}>
					Submit job: ralph daemon submit "prompt"
				</text>
			</box>
		</box>
	);
}

export async function runTui(): Promise<void> {
	const renderer = await createCliRenderer();

	let daemonOnline = false;
	let statusLine = "Daemon offline — failed to auto-start";
	let jobLine = "No daemon status available";

	daemonOnline = await ensureDaemonRunning();

	if (daemonOnline) {
		const daemonHealth = await health();
		const jobs = await listJobs();
		statusLine = `Daemon online (pid ${daemonHealth.pid})`;
		jobLine = `${jobs.jobs.length} total jobs, ${daemonHealth.running} running, ${daemonHealth.queued} queued`;
	}

	createRoot(renderer).render(
		<App
			daemonOnline={daemonOnline}
			statusLine={statusLine}
			jobLine={jobLine}
		/>,
	);
}

if (import.meta.main) {
	void runTui();
}
