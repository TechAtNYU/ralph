import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { health, isDaemonRunning, listJobs } from "./daemon/client";

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
					Submit job: bun run daemon:ctl submit "prompt"
				</text>
			</box>
		</box>
	);
}

const renderer = await createCliRenderer();

let daemonOnline = false;
let statusLine = "Daemon offline. Start it with: bun run daemon";
let jobLine = "No daemon status available";

if (await isDaemonRunning()) {
	daemonOnline = true;
	const daemonHealth = await health();
	const jobs = await listJobs();
	statusLine = `Daemon online (pid ${daemonHealth.pid})`;
	jobLine = `${jobs.jobs.length} total jobs, ${daemonHealth.running} running, ${daemonHealth.queued} queued`;
}

createRoot(renderer).render(
	<App daemonOnline={daemonOnline} statusLine={statusLine} jobLine={jobLine} />,
);
