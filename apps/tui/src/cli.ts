import { Crust } from "@crustjs/core";
import {
	autoCompletePlugin,
	helpPlugin,
	versionPlugin,
} from "@crustjs/plugins";
import { spinner } from "@crustjs/progress";
import { select } from "@crustjs/prompts";
import { commandValidator, flag } from "@crustjs/validate/zod";
import {
	daemon,
	type JobState,
	type ProviderListResult,
	runForegroundDaemon,
	startDetached,
	stopDaemon,
	waitUntilReady,
} from "@techatnyu/ralphd";
import { z } from "zod";
import { runTui } from "./index";
import {
	printJson,
	printOnboardingSummary,
	printProviderList,
	printSetupSummary,
} from "./lib/cli-output";
import { resolveCliVersion } from "./lib/cli-version";
import type { OnboardingResult } from "./lib/onboarding";
import { runOnboardingChecks } from "./lib/onboarding";
import { listConnectedModels } from "./lib/providers";
import { parseModelRef, ralphStore, setModelAndRecent } from "./lib/store";

interface JsonFlags {
	json?: boolean;
}

const ROOT_COMMANDS = new Set([
	"setup",
	"doctor",
	"provider",
	"daemon",
	"model",
]);

interface SetupCommandResult extends OnboardingResult {
	interactive: boolean;
	currentModel?: string;
	selectedModel?: string;
	providerSummary?: {
		connected: number;
		total: number;
	};
	providerError?: string;
}

function jsonFlagDef() {
	return flag(z.boolean().default(false).describe("Print JSON output"));
}

function wantsJson(flags: JsonFlags): boolean {
	return Boolean(flags.json);
}

function isInteractiveSetup(flags: {
	json: boolean;
	"non-interactive": boolean;
}): boolean {
	return (
		!flags.json &&
		!flags["non-interactive"] &&
		Boolean(process.stdin.isTTY) &&
		Boolean(process.stderr.isTTY)
	);
}

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

async function fetchProviders(
	options: { directory?: string; refresh?: boolean },
	json: boolean,
): Promise<ProviderListResult> {
	if (json) {
		return daemon.providerList(options);
	}

	return spinner({
		message: options.refresh
			? "Refreshing providers..."
			: "Loading providers...",
		task: async () => daemon.providerList(options),
	});
}

async function maybeSelectModel(
	providerResult: ProviderListResult,
	interactive: boolean,
): Promise<string | undefined> {
	const models = listConnectedModels(providerResult);
	if (!interactive || models.length === 0) {
		return undefined;
	}

	return select({
		message: "Choose a default model",
		choices: models.map((model) => ({
			label: model.label,
			value: model.ref,
			hint: model.providerId,
		})),
		maxVisible: 12,
	});
}

async function runSetup(flags: {
	json: boolean;
	"non-interactive": boolean;
}): Promise<SetupCommandResult> {
	const interactive = isInteractiveSetup(flags);
	const checks = await runOnboardingChecks({ autoStartDaemon: true });
	const currentStore = await ralphStore.read();
	const result: SetupCommandResult = {
		...checks,
		interactive,
		currentModel: currentStore.model || undefined,
	};

	if (!checks.ok) {
		return result;
	}

	try {
		const providerResult = await fetchProviders({ refresh: true }, flags.json);
		result.providerSummary = {
			connected: providerResult.connected.length,
			total: providerResult.providers.length,
		};

		if (!result.currentModel) {
			const selectedModel = await maybeSelectModel(providerResult, interactive);
			if (selectedModel) {
				await setModelAndRecent(selectedModel);
				result.selectedModel = selectedModel;
				result.currentModel = selectedModel;
			}
		}
	} catch (error) {
		result.providerError =
			error instanceof Error ? error.message : "Failed to refresh providers";
	}

	return result;
}

function printSetupResult(result: SetupCommandResult): void {
	printOnboardingSummary(result, "Ralph Setup");
	printSetupSummary({
		currentModel: result.currentModel,
		providerSummary: result.providerSummary,
		providerError: result.providerError,
	});
	if (result.ok) {
		console.log("Run `ralph` to launch the TUI.");
	}
}

function printModelResult(model: string, flags: JsonFlags): void {
	if (wantsJson(flags)) {
		printJson({ model: model || null });
		return;
	}
	console.log(model || "No model set (using SDK default)");
}

const cliVersion = await resolveCliVersion(
	new URL("../package.json", import.meta.url),
);

