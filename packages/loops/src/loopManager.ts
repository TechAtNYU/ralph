import { ProgressStore, type ProgressStoreInitOptions } from "./progressStore";
import {
	clampPercent,
	createLoop,
	touchLoop,
	type CreateLoopOptions,
	type Loop,
	type LoopStage,
	type ProgressDocument,
	type ProgressEvent,
	type ProgressEventType,
	type StepStatus
} from "./schema";

export interface ProgressUpdateOptions {
	percent: number;
	note?: string;
}

export interface StageUpdateOptions {
	stage: LoopStage;
	note?: string;
}

export interface StepUpdateOptions {
	name: string;
	status?: StepStatus;
	notes?: string;
}

export interface FinishLoopOptions {
	archive?: boolean;
	note?: string;
}

export class LoopManager {
	constructor(private readonly store: ProgressStore) {}

	static async fromCwd(options: ProgressStoreInitOptions = {}) {
		const store = await ProgressStore.fromCwd(options);
		return new LoopManager(store);
	}

	async startLoop(options: CreateLoopOptions) {
		const loop = createLoop(options);
		loop.events.push(createEvent("note", { message: `Loop created: ${options.label}` }));
		await this.store.update((doc) => {
			doc.loops.push(loop);
			doc.activeLoopId = loop.id;
		});
		return loop;
	}

	async getActiveLoop() {
		return this.store.getActiveLoop();
	}

	async markStage(options: StageUpdateOptions) {
		await this.mutateActiveLoop((loop) => {
			loop.stage = options.stage;
			loop.events.push(createEvent("stage-change", { stage: options.stage, message: options.note }));
		});
	}

	async markReadProgress(options: ProgressUpdateOptions) {
		await this.mutateActiveLoop((loop) => {
			loop.readProgress.percent = clampPercent(options.percent);
			loop.readProgress.note = options.note;
			loop.events.push(
				createEvent("progress", {
					metric: "read",
					message: options.note,
					value: loop.readProgress.percent
				}
				)
			);
		});
	}

	async markWriteProgress(options: ProgressUpdateOptions) {
		await this.mutateActiveLoop((loop) => {
			loop.writeProgress.percent = clampPercent(options.percent);
			loop.writeProgress.note = options.note;
			loop.events.push(
				createEvent("progress", {
					metric: "write",
					message: options.note,
					value: loop.writeProgress.percent
				}
				)
			);
		});
	}

	async updateStep(options: StepUpdateOptions) {
		await this.mutateActiveLoop((loop) => {
			const status = options.status ?? "complete";
			const step = loop.steps.find((item) => item.name === options.name);
			if (step) {
				step.status = status;
				step.notes = options.notes ?? step.notes;
			} else {
				loop.steps.push({ name: options.name, status, notes: options.notes });
			}
			loop.events.push(
				createEvent("step-update", {
					stepName: options.name,
					status,
					message: options.notes,
				}
				)
			);
		});
	}

	async addNote(message: string) {
		await this.mutateActiveLoop((loop) => {
			loop.events.push(createEvent("note", { message }));
		});
	}

	async finishLoop(options: FinishLoopOptions = {}) {
		await this.mutateActiveLoop((loop, doc) => {
			loop.stage = "done";
			loop.archived = options.archive ?? true;
			loop.events.push(createEvent("stage-change", { stage: "done", message: options.note }));
			if (loop.archived) {
				doc.activeLoopId = undefined;
			}
		});
	}

	async archiveLoop(loopId: string) {
		await this.store.archiveLoop(loopId);
	}

	private async mutateActiveLoop(
		mutator: (loop: Loop, doc: ProgressDocument) => void
	) {
		await this.store.update((doc) => {
			const loop = doc.loops.find((item) => item.id === doc.activeLoopId);
			if (!loop) {
				throw new Error("No active loop to update");
			}
			mutator(loop, doc);
			touchLoop(loop);
		});
	}
}

function createEvent(type: ProgressEventType, payload: Partial<ProgressEvent>): ProgressEvent {
	return {
		id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		type,
		timestamp: new Date().toISOString(),
		...payload
	};
}
