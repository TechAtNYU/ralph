import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const DEFAULT_COMPILED_DIR = join(REPO_ROOT, "dist", "compiled");
export const DEFAULT_STAGE_DIR = join(REPO_ROOT, "dist", "npm");

export const SUPPORTED_TARGETS = [
	"bun-linux-x64",
	"bun-linux-arm64",
	"bun-windows-x64",
	"bun-windows-arm64",
	"bun-darwin-x64",
	"bun-darwin-arm64",
] as const;

export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

export interface TargetSpec {
	target: SupportedTarget;
	packageName: string;
	stageDirName: string;
	os: "linux" | "darwin" | "win32";
	cpu: "x64" | "arm64";
	windows: boolean;
}

export interface BinaryBuildResult {
	target: SupportedTarget;
	outDir: string;
	ralph: string;
	ralphd: string;
}

export interface ReleaseManifest {
	version: string;
	rootPackageName: "@techatnyu/ralph";
	rootDir: "root";
	targets: Array<{
		target: SupportedTarget;
		packageName: string;
		dir: string;
		os: TargetSpec["os"];
		cpu: TargetSpec["cpu"];
	}>;
	publishOrder: string[];
}

export function getTargetSpec(target: SupportedTarget): TargetSpec {
	switch (target) {
		case "bun-linux-x64":
			return {
				target,
				packageName: "@techatnyu/ralph-linux-x64",
				stageDirName: "linux-x64",
				os: "linux",
				cpu: "x64",
				windows: false,
			};
		case "bun-linux-arm64":
			return {
				target,
				packageName: "@techatnyu/ralph-linux-arm64",
				stageDirName: "linux-arm64",
				os: "linux",
				cpu: "arm64",
				windows: false,
			};
		case "bun-windows-x64":
			return {
				target,
				packageName: "@techatnyu/ralph-windows-x64",
				stageDirName: "windows-x64",
				os: "win32",
				cpu: "x64",
				windows: true,
			};
		case "bun-windows-arm64":
			return {
				target,
				packageName: "@techatnyu/ralph-windows-arm64",
				stageDirName: "windows-arm64",
				os: "win32",
				cpu: "arm64",
				windows: true,
			};
		case "bun-darwin-x64":
			return {
				target,
				packageName: "@techatnyu/ralph-darwin-x64",
				stageDirName: "darwin-x64",
				os: "darwin",
				cpu: "x64",
				windows: false,
			};
		case "bun-darwin-arm64":
			return {
				target,
				packageName: "@techatnyu/ralph-darwin-arm64",
				stageDirName: "darwin-arm64",
				os: "darwin",
				cpu: "arm64",
				windows: false,
			};
	}
}

export function getBinaryFilename(
	name: "ralph" | "ralphd",
	spec: TargetSpec,
): string {
	return spec.windows ? `${name}.exe` : name;
}

function rootPackageJsonPath() {
	return join(REPO_ROOT, "apps", "tui", "package.json");
}

export async function getRootPackageVersion(): Promise<string> {
	const raw = await readFile(rootPackageJsonPath(), "utf8");
	const parsed = JSON.parse(raw) as { version?: string };
	return parsed.version ?? "0.0.0";
}

async function runCommand(command: string, args: string[], cwd?: string) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: "inherit",
		});

		child.once("error", reject);
		child.once("exit", (code) => {
			if ((code ?? 0) !== 0) {
				reject(
					new Error(
						`${command} ${args.join(" ")} exited with code ${code ?? 1}`,
					),
				);
				return;
			}
			resolve();
		});
	});
}

function unixLauncher(binaryName: "ralph" | "ralphd") {
	return `#!/usr/bin/env bash
set -e

source="$0"
while [ -L "$source" ]; do
\tlink_dir="$(cd "$(dirname "$source")" && pwd)"
\tsource="$(readlink "$source")"
\t[[ "$source" != /* ]] && source="$link_dir/$source"
done

package_dir="$(cd "$(dirname "$source")/.." && pwd)"
scope_dir="$(cd "$package_dir/.." && pwd)"
platform="$(uname -s)-$(uname -m)"

case "$platform" in
\tLinux-x86_64) package_dir_name="ralph-linux-x64" ;;
\tLinux-aarch64|Linux-arm64) package_dir_name="ralph-linux-arm64" ;;
\tDarwin-x86_64) package_dir_name="ralph-darwin-x64" ;;
\tDarwin-arm64) package_dir_name="ralph-darwin-arm64" ;;
\t*)
\t\techo "[${binaryName}] Unsupported platform: $platform" >&2
\t\texit 1
\t\t;;
esac

bin_path="$scope_dir/$package_dir_name/bin/${binaryName}"
if [ ! -f "$bin_path" ]; then
\techo "[${binaryName}] Missing packaged binary: $bin_path" >&2
\texit 1
fi

if [ ! -x "$bin_path" ]; then
\tchmod +x "$bin_path" 2>/dev/null || true
fi

exec "$bin_path" "$@"
`;
}

