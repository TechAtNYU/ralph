import { Crust } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";

import { daemon } from "@techatnyu/ralphd/client";
import {
	ensureDaemonRunning,
	runForegroundDaemon,
	stopDaemon,
} from "@techatnyu/ralphd/launcher";
import { JobState } from "@techatnyu/ralphd/protocol";
import { runTui } from "./index";

async function requireDaemon(): Promise<void> {
	const running = await daemon.isDaemonRunning();
	if (!running) {
		throw new Error("ralphd is not running. Start it with: ralph daemon start");
	}
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parseJobState(value: string | undefined) {
	if (!value) {
		return undefined;
	}
	const parsed = JobState.safeParse(value);
	if (!parsed.success) {
		throw new Error(`invalid job state: ${value}`);
	}
	return parsed.data;
}

const cli = new Crust("ralph")
	.meta({ description: "Ralph — AI loop runner" })
	.use(helpPlugin())
	.run(async () => {
		await runTui();
	})
	.command("daemon", (daemonCommand) =>
		daemonCommand
			.meta({ description: "Manage the background daemon" })
			.command("serve", (cmd) =>
				cmd
					.meta({ description: "Run the daemon in the foreground" })
					.run(async () => {
						await runForegroundDaemon();
					}),
			)
			.command("start", (cmd) =>
				cmd
					.meta({ description: "Start the daemon in the background" })
					.run(async () => {
						if (await daemon.isDaemonRunning()) {
							const result = await daemon.health();
							console.log(
								`ralphd is already running (pid ${result.pid}, uptime ${result.uptimeSeconds}s)`,
							);
							return;
						}

						const ok = await ensureDaemonRunning();
						if (!ok) {
							throw new Error("Failed to start ralphd");
						}

						const result = await daemon.health();
						console.log(`ralphd started (pid ${result.pid})`);
					}),
			)
			.command("stop", (cmd) =>
				cmd.meta({ description: "Stop the running daemon" }).run(async () => {
					await stopDaemon();
					console.log("ralphd stopped");
				}),
			)
			.command("health", (cmd) =>
				cmd.meta({ description: "Show daemon health status" }).run(async () => {
					await requireDaemon();
					printJson(await daemon.health());
				}),
			)
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
					.flags({
						instance: {
							type: "string",
							required: true,
							description: "Target instance ID",
						},
						session: {
							type: "string",
							description: "Existing session ID",
						},
					})
					.run(async ({ args, flags }) => {
						await requireDaemon();
						const prompt = args.prompt.join(" ").trim();
						const result = await daemon.submitJob({
							instanceId: flags.instance,
							session: flags.session
								? { type: "existing", sessionId: flags.session }
								: { type: "new" },
							task: {
								type: "prompt",
								prompt,
							},
						});
						printJson(result);
					}),
			)
			.command("list", (cmd) =>
				cmd
					.meta({ description: "List all jobs" })
					.flags({
						instance: {
							type: "string",
							description: "Filter by instance ID",
						},
						state: {
							type: "string",
							description: "Filter by job state",
						},
					})
					.run(async ({ flags }) => {
						await requireDaemon();
						printJson(
							await daemon.listJobs({
								instanceId: flags.instance,
								state: parseJobState(flags.state),
							}),
						);
					}),
			)
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
						printJson(await daemon.getJob(args.jobId));
					}),
			)
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
						printJson(await daemon.cancelJob(args.jobId));
					}),
			)
			.command("instance", (instanceCommand) =>
				instanceCommand
					.meta({ description: "Manage OpenCode instances" })
					.command("create", (cmd) =>
						cmd
							.meta({ description: "Create a managed instance" })
							.args([
								{
									name: "name",
									type: "string" as const,
									required: true,
									description: "Instance name",
								},
							])
							.flags({
								directory: {
									type: "string",
									required: true,
									description: "Workspace directory",
								},
								"max-concurrency": {
									type: "number",
									description: "Per-instance concurrency",
								},
							})
							.run(async ({ args, flags }) => {
								await requireDaemon();
								printJson(
									await daemon.createInstance({
										name: args.name,
										directory: flags.directory,
										maxConcurrency: flags["max-concurrency"],
									}),
								);
							}),
					)
					.command("list", (cmd) =>
						cmd
							.meta({ description: "List registered instances" })
							.run(async () => {
								await requireDaemon();
								printJson(await daemon.listInstances());
							}),
					)
					.command("get", (cmd) =>
						cmd
							.meta({ description: "Get a registered instance" })
							.args([
								{
									name: "instanceId",
									type: "string" as const,
									required: true,
									description: "Instance ID",
								},
							])
							.run(async ({ args }) => {
								await requireDaemon();
								printJson(await daemon.getInstance(args.instanceId));
							}),
					)
					.command("start", (cmd) =>
						cmd
							.meta({ description: "Start an instance" })
							.args([
								{
									name: "instanceId",
									type: "string" as const,
									required: true,
									description: "Instance ID",
								},
							])
							.run(async ({ args }) => {
								await requireDaemon();
								printJson(await daemon.startInstance(args.instanceId));
							}),
					)
					.command("stop", (cmd) =>
						cmd
							.meta({ description: "Stop an instance" })
							.args([
								{
									name: "instanceId",
									type: "string" as const,
									required: true,
									description: "Instance ID",
								},
							])
							.run(async ({ args }) => {
								await requireDaemon();
								printJson(await daemon.stopInstance(args.instanceId));
							}),
					)
					.command("remove", (cmd) =>
						cmd
							.meta({ description: "Remove an instance" })
							.args([
								{
									name: "instanceId",
									type: "string" as const,
									required: true,
									description: "Instance ID",
								},
							])
							.run(async ({ args }) => {
								await requireDaemon();
								printJson(await daemon.removeInstance(args.instanceId));
							}),
					),
			),
	);

await cli.execute();
