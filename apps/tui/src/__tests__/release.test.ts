import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildBinaries,
	getBinaryFilename,
	getCurrentTarget,
	getTargetSpec,
	SUPPORTED_TARGETS,
	type SupportedTarget,
	stageDistribution,
} from "../../../../scripts/release/shared";

async function makeFakeCompiledOutputs(rootDir: string) {
	for (const target of SUPPORTED_TARGETS) {
		const spec = getTargetSpec(target);
		const dir = join(rootDir, target);
		await mkdir(dir, { recursive: true });
		await Bun.write(
			join(dir, getBinaryFilename("ralph", spec)),
			`fake-${target}-ralph`,
		);
		await Bun.write(
			join(dir, getBinaryFilename("ralphd", spec)),
			`fake-${target}-ralphd`,
		);
	}
}

function installedBinPath(projectDir: string, binaryName: "ralph" | "ralphd") {
	return process.platform === "win32"
		? join(projectDir, "node_modules", ".bin", `${binaryName}.cmd`)
		: join(projectDir, "node_modules", ".bin", binaryName);
}

async function waitForDaemonHealth(
	command: string,
	installDir: string,
	env: NodeJS.ProcessEnv,
	timeoutMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const proc = Bun.spawn([command, "daemon", "health"], {
			cwd: installDir,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		if ((await proc.exited) === 0) {
			return;
		}
		await Bun.sleep(200);
	}

	throw new Error("timed out waiting for daemon health");
}

describe("release packaging", () => {
	test("stages root and target packages with both binaries", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "ralph-stage-"));
		const compiledDir = join(tempDir, "compiled");
		const stageDir = join(tempDir, "npm");

		try {
			await makeFakeCompiledOutputs(compiledDir);
			const manifest = await stageDistribution({
				compiledDir,
				stageDir,
				version: "0.0.0-test",
			});

			expect(manifest.targets).toHaveLength(6);
			expect(manifest.publishOrder).toEqual([
				"linux-x64",
				"linux-arm64",
				"windows-x64",
				"windows-arm64",
				"darwin-x64",
				"darwin-arm64",
				"root",
			]);

			for (const target of SUPPORTED_TARGETS) {
				const spec = getTargetSpec(target);
				await access(
					join(
						stageDir,
						spec.stageDirName,
						"bin",
						getBinaryFilename("ralph", spec),
					),
				);
				await access(
					join(
						stageDir,
						spec.stageDirName,
						"bin",
						getBinaryFilename("ralphd", spec),
					),
				);
			}

			const rootPackageJson = JSON.parse(
				await readFile(join(stageDir, "root", "package.json"), "utf8"),
			) as { optionalDependencies: Record<string, string> };
			expect(Object.keys(rootPackageJson.optionalDependencies)).toHaveLength(6);

			const launcher = await readFile(
				join(stageDir, "root", "bin", "ralph"),
				"utf8",
			);
			expect(launcher).toContain("ralph-linux-x64");
			expect(launcher).toContain("ralph-darwin-arm64");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("staged install exposes ralph and ralphd and they work together", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "ralph-smoke-"));
		const compiledDir = join(tempDir, "compiled");
		const stageDir = join(tempDir, "npm");
		const installDir = join(tempDir, "install");
		const homeDir = join(tempDir, "home");
		const currentTarget: SupportedTarget = getCurrentTarget();
		const currentSpec = getTargetSpec(currentTarget);

		try {
			await buildBinaries({
				targets: [currentTarget],
				outDir: compiledDir,
				version: "0.0.0-smoke",
			});
			await stageDistribution({
				targets: [currentTarget],
				compiledDir,
				stageDir,
				version: "0.0.0-smoke",
			});

			await mkdir(installDir, { recursive: true });
			await mkdir(homeDir, { recursive: true });
			await Bun.write(
				join(installDir, "package.json"),
				JSON.stringify({ name: "ralph-smoke", private: true }),
			);

			const install = Bun.spawn(
				[
					"npm",
					"install",
					join(stageDir, "root"),
					join(stageDir, currentSpec.stageDirName),
				],
				{
					cwd: installDir,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const installExit = await install.exited;
			if (installExit !== 0) {
				throw new Error(
					`npm install failed:\n${await new Response(install.stdout).text()}\n${await new Response(install.stderr).text()}`,
				);
			}

			const env = {
				...process.env,
				HOME: homeDir,
			};

			const help = Bun.spawn(
				[installedBinPath(installDir, "ralph"), "--help"],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(await help.exited).toBe(0);

			const version = Bun.spawn(
				[installedBinPath(installDir, "ralph"), "--version"],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(await version.exited).toBe(0);
			expect(await new Response(version.stdout).text()).toContain(
				"ralph v0.0.0-smoke",
			);

			const daemonVersion = Bun.spawn(
				[installedBinPath(installDir, "ralphd"), "--version"],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(await daemonVersion.exited).toBe(0);
			expect(await new Response(daemonVersion.stdout).text()).toContain(
				"ralphd v0.0.0-smoke",
			);

			const daemonProcess = Bun.spawn(
				[installedBinPath(installDir, "ralphd")],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			await waitForDaemonHealth(
				installedBinPath(installDir, "ralph"),
				installDir,
				env,
			);

			const health = Bun.spawn(
				[installedBinPath(installDir, "ralph"), "daemon", "health"],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(await health.exited).toBe(0);
			expect(await new Response(health.stdout).text()).toContain('"pid"');

			const stop = Bun.spawn(
				[installedBinPath(installDir, "ralph"), "daemon", "stop"],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(await stop.exited).toBe(0);
			expect(await daemonProcess.exited).toBe(0);

			await access(installedBinPath(installDir, "ralphd"));
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}, 20_000);
});