function windowsLauncher(binaryName: "ralph" | "ralphd") {
	return `@echo off
setlocal
set "arch=%PROCESSOR_ARCHITECTURE%"
if /I "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "arch=AMD64"
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "arch=ARM64"

if /I "%arch%"=="AMD64" (
\tset "package_dir_name=ralph-windows-x64"
) else if /I "%arch%"=="ARM64" (
\tset "package_dir_name=ralph-windows-arm64"
) else (
\techo [${binaryName}] Unsupported Windows architecture: %arch% >&2
\texit /b 1
)

set "bin_path=%~dp0..\\..\\%package_dir_name%\\bin\\${binaryName}.exe"
if not exist "%bin_path%" (
\techo [${binaryName}] Missing packaged binary: %bin_path% >&2
\texit /b 1
)

"%bin_path%" %*
`;
}

export async function buildBinaries(
	options: { targets?: SupportedTarget[]; outDir?: string } = {},
): Promise<BinaryBuildResult[]> {
	const targets = options.targets ?? [...SUPPORTED_TARGETS];
	const outDir = options.outDir ?? DEFAULT_COMPILED_DIR;
	const entries = [
		{
			name: "ralph" as const,
			entrypoint: join(REPO_ROOT, "apps", "tui", "src", "cli.ts"),
		},
		{
			name: "ralphd" as const,
			entrypoint: join(
				REPO_ROOT,
				"packages",
				"daemon",
				"src",
				"bin",
				"ralphd.ts",
			),
		},
	];
	const results: BinaryBuildResult[] = [];

	await mkdir(outDir, { recursive: true });

	for (const target of targets) {
		const spec = getTargetSpec(target);
		const targetDir = join(outDir, target);
		await rm(targetDir, { recursive: true, force: true });
		await mkdir(targetDir, { recursive: true });

		const binaries: Record<"ralph" | "ralphd", string> = {
			ralph: "",
			ralphd: "",
		};

		for (const entry of entries) {
			const outfile = join(targetDir, getBinaryFilename(entry.name, spec));
			const build = await Bun.build({
				entrypoints: [entry.entrypoint],
				minify: false,
				compile: {
					target,
					outfile,
				},
			});
			if (!build.success) {
				const errors = build.logs
					.map((log) => log.message ?? String(log))
					.join("\n");
				throw new Error(
					`Failed to build ${entry.name} for ${target}\n${errors}`,
				);
			}
			binaries[entry.name] = outfile;
		}

		results.push({
			target,
			outDir: targetDir,
			ralph: binaries.ralph,
			ralphd: binaries.ralphd,
		});
	}

	return results;
}

