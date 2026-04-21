import { daemon, ensureDaemonRunning } from "@techatnyu/ralphd";

const DEFAULT_TIMEOUT_MS = 10_000;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type CommandRunner = (
	command: string,
	args: string[],
	options?: { timeoutMs?: number },
) => Promise<CommandResult>;

interface OnboardingDependencies {
	commandRunner: CommandRunner;
	daemonClient: Pick<typeof daemon, "health" | "isDaemonRunning">;
	ensureDaemon: typeof ensureDaemonRunning;
}

export interface RunOnboardingChecksOptions {
	autoStartDaemon?: boolean;
	commandRunner?: CommandRunner;
	daemonClient?: Pick<typeof daemon, "health" | "isDaemonRunning">;
	ensureDaemon?: typeof ensureDaemonRunning;
}

async function runCommand(
	command: string,
	args: string[],
	options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
	const proc = Bun.spawn([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});

	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => proc.kill(), timeout);

	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);

		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

export interface OnboardingCheck {
	label: string;
	ok: boolean;
	message?: string;
}

export interface OnboardingResult {
	ok: boolean;
	checks: OnboardingCheck[];
}

async function checkOpencodeInstalled(
	commandRunner: CommandRunner,
): Promise<OnboardingCheck> {
	try {
		const result = await commandRunner("opencode", ["--version"]);
		if (result.exitCode === 0) {
			return { label: "OpenCode installed", ok: true };
		}
		return {
			label: "OpenCode installed",
			ok: false,
			message:
				"`opencode` exited with a non-zero status. Reinstall with: npm install -g opencode",
		};
	} catch {
		return {
			label: "OpenCode installed",
			ok: false,
			message:
				"`opencode` is not installed or not in PATH. Install it with: npm install -g opencode",
		};
	}
}

async function checkOpencodeAuth(
	commandRunner: CommandRunner,
): Promise<OnboardingCheck> {
	try {
		const result = await commandRunner("opencode", ["auth", "list"]);
		if (result.exitCode !== 0) {
			return {
				label: "OpenCode authenticated",
				ok: false,
				message:
					"No auth configured. Run `opencode auth login` in your terminal first.",
			};
		}
		const output = (result.stdout + result.stderr).trim();
		if (output.length > 0) {
			return { label: "OpenCode authenticated", ok: true };
		}
		return {
			label: "OpenCode authenticated",
			ok: false,
			message:
				"No auth configured. Run `opencode auth login` in your terminal first.",
		};
	} catch {
		return {
			label: "OpenCode authenticated",
			ok: false,
			message: "Could not verify auth. Is `opencode` installed?",
		};
	}
}

async function checkDaemonRunning(
	dependencies: OnboardingDependencies,
	autoStartDaemon: boolean,
): Promise<OnboardingCheck> {
	try {
		const ready = autoStartDaemon
			? await dependencies.ensureDaemon()
			: await dependencies.daemonClient.isDaemonRunning();
		if (ready) {
			const health = await dependencies.daemonClient.health();
			return {
				label: "Daemon running",
				ok: true,
				message: `pid ${health.pid}, uptime ${health.uptimeSeconds}s`,
			};
		}
		return {
			label: "Daemon running",
			ok: false,
			message: autoStartDaemon
				? "ralphd could not be started. Run `ralph daemon start` manually."
				: "ralphd is not running. Run `ralph daemon start` manually.",
		};
	} catch {
		return {
			label: "Daemon running",
			ok: false,
			message: autoStartDaemon
				? "ralphd could not be reached. Run `ralph daemon start` manually."
				: "ralphd could not be reached. Run `ralph daemon start` manually.",
		};
	}
}

export async function runOnboardingChecks(
	options: RunOnboardingChecksOptions = {},
): Promise<OnboardingResult> {
	const dependencies: OnboardingDependencies = {
		commandRunner: options.commandRunner ?? runCommand,
		daemonClient: options.daemonClient ?? daemon,
		ensureDaemon: options.ensureDaemon ?? ensureDaemonRunning,
	};
	const autoStartDaemon = options.autoStartDaemon ?? true;
	const opencodeInstalled = await checkOpencodeInstalled(
		dependencies.commandRunner,
	);

	// Only check auth if opencode is installed
	const opencodeAuth = opencodeInstalled.ok
		? await checkOpencodeAuth(dependencies.commandRunner)
		: {
				label: "OpenCode authenticated",
				ok: false,
				message: "Skipped (opencode not installed)",
			};

	const daemonRunning = await checkDaemonRunning(dependencies, autoStartDaemon);

	const checks = [opencodeInstalled, opencodeAuth, daemonRunning];
	return {
		ok: checks.every((check) => check.ok),
		checks,
	};
}
