import { Crust } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";
import {
	daemon,
	type JobState,
	runForegroundDaemon,
	startDetached,
	stopDaemon,
	waitUntilReady,
} from "@techatnyu/ralphd";
import { runTui } from "./index";
import { parseModelRef, ralphStore, setModelAndRecent } from "./store";

async function requireDaemon(): Promise<void> {
	const running = await daemon.isDaemonRunning();
	if (!running) {
		throw new Error("ralphd is not running. Start it with: ralph daemon start");
	}
}

function withDaemon<T>(
	handler: (ctx: T) => void | Promise<void>,
): (ctx: T) => Promise<void> {
	return async (ctx: T) => {
		await requireDaemon();
		await handler(ctx);
	};
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

const cli = new Crust("ralph")
	.meta({ description: "Coding agent orchestration TUI" })
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

						await startDetached();
						const ok = await waitUntilReady();
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
				cmd.meta({ description: "Show daemon health status" }).run(
					withDaemon(async () => {
						printJson(await daemon.health());
					}),
				),
			)
			.command("submit", (cmd) =>
				cmd
					.meta({ description: "Submit a new job" })
					.args([
						{
							name: "prompt",
							type: "string",
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
					.run(
						withDaemon(async ({ args, flags }) => {
							const prompt = args.prompt.join(" ").trim();
							const stored = await ralphStore.read();
							const model = parseModelRef(stored.model);
							const result = await daemon.submitJob({
								instanceId: flags.instance,
								session: flags.session
									? { type: "existing", sessionId: flags.session }
									: { type: "new" },
								task: {
									type: "prompt",
									prompt,
									model,
								},
							});
							printJson(result);
						}),
					),
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
					.run(
						withDaemon(async ({ flags }) => {
							printJson(
								await daemon.listJobs({
									instanceId: flags.instance,
									state: flags.state as JobState,
								}),
							);
						}),
					),
			)
			.command("get", (cmd) =>
				cmd
					.meta({ description: "Get details of a specific job" })
					.args([
						{
							name: "jobId",
							type: "string",
							required: true,
							description: "The job ID",
						},
					])
					.run(
						withDaemon(async ({ args }) => {
							printJson(await daemon.getJob(args.jobId));
						}),
					),
			)
			.command("cancel", (cmd) =>
				cmd
					.meta({ description: "Cancel a job" })
					.args([
						{
							name: "jobId",
							type: "string",
							required: true,
							description: "The job ID",
						},
					])
					.run(
						withDaemon(async ({ args }) => {
							printJson(await daemon.cancelJob(args.jobId));
						}),
					),
			)
			.command("instance", (instanceCommand) =>
				instanceCommand
					.meta({ description: "Manage daemon instances" })
					.command("create", (cmd) =>
						cmd
							.meta({ description: "Create a managed instance" })
							.args([
								{
									name: "name",
									type: "string",
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
							.run(
								withDaemon(async ({ args, flags }) => {
									printJson(
										await daemon.createInstance({
											name: args.name,
											directory: flags.directory,
											maxConcurrency: flags["max-concurrency"],
										}),
									);
								}),
							),
					)
					.command("list", (cmd) =>
						cmd.meta({ description: "List registered instances" }).run(
							withDaemon(async () => {
								printJson(await daemon.listInstances());
							}),
						),
					)
					.command("get", (cmd) =>
						cmd
							.meta({ description: "Get a registered instance" })
							.args([
								{
									name: "instanceId",
									type: "string",
									required: true,
									description: "Instance ID",
								},
							])
							.run(
								withDaemon(async ({ args }) => {
									printJson(await daemon.getInstance(args.instanceId));
								}),
							),
					)
					.command("start", (cmd) =>
						cmd
							.meta({ description: "Start an instance" })
							.args([
								{
									name: "instanceId",
									type: "string",
									required: true,
									description: "Instance ID",
								},
							])
							.run(
								withDaemon(async ({ args }) => {
									printJson(await daemon.startInstance(args.instanceId));
								}),
							),
					)
					.command("stop", (cmd) =>
						cmd
							.meta({ description: "Stop an instance" })
							.args([
								{
									name: "instanceId",
									type: "string",
									required: true,
									description: "Instance ID",
								},
							])
							.run(
								withDaemon(async ({ args }) => {
									printJson(await daemon.stopInstance(args.instanceId));
								}),
							),
					)
					.command("remove", (cmd) =>
						cmd
							.meta({ description: "Remove an instance" })
							.args([
								{
									name: "instanceId",
									type: "string",
									required: true,
									description: "Instance ID",
								},
							])
							.run(
								withDaemon(async ({ args }) => {
									printJson(await daemon.removeInstance(args.instanceId));
								}),
							),
					),
			),
	)
	.command("model", (modelCommand) =>
		modelCommand
			.meta({ description: "Manage model selection" })
			.command("set", (cmd) =>
				cmd
					.meta({ description: "Set the active model" })
					.args([
						{
							name: "model",
							type: "string",
							required: true,
							description:
								"Model in provider/model format (e.g. anthropic/claude-sonnet-4-5)",
						},
					])
					.run(async ({ args }) => {
						const parsed = parseModelRef(args.model);
						if (!parsed) {
							throw new Error(
								"Invalid model format. Use provider/model (e.g. anthropic/claude-sonnet-4-5)",
							);
						}
						await setModelAndRecent(args.model);
						console.log(`Model set to: ${args.model}`);
					}),
			)
			.command("get", (cmd) =>
				cmd.meta({ description: "Show the active model" }).run(async () => {
					const { model } = await ralphStore.read();
					console.log(model || "No model set (using SDK default)");
				}),
			),
	);

await cli.execute();
