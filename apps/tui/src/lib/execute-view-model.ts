import type { DaemonJob } from "@techatnyu/ralphd";
import {
	getActiveAttempt,
	type LoopState,
	type TaskAttempt,
} from "./execution-loop";
import type { PrdTask } from "./plan-validation";

export type ExecuteTaskStatus =
	| "pending"
	| "queued"
	| "running"
	| "verified"
	| "warning"
	| "failed"
	| "cancelled"
	| "needs_attention";

export type ExecuteDisplayStatus =
	| "idle"
	| "running"
	| "paused"
	| "needs_attention"
	| "completed";

export interface ExecuteTaskRow {
	index: number;
	description: string;
	task: PrdTask;
	status: ExecuteTaskStatus;
	statusText: string;
	attemptCount: number;
	latestAttempt?: TaskAttempt;
	job?: DaemonJob;
	jobId?: string;
	sessionId?: string;
	warnings: string[];
	errors: string[];
	progressEntry?: string;
}

export interface ExecuteDisplayState {
	status: ExecuteDisplayStatus;
	completedTasks: number;
	totalTasks: number;
	currentTaskIndex?: number;
	activeAttempt?: TaskAttempt;
	activeJob?: DaemonJob;
	blockingMessage?: string;
	latestWarning?: string;
	rows: ExecuteTaskRow[];
}

export interface BuildExecuteViewModelInput {
	tasks: PrdTask[];
	progress: string;
	loopState?: LoopState;
	jobs?: DaemonJob[];
}

function jobById(jobs: DaemonJob[] | undefined): Map<string, DaemonJob> {
	return new Map((jobs ?? []).map((job) => [job.id, job]));
}

function truncateText(text: string, maxLength: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	if (maxLength <= 3) return normalized.slice(0, maxLength);
	return `${normalized.slice(0, maxLength - 3)}...`;
}

function latestAttemptForTask(
	attempts: TaskAttempt[],
	taskIndex: number,
): TaskAttempt | undefined {
	return [...attempts]
		.reverse()
		.find((attempt) => attempt.taskIndex === taskIndex);
}

function statusFromAttempt(
	task: PrdTask,
	attempt: TaskAttempt | undefined,
): Pick<ExecuteTaskRow, "status" | "statusText"> {
	if (!attempt) {
		return task.passed
			? { status: "verified", statusText: "verified" }
			: { status: "pending", statusText: "pending" };
	}

	if (
		attempt.status === "verified" &&
		(attempt.verificationWarnings?.length ?? 0) > 0
	) {
		return { status: "warning", statusText: "warning" };
	}

	if (attempt.status === "succeeded") {
		return { status: "running", statusText: "verifying" };
	}

	if (attempt.status === "verified") {
		return { status: "verified", statusText: "verified" };
	}

	return { status: attempt.status, statusText: attempt.status };
}

export function readLatestProgressEntry(
	progress: string,
	taskIndex: number,
	taskDescription: string,
): string | undefined {
	const blocks = progress
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter((block) => block && block !== "# Progress Log");
	const normalizedDescription = taskDescription.trim().toLowerCase();
	const descriptionPrefix = normalizedDescription.slice(
		0,
		Math.min(normalizedDescription.length, 80),
	);
	const taskTerms = [
		`task ${taskIndex + 1}`,
		`task index ${taskIndex}`,
		`tasks[${taskIndex}]`,
	];

	for (const block of [...blocks].reverse()) {
		const normalized = block.toLowerCase();
		if (
			(descriptionPrefix && normalized.includes(descriptionPrefix)) ||
			taskTerms.some((term) => normalized.includes(term))
		) {
			return truncateText(block, 240);
		}
	}

	const fallback = blocks.at(-1);
	return fallback ? truncateText(fallback, 240) : undefined;
}

export function buildExecuteViewModel({
	tasks,
	progress,
	loopState,
	jobs,
}: BuildExecuteViewModelInput): ExecuteDisplayState {
	const jobsById = jobById(jobs);
	const activeAttempt = loopState ? getActiveAttempt(loopState) : undefined;
	const activeJob = activeAttempt?.jobId
		? jobsById.get(activeAttempt.jobId)
		: undefined;
	const completedTasks = tasks.filter((task) => task.passed).length;
	const allDone = tasks.length > 0 && completedTasks === tasks.length;
	const status: ExecuteDisplayStatus =
		allDone && !activeAttempt ? "completed" : (loopState?.status ?? "idle");

	const rows = tasks.map((task, index): ExecuteTaskRow => {
		const latestAttempt = latestAttemptForTask(
			loopState?.attempts ?? [],
			index,
		);
		const job = latestAttempt?.jobId
			? jobsById.get(latestAttempt.jobId)
			: undefined;
		const statusInfo = statusFromAttempt(task, latestAttempt);
		const warnings = latestAttempt?.verificationWarnings ?? [];
		const errors = latestAttempt?.verificationErrors ?? [];
		return {
			index,
			description: task.description,
			task,
			...statusInfo,
			attemptCount:
				loopState?.attempts.filter((attempt) => attempt.taskIndex === index)
					.length ?? 0,
			latestAttempt,
			job,
			jobId: latestAttempt?.jobId,
			sessionId: latestAttempt?.sessionId ?? job?.sessionId,
			warnings,
			errors,
			progressEntry: readLatestProgressEntry(progress, index, task.description),
		};
	});

	const firstPending = rows.find((row) => row.status === "pending")?.index;
	const latestAttempt = loopState?.attempts.at(-1);
	const currentTaskIndex =
		activeAttempt?.taskIndex ??
		loopState?.currentTaskIndex ??
		firstPending ??
		latestAttempt?.taskIndex;
	const latestWarning = [...rows]
		.reverse()
		.find((row) => row.warnings.length)
		?.warnings.join(", ");
	const blockingMessage =
		loopState?.lastVerificationFailure ??
		rows.find((row) => row.errors.length)?.errors.join("; ");

	return {
		status,
		completedTasks,
		totalTasks: tasks.length,
		currentTaskIndex,
		activeAttempt,
		activeJob,
		blockingMessage,
		latestWarning,
		rows,
	};
}
