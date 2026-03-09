import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { isDaemonRunning, shutdown } from "./client";

/**
 * Spawn the daemon server as a detached background process.
 * Uses `bun run <server.ts>` so it works identically in dev and prod.
 */
export function startDetached(): void {
	const serverScript = resolve(import.meta.dir, "server.ts");
	const child = spawn("bun", ["run", serverScript], {
		stdio: "ignore",
		detached: true,
	});
	child.unref();
}

/**
 * Poll until the daemon is reachable, up to `timeoutMs` milliseconds.
 */
export async function waitUntilReady(timeoutMs = 3000): Promise<boolean> {
	const interval = 100;
	const maxAttempts = Math.ceil(timeoutMs / interval);
	for (let i = 0; i < maxAttempts; i++) {
		await Bun.sleep(interval);
		if (await isDaemonRunning()) {
			return true;
		}
	}
	return false;
}

/**
 * Ensure the daemon is running. If not, start it and wait for readiness.
 * Returns true if the daemon is online.
 */
export async function ensureDaemonRunning(): Promise<boolean> {
	if (await isDaemonRunning()) {
		return true;
	}
	startDetached();
	return waitUntilReady();
}

/**
 * Gracefully stop the daemon via the shutdown RPC.
 */
export async function stopDaemon(): Promise<void> {
	if (!(await isDaemonRunning())) {
		throw new Error("ralphd is not running");
	}
	await shutdown();
}
