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

			const start = Bun.spawn(
				[installedBinPath(installDir, "ralph"), "daemon", "start"],
				{
					cwd: installDir,
					env,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(await start.exited).toBe(0);

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

			await access(installedBinPath(installDir, "ralphd"));
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
