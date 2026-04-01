const DEFAULT_TIMEOUT_MS = 10_000;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

async function runCommand(
	command: string,
	args: string[],
	options: { inheritStdio?: boolean; timeoutMs?: number } = {},
): Promise<CommandResult> {
	const proc = Bun.spawn([command, ...args], {
		stdout: options.inheritStdio ? "inherit" : "pipe",
		stderr: options.inheritStdio ? "inherit" : "pipe",
		stdin: options.inheritStdio ? "inherit" : "ignore",
	});

	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => proc.kill(), timeout);

	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			options.inheritStdio
				? Promise.resolve("")
				: new Response(proc.stdout).text(),
			options.inheritStdio
				? Promise.resolve("")
				: new Response(proc.stderr).text(),
		]);

		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

export async function isOpencodeInstalled(): Promise<boolean> {
	try {
		const result = await runCommand("opencode", ["--version"]);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export async function hasOpencodeAuth(): Promise<boolean> {
	try {
		const result = await runCommand("opencode", ["auth", "list"]);
		if (result.exitCode !== 0) {
			return false;
		}
		const output = (result.stdout + result.stderr).trim();
		return output.length > 0;
	} catch {
		return false;
	}
}

export async function loginOpencode(): Promise<boolean> {
	try {
		const result = await runCommand("opencode", ["auth", "login"], {
			inheritStdio: true,
			timeoutMs: 5 * 60_000,
		});
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export type OnboardingResult = { ok: true } | { ok: false; message: string };

export async function ensureOpencodeReady(): Promise<OnboardingResult> {
	const installed = await isOpencodeInstalled();
	if (!installed) {
		return {
			ok: false,
			message:
				"`opencode` is not installed or not in PATH. Install it with: npm install -g opencode",
		};
	}

	const authed = await hasOpencodeAuth();
	if (authed) {
		return { ok: true };
	}

	console.log("No OpenCode auth found. Starting `opencode auth login`...");
	const loggedIn = await loginOpencode();

	if (!loggedIn) {
		return {
			ok: false,
			message: "OpenCode login did not complete successfully.",
		};
	}

	const authedAfterLogin = await hasOpencodeAuth();
	if (!authedAfterLogin) {
		return {
			ok: false,
			message: "OpenCode login finished, but no auth was detected afterward.",
		};
	}

	return { ok: true };
}
