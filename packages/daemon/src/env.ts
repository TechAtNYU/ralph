import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_DAEMON_MAX_CONCURRENCY = 4;

export interface DaemonPaths {
	ralphHome: string;
	socketPath: string;
	statePath: string;
}

export interface DaemonRuntimeEnv extends DaemonPaths {
	maxConcurrency: number;
}

export interface DaemonLauncherEnv {
	daemonBinOverride?: string;
}

function readOptionalTrimmed(
	env: NodeJS.ProcessEnv,
	key: string,
): string | undefined {
	const value = env[key]?.trim();
	return value ? value : undefined;
}

function readPositiveInteger(
	env: NodeJS.ProcessEnv,
	key: string,
	defaultValue: number,
): number {
	const raw = readOptionalTrimmed(env, key);
	if (!raw) {
		return defaultValue;
	}

	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${key} must be a positive integer`);
	}

	return value;
}

export function resolveDaemonPaths(
	env: NodeJS.ProcessEnv = process.env,
): DaemonPaths {
	const ralphHome =
		readOptionalTrimmed(env, "RALPH_HOME") ?? join(homedir(), ".ralph");

	return {
		ralphHome,
		socketPath: join(ralphHome, "ralphd.sock"),
		statePath: join(ralphHome, "state.json"),
	};
}

export function resolveDaemonRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): DaemonRuntimeEnv {
	return {
		...resolveDaemonPaths(env),
		maxConcurrency: readPositiveInteger(
			env,
			"RALPHD_MAX_CONCURRENCY",
			DEFAULT_DAEMON_MAX_CONCURRENCY,
		),
	};
}

export function resolveDaemonLauncherEnv(
	env: NodeJS.ProcessEnv = process.env,
): DaemonLauncherEnv {
	return {
		daemonBinOverride: readOptionalTrimmed(env, "RALPHD_BIN"),
	};
}

const defaultPaths = resolveDaemonPaths();

export const RALPH_HOME = defaultPaths.ralphHome;
export const SOCKET_PATH = defaultPaths.socketPath;
export const STATE_PATH = defaultPaths.statePath;
