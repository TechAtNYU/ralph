import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";

import { daemon } from "./client";

export interface DaemonLaunchSpec {
	command: string;
	args: string[];
	daemonPath: string;
	mode: "override" | "packaged" | "source";
}

interface EnsureDaemonRunningOptions {
	allowSourceAutostart?: boolean;
}

interface ResolveDaemonLaunchSpecOptions {
	env?: NodeJS.ProcessEnv;
	execPath?: string;
	sourceDir?: string;
}

function isSourceModeExecution(execPath: string): boolean {
	const pathApi = execPath.includes("\\") ? win32 : posix;
	const executable = pathApi.basename(execPath).toLowerCase();
	return (
		executable === "bun" ||
		executable === "bunx" ||
		executable === "bun.exe" ||
		executable === "bunx.exe"
	);
}

export function resolveSiblingDaemonPath(execPath: string = process.execPath) {
	const pathApi = execPath.includes("\\") ? win32 : posix;
	const suffix =
		pathApi.extname(execPath).toLowerCase() === ".exe" ? ".exe" : "";
	return pathApi.join(pathApi.dirname(execPath), `ralphd${suffix}`);
}

export function resolveDaemonLaunchSpec(
	options: ResolveDaemonLaunchSpecOptions = {},
): DaemonLaunchSpec {
	const env = options.env ?? process.env;
	const execPath = options.execPath ?? process.execPath;
	const sourceDir = options.sourceDir ?? import.meta.dir;
	const override = env.RALPHD_BIN?.trim();
	if (override) {
		return {
			mode: "override",
			command: override,
			args: [],
			daemonPath: override,
		};
	}

	if (!isSourceModeExecution(execPath)) {
		const daemonPath = resolveSiblingDaemonPath(execPath);
		return {
			mode: "packaged",
			command: daemonPath,
			args: [],
			daemonPath,
		};
	}

	const daemonPath = join(sourceDir, "bin", "ralphd.ts");
	return {
		mode: "source",
		command: execPath,
		args: ["run", daemonPath],
		daemonPath,
	};
}

export function shouldAutoStartDaemon(
	options: ResolveDaemonLaunchSpecOptions = {},
): boolean {
	return resolveDaemonLaunchSpec(options).mode !== "source";
}

async function assertDaemonBinaryExists(
	launch: DaemonLaunchSpec,
): Promise<void> {
	if (launch.mode === "source") {
		return;
	}
	await access(launch.daemonPath);
}

export async function runForegroundDaemon(): Promise<void> {
	const launch = resolveDaemonLaunchSpec();
	await assertDaemonBinaryExists(launch);

	await new Promise<void>((resolveRun, rejectRun) => {
		const child = spawn(launch.command, launch.args, {
			stdio: "inherit",
			windowsHide: true,
		});

		child.once("error", rejectRun);
		child.once("exit", (code, signal) => {
			if (signal) {
				process.kill(process.pid, signal);
				return;
			}
			if ((code ?? 0) !== 0) {
				rejectRun(new Error(`ralphd exited with code ${code ?? 1}`));
				return;
			}
			resolveRun();
		});
	});
}

export async function startDetached(): Promise<void> {
	const launch = resolveDaemonLaunchSpec();
	await assertDaemonBinaryExists(launch);

	await new Promise<void>((resolveStart, rejectStart) => {
		const child = spawn(launch.command, launch.args, {
			stdio: "ignore",
			detached: true,
			windowsHide: true,
			cwd:
				launch.mode === "source" ? dirname(launch.daemonPath) : process.cwd(),
		});

		child.once("error", rejectStart);
		child.once("spawn", () => {
			child.unref();
			resolveStart();
		});
	});
}

/**
 * Poll until the daemon is reachable, up to `timeoutMs` milliseconds.
 */
export async function waitUntilReady(timeoutMs = 3000): Promise<boolean> {
	const interval = 100;
	const maxAttempts = Math.ceil(timeoutMs / interval);
	for (let i = 0; i < maxAttempts; i += 1) {
		await Bun.sleep(interval);
		if (await daemon.isDaemonRunning()) {
			return true;
		}
	}
	return false;
}

/**
 * Ensure the daemon is running. If not, start it and wait for readiness.
 * Returns true if the daemon is online.
 */
export async function ensureDaemonRunning(
	options: EnsureDaemonRunningOptions = {},
): Promise<boolean> {
	if (await daemon.isDaemonRunning()) {
		return true;
	}

	if (!options.allowSourceAutostart && !shouldAutoStartDaemon()) {
		return waitUntilReady();
	}

	try {
		await startDetached();
	} catch {
		return false;
	}

	return waitUntilReady();
}

/**
 * Gracefully stop the daemon via the shutdown RPC.
 */
export async function stopDaemon(): Promise<void> {
	if (!(await daemon.isDaemonRunning())) {
		throw new Error("ralphd is not running");
	}
	await daemon.shutdown();
}
