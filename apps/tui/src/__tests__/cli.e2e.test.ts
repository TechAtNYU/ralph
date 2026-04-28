import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(
	args: string[],
	homeDir: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

	return { stdout, stderr, exitCode };
}

async function runCliOrThrow(
	args: string[],
	homeDir: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const result = await runCli(args, homeDir);
	if (result.exitCode !== 0) {
		throw new Error(
			`cli failed (${args.join(" ")}):\n${result.stdout}\n${result.stderr}`.trim(),
		);
	}
	return result;
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

		await runCliOrThrow(["daemon", "start"], tempHome);
		const firstHealth = await runCliOrThrow(["daemon", "health"], tempHome);
		const secondStart = await runCliOrThrow(["daemon", "start"], tempHome);
		const secondHealth = await runCliOrThrow(["daemon", "health"], tempHome);

		const firstPid = JSON.parse(firstHealth.stdout) as { pid: number };
		const secondPid = JSON.parse(secondHealth.stdout) as { pid: number };

		expect(firstPid.pid).toBeGreaterThan(0);
		expect(secondPid.pid).toBe(firstPid.pid);
		expect(secondStart.stdout).toContain("already running");
	});

	test("version flag prints the package version", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "ralph-cli-version-"));
		const result = await runCliOrThrow(["--version"], tempHome);
		expect(result.stdout).toContain("ralph v0.0.1");
	});

	test("help command alias prints root help", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "ralph-cli-help-"));
		const result = await runCliOrThrow(["help"], tempHome);
		expect(result.stdout).toContain("Coding agent orchestration TUI and CLI");
		expect(result.stdout).toContain("setup");
	});

	test("daemon start supports json output", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "ralph-cli-json-"));
		const result = await runCliOrThrow(["daemon", "start", "--json"], tempHome);
		const parsed = JSON.parse(result.stdout) as {
			ok: boolean;
			health: { pid: number };
		};

		expect(parsed.ok).toBe(true);
		expect(parsed.health.pid).toBeGreaterThan(0);
	});

	test("model get returns json when requested", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "ralph-cli-model-"));
		await runCliOrThrow(
			["model", "set", "anthropic/claude-sonnet-4-5", "--json"],
			tempHome,
		);

		const result = await runCliOrThrow(["model", "get", "--json"], tempHome);
		expect(JSON.parse(result.stdout)).toEqual({
			model: "anthropic/claude-sonnet-4-5",
		});
	});

	test("typoed commands show autocomplete suggestions", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "ralph-cli-typo-"));
		const result = await runCli(["deamon"], tempHome);
		const combined = `${result.stdout}\n${result.stderr}`;

		expect(result.exitCode).toBeGreaterThan(0);
		expect(combined).toContain('Did you mean "daemon"');
		expect(combined).not.toContain("TypeError");
	}, 10_000);
});
