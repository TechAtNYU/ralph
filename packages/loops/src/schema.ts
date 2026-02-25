export type LoopStage = "reading" | "writing" | "verifying" | "done";

export type StepStatus = "pending" | "complete" | "skipped";

export interface ProgressMetric {
	percent: number;
	note?: string;
}

export interface LoopStep {
	name: string;
	status: StepStatus;
	notes?: string;
}

export type ProgressEventType = "stage-change" | "progress" | "step-update" | "note";

export interface ProgressEvent {
	id: string;
	type: ProgressEventType;
	timestamp: string;
	stage?: LoopStage;
	metric?: "read" | "write";
	stepName?: string;
	status?: StepStatus;
	value?: number;
	message?: string;
}

export interface Loop {
	id: string;
	label: string;
	stage: LoopStage;
	readProgress: ProgressMetric;
	writeProgress: ProgressMetric;
	steps: LoopStep[];
	events: ProgressEvent[];
	archived: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ProgressDocument {
	version: 1;
	project: {
		slug: string;
		path: string;
		specFile?: string;
	};
	loops: Loop[];
	activeLoopId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateLoopOptions {
	label: string;
	steps?: string[];
}

export interface CreateDocumentOptions {
	slug: string;
	projectPath: string;
	specFile?: string;
}

export function createLoop(options: CreateLoopOptions): Loop {
	const now = new Date().toISOString();
	return {
		id: createLoopId(),
		label: options.label,
		stage: "reading",
		readProgress: { percent: 0 },
		writeProgress: { percent: 0 },
		steps: (options.steps ?? []).map((name) => ({ name, status: "pending" })),
		events: [],
		archived: false,
		createdAt: now,
		updatedAt: now
	};
}

export function createEmptyDocument(options: CreateDocumentOptions): ProgressDocument {
	const now = new Date().toISOString();
	return {
		version: 1,
		project: {
			slug: options.slug,
			path: options.projectPath,
			specFile: options.specFile
		},
		loops: [],
		createdAt: now,
		updatedAt: now
	};
}

export function clampPercent(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(100, Math.max(0, Math.round(value)));
}

export function touchLoop(loop: Loop): Loop {
	loop.updatedAt = new Date().toISOString();
	return loop;
}

function createLoopId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
