import { createHash } from "node:crypto";
import {
	access,
	copyFile,
	mkdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { resolveDaemonPaths } from "@techatnyu/ralphd";
import { parsePrd, validateSpec } from "./plan-validation";

export interface ProjectStorePaths {
	projectRoot: string;
	slug: string;
	storeDir: string;
	specPath: string;
	prdPath: string;
	progressPath: string;
	promptPath: string;
	loopPath: string;
	metadataPath: string;
}

export interface ProjectStoreMetadata {
	version: 1;
	projectRoot: string;
	projectName: string;
	slug: string;
	createdAt: string;
	updatedAt: string;
}

export interface ResolveProjectStoreOptions {
	projectRoot?: string;
	cwd?: string;
	ralphHome?: string;
}

export interface EnsureProjectStoreOptions extends ResolveProjectStoreOptions {
	legacyInstanceId?: string;
	now?: () => Date;
}

const PROJECT_FILES = {
	spec: "SPEC.md",
	prd: "prd.json",
	progress: "progress.md",
	prompt: "PROMPT.md",
	loop: "loop.json",
	metadata: "metadata.json",
} as const;

function getRalphHome(ralphHome?: string): string {
	return resolve(ralphHome ?? resolveDaemonPaths().ralphHome);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function hasRootMarker(path: string): Promise<boolean> {
	const [git, packageJson] = await Promise.all([
		stat(join(path, ".git"))
			.then(() => true)
			.catch(() => false),
		stat(join(path, "package.json"))
			.then((info) => info.isFile())
			.catch(() => false),
	]);
	return git || packageJson;
}

export async function resolveProjectRoot(cwd = process.cwd()): Promise<string> {
	let current = resolve(cwd);

	while (true) {
		if (await hasRootMarker(current)) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) {
			return resolve(cwd);
		}
		current = parent;
	}
}

export function createProjectSlug(projectRoot: string): string {
	const root = resolve(projectRoot);
	const name = basename(root) || "project";
	const sanitized = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const hash = createHash("sha1").update(root).digest("hex").slice(0, 8);
	return `${sanitized || "project"}-${hash}`;
}

export function buildProjectStorePaths(
	projectRoot: string,
	ralphHome?: string,
): ProjectStorePaths {
	const normalizedRoot = resolve(projectRoot);
	const slug = createProjectSlug(normalizedRoot);
	const storeDir = join(getRalphHome(ralphHome), "projects", slug);

	return {
		projectRoot: normalizedRoot,
		slug,
		storeDir,
		specPath: join(storeDir, PROJECT_FILES.spec),
		prdPath: join(storeDir, PROJECT_FILES.prd),
		progressPath: join(storeDir, PROJECT_FILES.progress),
		promptPath: join(storeDir, PROJECT_FILES.prompt),
		loopPath: join(storeDir, PROJECT_FILES.loop),
		metadataPath: join(storeDir, PROJECT_FILES.metadata),
	};
}

export async function resolveProjectStore(
	options: ResolveProjectStoreOptions = {},
): Promise<ProjectStorePaths> {
	const projectRoot =
		options.projectRoot ??
		(await resolveProjectRoot(options.cwd ?? process.cwd()));
	return buildProjectStorePaths(projectRoot, options.ralphHome);
}

function buildProjectPrompt(paths: ProjectStorePaths): string {
	return `# Ralph Project Store

This directory is Ralph's canonical project store for:

- Project root: ${paths.projectRoot}
- SPEC.md: ${paths.specPath}
- prd.json: ${paths.prdPath}
- progress.md: ${paths.progressPath}
- loop.json: ${paths.loopPath}

Execution agents must update prd.json and progress.md here, then commit project-root changes when the project is a git repository. Finish successful task attempts by printing exactly:

RALPH_TASK_COMPLETE
`;
}

async function writeProjectPromptIfMissing(
	paths: ProjectStorePaths,
): Promise<void> {
	if (await pathExists(paths.promptPath)) return;
	await writeFile(paths.promptPath, buildProjectPrompt(paths), "utf8");
}

async function copyValidLegacyFile(
	legacyPath: string,
	targetPath: string,
	validate: (content: string) => boolean,
): Promise<void> {
	if (await pathExists(targetPath)) return;
	if (!(await pathExists(legacyPath))) return;

	const content = await readFile(legacyPath, "utf8");
	if (!validate(content)) return;

	await copyFile(legacyPath, targetPath);
}

async function migrateLegacyPlanFiles(
	paths: ProjectStorePaths,
	legacyInstanceId: string | undefined,
	ralphHome?: string,
): Promise<void> {
	if (!legacyInstanceId) return;

	const legacyDir = join(
		getRalphHome(ralphHome),
		"sessions",
		legacyInstanceId,
		"plan",
	);
	await Promise.all([
		copyValidLegacyFile(
			join(legacyDir, PROJECT_FILES.spec),
			paths.specPath,
			(content) => validateSpec(content).valid,
		),
		copyValidLegacyFile(
			join(legacyDir, PROJECT_FILES.prd),
			paths.prdPath,
			(content) => !parsePrd(content).error,
		),
		copyValidLegacyFile(
			join(legacyDir, PROJECT_FILES.progress),
			paths.progressPath,
			(content) => content.trim().length > 0,
		),
	]);
}

async function readMetadata(
	paths: ProjectStorePaths,
): Promise<ProjectStoreMetadata | null> {
	try {
		const raw = await readFile(paths.metadataPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<ProjectStoreMetadata>;
		if (
			parsed.version !== 1 ||
			typeof parsed.createdAt !== "string" ||
			typeof parsed.updatedAt !== "string"
		) {
			return null;
		}
		return {
			version: 1,
			projectRoot: paths.projectRoot,
			projectName: basename(paths.projectRoot),
			slug: paths.slug,
			createdAt: parsed.createdAt,
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return null;
	}
}

async function writeMetadata(
	paths: ProjectStorePaths,
	now: () => Date,
): Promise<ProjectStoreMetadata> {
	const timestamp = now().toISOString();
	const existing = await readMetadata(paths);
	const metadata: ProjectStoreMetadata = {
		version: 1,
		projectRoot: paths.projectRoot,
		projectName: basename(paths.projectRoot),
		slug: paths.slug,
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
	await writeFile(
		paths.metadataPath,
		`${JSON.stringify(metadata, null, "\t")}\n`,
		"utf8",
	);
	return metadata;
}

export async function ensureProjectStore(
	options: EnsureProjectStoreOptions = {},
): Promise<ProjectStorePaths> {
	const paths = await resolveProjectStore(options);
	const now = options.now ?? (() => new Date());

	await mkdir(paths.storeDir, { recursive: true });
	await migrateLegacyPlanFiles(
		paths,
		options.legacyInstanceId,
		options.ralphHome,
	);
	await writeProjectPromptIfMissing(paths);

	if (!(await pathExists(paths.progressPath))) {
		await writeFile(paths.progressPath, "# Progress Log\n", "utf8");
	}

	await writeMetadata(paths, now);
	return paths;
}
