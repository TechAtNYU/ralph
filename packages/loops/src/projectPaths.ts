import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { pathExists, readJsonFile, writeJsonFile } from "./fsUtils";

const PROJECTS_ROOT = path.join(os.homedir(), ".ralph", "projects");

export interface ProjectMetadata {
	slug: string;
	projectPath: string;
	createdAt: string;
	lastSeenAt: string;
}

export interface ProjectPaths {
	root: string;
	slug: string;
	storeDir: string;
	progressFile: string;
	metadataFile: string;
}

export async function resolveProjectPaths(startDir = process.cwd()): Promise<ProjectPaths> {
	const root = await findProjectRoot(startDir);
	if (!root) {
		throw new Error(`Unable to determine project root from ${startDir}`);
	}
	const slug = createProjectSlug(root);
	const storeDir = path.join(PROJECTS_ROOT, slug);
	const progressFile = path.join(storeDir, "progress.json");
	const metadataFile = path.join(storeDir, "metadata.json");
	await fs.mkdir(storeDir, { recursive: true });
	await ensureMetadata(metadataFile, { slug, projectPath: root });
	return { root, slug, storeDir, progressFile, metadataFile };
}

async function findProjectRoot(startDir: string): Promise<string | null> {
	let current = path.resolve(startDir);
	const { root } = path.parse(current);
	while (true) {
		const gitCandidate = path.join(current, ".git");
		const pkgCandidate = path.join(current, "package.json");
		if ((await pathExists(gitCandidate)) || (await pathExists(pkgCandidate))) {
			return current;
		}
		if (current === root) {
			return null;
		}
		current = path.dirname(current);
	}
}

function createProjectSlug(projectPath: string): string {
	const normalized = path.resolve(projectPath);
	const baseName = path.basename(normalized).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	const safeBase = baseName.toLowerCase() || "project";
	const digest = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 8);
	return `${safeBase}-${digest}`;
}

async function ensureMetadata(metadataFile: string, data: { slug: string; projectPath: string }) {
	const existing = await readJsonFile<ProjectMetadata>(metadataFile);
	const now = new Date().toISOString();
	if (existing) {
		existing.lastSeenAt = now;
		await writeJsonFile(metadataFile, existing);
		return;
	}
	const metadata: ProjectMetadata = {
		slug: data.slug,
		projectPath: data.projectPath,
		createdAt: now,
		lastSeenAt: now
	};
	await writeJsonFile(metadataFile, metadata);
}