export async function stageDistribution(
	options: {
		targets?: SupportedTarget[];
		compiledDir?: string;
		stageDir?: string;
		version?: string;
	} = {},
): Promise<ReleaseManifest> {
	const targets = options.targets ?? [...SUPPORTED_TARGETS];
	const compiledDir = options.compiledDir ?? DEFAULT_COMPILED_DIR;
	const stageDir = options.stageDir ?? DEFAULT_STAGE_DIR;
	const version = options.version ?? (await getRootPackageVersion());

	await rm(stageDir, { recursive: true, force: true });
	await mkdir(stageDir, { recursive: true });

	const targetEntries: ReleaseManifest["targets"] = [];

	for (const target of targets) {
		const spec = getTargetSpec(target);
		const compiledTargetDir = join(compiledDir, target);
		const stagedTargetDir = join(stageDir, spec.stageDirName);
		const stagedBinDir = join(stagedTargetDir, "bin");
		const ralphSource = join(
			compiledTargetDir,
			getBinaryFilename("ralph", spec),
		);
		const ralphdSource = join(
			compiledTargetDir,
			getBinaryFilename("ralphd", spec),
		);

		await access(ralphSource);
		await access(ralphdSource);

		await mkdir(stagedBinDir, { recursive: true });
		await cp(ralphSource, join(stagedBinDir, getBinaryFilename("ralph", spec)));
		await cp(
			ralphdSource,
			join(stagedBinDir, getBinaryFilename("ralphd", spec)),
		);

		await writeFile(
			join(stagedTargetDir, "package.json"),
			`${JSON.stringify(
				{
					name: spec.packageName,
					version,
					type: "module",
					private: false,
					publishConfig: {
						access: "public",
					},
					os: [spec.os],
					cpu: [spec.cpu],
					files: ["bin"],
				},
				null,
				2,
			)}\n`,
		);

		targetEntries.push({
			target,
			packageName: spec.packageName,
			dir: spec.stageDirName,
			os: spec.os,
			cpu: spec.cpu,
		});
	}

	const rootDir = join(stageDir, "root");
	const rootBinDir = join(rootDir, "bin");
	await mkdir(rootBinDir, { recursive: true });

	await writeFile(join(rootBinDir, "ralph"), unixLauncher("ralph"), {
		mode: 0o755,
	});
	await writeFile(join(rootBinDir, "ralphd"), unixLauncher("ralphd"), {
		mode: 0o755,
	});
	await writeFile(join(rootBinDir, "ralph.cmd"), windowsLauncher("ralph"));
	await writeFile(join(rootBinDir, "ralphd.cmd"), windowsLauncher("ralphd"));

	await writeFile(
		join(rootDir, "package.json"),
		`${JSON.stringify(
			{
				name: "@techatnyu/ralph",
				version,
				type: "module",
				private: false,
				publishConfig: {
					access: "public",
				},
				files: ["bin"],
				bin: {
					ralph: "bin/ralph",
					ralphd: "bin/ralphd",
				},
				optionalDependencies: Object.fromEntries(
					targetEntries.map((entry) => [entry.packageName, version]),
				),
			},
			null,
			2,
		)}\n`,
	);

	const manifest: ReleaseManifest = {
		version,
		rootPackageName: "@techatnyu/ralph",
		rootDir: "root",
		targets: targetEntries,
		publishOrder: [...targetEntries.map((entry) => entry.dir), "root"],
	};

	await writeFile(
		join(stageDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	return manifest;
}

export async function readManifest(stageDir: string = DEFAULT_STAGE_DIR) {
	const raw = await readFile(join(stageDir, "manifest.json"), "utf8");
	return JSON.parse(raw) as ReleaseManifest;
}

export async function verifyStage(stageDir: string = DEFAULT_STAGE_DIR) {
	const manifest = await readManifest(stageDir);

	for (const relativeDir of manifest.publishOrder) {
		const packageDir = join(stageDir, relativeDir);
		await access(join(packageDir, "package.json"));
	}

	return manifest;
}

export async function publishDistribution(
	options: {
		stageDir?: string;
		dryRun?: boolean;
		tag?: string;
		access?: string;
		registry?: string;
		verify?: boolean;
	} = {},
) {
	const stageDir = options.stageDir ?? DEFAULT_STAGE_DIR;
	const dryRun = options.dryRun ?? false;
	const accessLevel = options.access ?? "public";
	const verify = options.verify ?? true;
	const manifest = verify
		? await verifyStage(stageDir)
		: await readManifest(stageDir);

	for (const relativeDir of manifest.publishOrder) {
		const packageDir = join(stageDir, relativeDir);
		const args = ["publish", "--access", accessLevel];
		if (options.tag) {
			args.push("--tag", options.tag);
		}
		if (options.registry) {
			args.push("--registry", options.registry);
		}
		if (dryRun) {
			args.push("--dry-run");
		}
		if (dryRun) {
			console.log(`(dry-run) cwd=${packageDir} bun ${args.join(" ")}`);
			continue;
		}
		await runCommand("bun", args, packageDir);
	}
}

export function parseTargets(argv: string[]): SupportedTarget[] | undefined {
	const targets = argv
		.filter((arg) => arg.startsWith("--target="))
		.map((arg) => {
			const value = arg.slice("--target=".length) as SupportedTarget;
			if (!SUPPORTED_TARGETS.includes(value)) {
				throw new Error(`Unsupported target: ${value}`);
			}
			return value;
		});
	return targets.length > 0 ? targets : undefined;
}

export function readFlagValue(
	argv: string[],
	flag: string,
): string | undefined {
	const prefix = `${flag}=`;
	const hit = argv.find((arg) => arg.startsWith(prefix));
	return hit ? hit.slice(prefix.length) : undefined;
}

export function hasFlag(argv: string[], flag: string): boolean {
	return argv.includes(flag);
}
