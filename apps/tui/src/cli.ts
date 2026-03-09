import { Crust } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";

import {
	cancelJob,
	getJob,
	health,
	isDaemonRunning,
	listJobs,
	submit,
} from "./daemon/client";
import { ensureDaemonRunning, stopDaemon } from "./daemon/launcher";
import { runDaemonServer } from "./daemon/server";
import { runTui } from "./index";

/**
 * Helper: assert daemon is running before executing a client command.
 */
async function requireDaemon(): Promise<void> {
	const running = await isDaemonRunning();
	if (!running) {
		throw new Error("ralphd is not running. Start it with: ralph daemon start");
	}
}

const cli = new Crust("ralph")
	.meta({ description: "Ralph — AI loop runner" })
	.use(helpPlugin())
	// Default: launch TUI
	.run(async () => {
		await runTui();
	})
	// -- daemon subcommand group --
	.command("daemon", (daemon) =>
		daemon
			.meta({ description: "Manage the background daemon" })
			// ralph daemon serve  (foreground, for debugging / system services)
			.command("serve", (cmd) =>
				cmd
					.meta({ description: "Run the daemon in the foreground" })
					.run(async () => {
						await runDaemonServer();
					}),
			)
			// ralph daemon start  (detached background)
			.command("start", (cmd) =>
				cmd
					.meta({ description: "Start the daemon in the background" })
					.run(async () => {
						if (await isDaemonRunning()) {
							const h = await health();
							console.log(
								`ralphd is already running (pid ${h.pid}, uptime ${h.uptimeSeconds}s)`,
							);
							return;
						}
						const ok = await ensureDaemonRunning();
						if (ok) {
							const h = await health();
							console.log(`ralphd started (pid ${h.pid})`);
						} else {
							throw new Error("Failed to start ralphd");
						}
					}),
			)
			// ralph daemon stop
			.command("stop", (cmd) =>
				cmd.meta({ description: "Stop the running daemon" }).run(async () => {
					await stopDaemon();
					console.log("ralphd stopped");
				}),
			)
			// ralph daemon health
			.command("health", (cmd) =>
				cmd.meta({ description: "Show daemon health status" }).run(async () => {
					await requireDaemon();
					const result = await health();
					console.log(JSON.stringify(result, null, 2));
				}),
			)
			// ralph daemon submit <prompt...>
			.command("submit", (cmd) =>
				cmd
					.meta({ description: "Submit a new job" })
					.args([
						{
							name: "prompt",
							type: "string" as const,
							required: true,
							variadic: true,
							description: "The prompt for the loop job",
						},
					])
					.run(async ({ args }) => {
						await requireDaemon();
						const prompt = args.prompt.join(" ");
						const result = await submit(prompt);
						console.log(JSON.stringify(result, null, 2));
					}),
			)
			// ralph daemon list
			.command("list", (cmd) =>
				cmd.meta({ description: "List all jobs" }).run(async () => {
					await requireDaemon();
					const result = await listJobs();
					console.log(JSON.stringify(result, null, 2));
				}),
			)
			// ralph daemon get <jobId>
			.command("get", (cmd) =>
				cmd
					.meta({ description: "Get details of a specific job" })
					.args([
						{
							name: "jobId",
							type: "string" as const,
							required: true,
							description: "The job ID",
						},
					])
					.run(async ({ args }) => {
						await requireDaemon();
						const result = await getJob(args.jobId);
						console.log(JSON.stringify(result, null, 2));
					}),
			)
			// ralph daemon cancel <jobId>
			.command("cancel", (cmd) =>
				cmd
					.meta({ description: "Cancel a job" })
					.args([
						{
							name: "jobId",
							type: "string" as const,
							required: true,
							description: "The job ID",
						},
					])
					.run(async ({ args }) => {
						await requireDaemon();
						const result = await cancelJob(args.jobId);
						console.log(JSON.stringify(result, null, 2));
					}),
			),
	);

await cli.execute();
