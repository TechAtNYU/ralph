import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createProjectSlug,
	ensureProjectStore,
	resolveProjectRoot,
	resolveProjectStore,
} from "./project-store";

const VALID_SPEC = `# Todo App

This specification is intentionally long enough for the validator. It describes a small todo app with a task form, a task list, completion state, deletion, and simple persistent behavior for Ralph project-store migration tests.
`;

describe("project store", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	async function tempDir(prefix: string): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), prefix));
		tempDirs.push(dir);
		return dir;
	}

	it("resolves the project root by walking up to package.json", async () => {
		const root = await tempDir("ralph-project-root-");
		const nested = join(root, "apps", "tui", "src");
		await mkdir(nested, { recursive: true });
		await writeFile(join(root, "package.json"), "{}", "utf8");

		await expect(resolveProjectRoot(nested)).resolves.toBe(root);
	});

	it("falls back to cwd when no root marker exists", async () => {
		const root = await tempDir("ralph-project-fallback-");
		const nested = join(root, "loose");
		await mkdir(nested, { recursive: true });

		await expect(resolveProjectRoot(nested)).resolves.toBe(resolve(nested));
	});

	it("builds a stable sanitized slug with a short root hash", () => {
		const root = "/tmp/My Demo App!";
		const first = createProjectSlug(root);
		const second = createProjectSlug(root);

		expect(first).toBe(second);
		expect(first).toMatch(/^my-demo-app-[a-f0-9]{8}$/);
	});

	it("creates metadata and preserves createdAt across updates", async () => {
		const projectRoot = await tempDir("ralph-project-metadata-");
		const ralphHome = await tempDir("ralph-home-metadata-");
		await writeFile(join(projectRoot, "package.json"), "{}", "utf8");

		const first = await ensureProjectStore({
			projectRoot,
			ralphHome,
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});
		const second = await ensureProjectStore({
			projectRoot,
			ralphHome,
			now: () => new Date("2026-01-02T00:00:00.000Z"),
		});

		expect(second.storeDir).toBe(first.storeDir);
		const metadata = JSON.parse(await readFile(first.metadataPath, "utf8"));
		expect(metadata.projectRoot).toBe(projectRoot);
		expect(metadata.slug).toBe(createProjectSlug(projectRoot));
		expect(metadata.createdAt).toBe("2026-01-01T00:00:00.000Z");
		expect(metadata.updatedAt).toBe("2026-01-02T00:00:00.000Z");
	});

	it("migrates valid legacy plan files without overwriting project-store files", async () => {
		const projectRoot = await tempDir("ralph-project-migrate-");
		const ralphHome = await tempDir("ralph-home-migrate-");
		await writeFile(join(projectRoot, "package.json"), "{}", "utf8");

		const legacyDir = join(ralphHome, "sessions", "instance-1", "plan");
		await mkdir(legacyDir, { recursive: true });
		await writeFile(join(legacyDir, "SPEC.md"), VALID_SPEC, "utf8");
		await writeFile(
			join(legacyDir, "prd.json"),
			JSON.stringify({
				tasks: [
					{
						description: "Build the shell",
						subtasks: ["Create index.html"],
						passed: false,
					},
				],
			}),
			"utf8",
		);
		await writeFile(
			join(legacyDir, "progress.md"),
			"# Progress Log\n\nLegacy",
			"utf8",
		);

		const paths = await ensureProjectStore({
			projectRoot,
			ralphHome,
			legacyInstanceId: "instance-1",
		});
		expect(await readFile(paths.specPath, "utf8")).toBe(VALID_SPEC);
		expect(await readFile(paths.progressPath, "utf8")).toContain("Legacy");

		await writeFile(
			join(legacyDir, "SPEC.md"),
			`${VALID_SPEC}\nchanged`,
			"utf8",
		);
		await ensureProjectStore({
			projectRoot,
			ralphHome,
			legacyInstanceId: "instance-1",
		});
		expect(await readFile(paths.specPath, "utf8")).toBe(VALID_SPEC);
	});

	it("places canonical files under RALPH_HOME/projects/<slug>", async () => {
		const projectRoot = await tempDir("ralph-project-paths-");
		const ralphHome = await tempDir("ralph-home-paths-");
		const paths = await resolveProjectStore({ projectRoot, ralphHome });

		expect(paths.storeDir).toBe(
			join(ralphHome, "projects", createProjectSlug(projectRoot)),
		);
		expect(paths.prdPath).toBe(join(paths.storeDir, "prd.json"));
		expect(paths.loopPath).toBe(join(paths.storeDir, "loop.json"));
	});
});
