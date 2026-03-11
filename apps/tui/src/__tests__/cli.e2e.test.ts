import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(
	args: string[],
	homeDir: string,
): Promise<{ stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
		cwd: join(import.meta.dir, "..", ".."),
		env: {
			...process.env,
			HOME: homeDir,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`cli failed (${args.join(" ")}):\n${stdout}\n${stderr}`.trim(),
		);
	}

	return { stdout, stderr };
}

describe("cli daemon lifecycle", () => {
	let tempHome: string | undefined;

	afterEach(async () => {
		if (!tempHome) {
			return;
		}

		try {
			await runCli(["daemon", "stop"], tempHome);
		} catch {}
		await rm(tempHome, { recursive: true, force: true });
		tempHome = undefined;
	});

	test("daemon start is idempotent and health stays on the same pid", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "ralph-cli-e2e-"));

		await runCli(["daemon", "start"], tempHome);
		const firstHealth = await runCli(["daemon", "health"], tempHome);
		const secondStart = await runCli(["daemon", "start"], tempHome);
		const secondHealth = await runCli(["daemon", "health"], tempHome);

		const firstPid = JSON.parse(firstHealth.stdout) as { pid: number };
		const secondPid = JSON.parse(secondHealth.stdout) as { pid: number };

		expect(firstPid.pid).toBeGreaterThan(0);
		expect(secondPid.pid).toBe(firstPid.pid);
		expect(secondStart.stdout).toContain("already running");
	});
});