export function createRootCli() {
	return new Crust("ralph")
		.meta({ description: "Coding agent orchestration TUI and CLI" })
		.use(versionPlugin(cliVersion))
		.use(autoCompletePlugin({ mode: "help" }))
		.use(helpPlugin())
		.command("setup", (cmd) =>
			cmd
				.meta({ description: "Run guided first-time setup" })
				.flags({
					json: jsonFlagDef(),
					"non-interactive": flag(
						z.boolean().default(false).describe("Skip interactive prompts"),
					),
				})
				.run(
					commandValidator(async ({ flags }) => {
						const result = await runSetup(flags);
						if (flags.json) {
							printJson(result);
						} else {
							printSetupResult(result);
						}

						if (!result.ok) {
							process.exitCode = 1;
						}
					}),
				),
		)
		.command("doctor", (cmd) =>
			cmd
				.meta({ description: "Check local Ralph prerequisites" })
				.flags({
					json: jsonFlagDef(),
				})
				.run(
					commandValidator(async ({ flags }) => {
						const result = await runOnboardingChecks({
							autoStartDaemon: false,
						});
						if (flags.json) {
							printJson(result);
						} else {
							printOnboardingSummary(result, "Ralph Doctor");
						}

						if (!result.ok) {
							process.exitCode = 1;
						}
					}),
				),
		)
		.command("provider", (providerCommand) =>
			providerCommand
				.meta({ description: "Inspect available providers" })
				.command("list", (cmd) =>
					cmd
						.meta({ description: "List configured providers" })
						.flags({
							directory: flag(
								z.string().describe("Workspace directory to query").optional(),
							),
							refresh: flag(
								z
									.boolean()
									.default(false)
									.describe("Refresh provider metadata before listing"),
							),
							json: jsonFlagDef(),
						})
						.run(
							commandValidator(
								withDaemon(async ({ flags }) => {
									const result = await fetchProviders(
										{
											directory: flags.directory,
											refresh: flags.refresh,
										},
										flags.json,
									);
									if (flags.json) {
										printJson(result);
										return;
									}
									printProviderList(result);
								}),
							),
						),
				),
		)
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
						.flags({
							json: {
								type: "boolean",
								description: "Print JSON output",
							},
						})
						.run(async ({ flags }) => {
							if (await daemon.isDaemonRunning()) {
								const result = await daemon.health();
								if (wantsJson(flags)) {
									printJson({ ok: true, alreadyRunning: true, health: result });
									return;
								}
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
							if (wantsJson(flags)) {
								printJson({ ok: true, alreadyRunning: false, health: result });
								return;
							}
							console.log(`ralphd started (pid ${result.pid})`);
						}),
				)
				.command("stop", (cmd) =>
					cmd
						.meta({ description: "Stop the running daemon" })
						.flags({
							json: {
								type: "boolean",
								description: "Print JSON output",
							},
						})
						.run(async ({ flags }) => {
							await stopDaemon();
							if (wantsJson(flags)) {
								printJson({ ok: true });
								return;
							}
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
						.flags({
							json: {
								type: "boolean",
								description: "Print JSON output",
							},
						})
						.run(async ({ args, flags }) => {
							const parsed = parseModelRef(args.model);
							if (!parsed) {
								throw new Error(
									"Invalid model format. Use provider/model (e.g. anthropic/claude-sonnet-4-5)",
								);
							}
							await setModelAndRecent(args.model);
							if (wantsJson(flags)) {
								printJson({ model: args.model });
								return;
							}
							console.log(`Model set to: ${args.model}`);
						}),
				)
				.command("get", (cmd) =>
					cmd
						.meta({ description: "Show the active model" })
						.flags({
							json: {
								type: "boolean",
								description: "Print JSON output",
							},
						})
						.run(async ({ flags }) => {
							const { model } = await ralphStore.read();
							printModelResult(model, flags);
						}),
				),
		);
}

export const app = createRootCli();

export default app;

function normalizeRootArgv(argv: string[]): string[] {
	if (argv.length === 1 && argv[0] === "help") {
		return ["--help"];
	}

	if (argv.length === 1 && argv[0] === "version") {
		return ["--version"];
	}

	return argv;
}

function isUnknownRootCommand(argv: string[]): boolean {
	const first = argv[0];
	return Boolean(
		first &&
			!first.startsWith("-") &&
			first !== "help" &&
			first !== "version" &&
			!ROOT_COMMANDS.has(first),
	);
}

export async function executeCli(argv = Bun.argv.slice(2)): Promise<void> {
	if (argv.length === 0) {
		await runTui();
		return;
	}

	const unknownRootCommand = isUnknownRootCommand(argv);
	await app.execute({ argv: normalizeRootArgv(argv) });
	if (unknownRootCommand && (process.exitCode ?? 0) === 0) {
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await executeCli();
}
