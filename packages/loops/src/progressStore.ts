import { readJsonFile, writeJsonFile } from "./fsUtils";
import { resolveProjectPaths, type ProjectMetadata, type ProjectPaths } from "./projectPaths";
import {
	createEmptyDocument,
	touchLoop,
	type Loop,
	type ProgressDocument
} from "./schema";

export interface ProgressStoreInitOptions {
	startDir?: string;
	specFile?: string;
}

export class ProgressStore {
	private constructor(
		private readonly paths: ProjectPaths,
		private readonly specFile?: string
	) {}

	static async fromCwd(options: ProgressStoreInitOptions = {}) {
		const paths = await resolveProjectPaths(options.startDir);
		return new ProgressStore(paths, options.specFile);
	}

	get projectPaths() {
		return this.paths;
	}

	async load(): Promise<ProgressDocument> {
		const existing = await readJsonFile<ProgressDocument>(this.paths.progressFile);
		if (existing) {
			await this.updateMetadataTimestamp();
			return this.ensureProjectMetadata(existing);
		}
		const doc = createEmptyDocument({
			slug: this.paths.slug,
			projectPath: this.paths.root,
			specFile: this.specFile
		});
		await writeJsonFile(this.paths.progressFile, doc);
		await this.updateMetadataTimestamp();
		return doc;
	}

	async save(doc: ProgressDocument): Promise<void> {
		const next = this.ensureProjectMetadata({ ...doc, updatedAt: new Date().toISOString() });
		await writeJsonFile(this.paths.progressFile, next);
		await this.updateMetadataTimestamp();
	}

	async update(mutator: (doc: ProgressDocument) => void | ProgressDocument | Promise<void | ProgressDocument>) {
		const doc = await this.load();
		const result = await mutator(doc);
		const next = result ?? doc;
		next.updatedAt = new Date().toISOString();
		await this.save(next);
		return next;
	}

	async getActiveLoop(): Promise<Loop | undefined> {
		const doc = await this.load();
		return doc.loops.find((loop) => loop.id === doc.activeLoopId);
	}

	async setActiveLoop(loopId: string | undefined) {
		await this.update((doc) => {
			doc.activeLoopId = loopId;
		});
	}

	async upsertLoop(loop: Loop) {
		await this.update((doc) => {
			const index = doc.loops.findIndex((item) => item.id === loop.id);
			if (index >= 0) {
				doc.loops[index] = touchLoop(loop);
				return;
			}
			doc.loops.push(touchLoop(loop));
		});
	}

	async archiveLoop(loopId: string) {
		await this.update((doc) => {
			const loop = doc.loops.find((item) => item.id === loopId);
			if (loop) {
				loop.archived = true;
				loop.stage = "done";
				touchLoop(loop);
				if (doc.activeLoopId === loopId) {
					doc.activeLoopId = undefined;
				}
			}
		});
	}

	private ensureProjectMetadata(doc: ProgressDocument): ProgressDocument {
		doc.project.slug = this.paths.slug;
		doc.project.path = this.paths.root;
		if (this.specFile) {
			doc.project.specFile = this.specFile;
		}
		return doc;
	}

	private async updateMetadataTimestamp() {
		const existing = await readJsonFile<ProjectMetadata>(this.paths.metadataFile);
		const now = new Date().toISOString();
		if (existing) {
			existing.lastSeenAt = now;
			await writeJsonFile(this.paths.metadataFile, existing);
			return;
		}
		const metadata: ProjectMetadata = {
			slug: this.paths.slug,
			projectPath: this.paths.root,
			createdAt: now,
			lastSeenAt: now
		};
		await writeJsonFile(this.paths.metadataFile, metadata);
	}
}
