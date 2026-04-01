import { daemon, ensureDaemonRunning } from "@techatnyu/ralphd";

const DEFAULT_TIMEOUT_MS = 10_000;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

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

async function checkOpencodeInstalled(): Promise<OnboardingCheck> {
	try {
		const result = await runCommand("opencode", ["--version"]);
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

async function checkOpencodeAuth(): Promise<OnboardingCheck> {
	try {
		const result = await runCommand("opencode", ["auth", "list"]);
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

async function checkDaemonRunning(): Promise<OnboardingCheck> {
	try {
		const ready = await ensureDaemonRunning();
		if (ready) {
			const health = await daemon.health();
			return {
				label: "Daemon running",
				ok: true,
				message: `pid ${health.pid}, uptime ${health.uptimeSeconds}s`,
			};
		}
		return {
			label: "Daemon running",
			ok: false,
			message:
				"ralphd could not be started. Run `ralph daemon start` manually.",
		};
	} catch {
		return {
			label: "Daemon running",
			ok: false,
			message:
				"ralphd could not be reached. Run `ralph daemon start` manually.",
		};
	}
}

export async function runOnboardingChecks(): Promise<OnboardingResult> {
	const opencodeInstalled = await checkOpencodeInstalled();

	// Only check auth if opencode is installed
	const opencodeAuth = opencodeInstalled.ok
		? await checkOpencodeAuth()
		: {
				label: "OpenCode authenticated",
				ok: false,
				message: "Skipped (opencode not installed)",
			};

	const daemonRunning = await checkDaemonRunning();

	const checks = [opencodeInstalled, opencodeAuth, daemonRunning];
	return {
		ok: checks.every((check) => check.ok),
		checks,
	};
}
