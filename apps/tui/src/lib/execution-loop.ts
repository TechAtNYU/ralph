import { readFile, writeFile } from "node:fs/promises";
import type {
	DaemonJob,
	JobSession,
	JobTask,
	ManagedInstance,
} from "@techatnyu/ralphd";
import { z } from "zod";
import type { PrdTask } from "../hooks/use-plan-files";
import { parsePrd } from "./plan-validation";
import type { ProjectStorePaths } from "./project-store";

export const TASK_COMPLETE_SENTINEL = "RALPH_TASK_COMPLETE";

const LoopStatusSchema = z.enum([
	"idle",
	"running",
	"paused",
	"needs_attention",
	"completed",
]);

const AttemptStatusSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
	"needs_attention",
	"verified",
]);

const VerificationSnapshotSchema = z.object({
	progressLength: z.number().int().nonnegative(),
	gitRepository: z.boolean(),
	gitHead: z.string().nullable(),
});

const TaskAttemptSchema = z.object({
	id: z.string().min(1),
	taskIndex: z.number().int().nonnegative(),
	taskDescription: z.string().min(1),
	attemptNumber: z.number().int().positive(),
	status: AttemptStatusSchema,
	jobId: z.string().min(1).optional(),
	sessionId: z.string().min(1).optional(),
	submittedAt: z.string().optional(),
	updatedAt: z.string(),
	verifiedAt: z.string().optional(),
	verificationErrors: z.array(z.string()).optional(),
	verificationWarnings: z.array(z.string()).optional(),
	before: VerificationSnapshotSchema.optional(),
});

const LoopStateSchema = z.object({
	version: z.literal(1),
	projectRoot: z.string().min(1),
	status: LoopStatusSchema,
	currentTaskIndex: z.number().int().nonnegative().optional(),
	attempts: z.array(TaskAttemptSchema),
	lastVerificationFailure: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().optional(),
});

export type LoopStatus = z.infer<typeof LoopStatusSchema>;
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;
export type VerificationSnapshot = z.infer<typeof VerificationSnapshotSchema>;
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>;
export type LoopState = z.infer<typeof LoopStateSchema>;

export interface ExecutionDaemon {
	listInstances(): Promise<{ instances: ManagedInstance[] }>;
	createInstance(params: {
		name: string;
		directory: string;
		maxConcurrency?: number;
	}): Promise<{ instance: ManagedInstance }>;
	submitJob(params: {
		instanceId: string;
		session: JobSession;
		task: JobTask;
	}): Promise<{ job: DaemonJob }>;
	getJob(jobId: string): Promise<{ job: DaemonJob }>;
}

export interface LoopAdvanceResult {
	state: LoopState;
	action: "submitted" | "monitoring" | "verified" | "paused" | "completed";
	message: string;
	job?: DaemonJob;
	attempt?: TaskAttempt;
}

export interface VerifyTaskCompletionOptions {
	paths: ProjectStorePaths;
	taskIndex: number;
	task: PrdTask;
	job: DaemonJob;
	before?: VerificationSnapshot;
	readGitHead?: (projectRoot: string) => Promise<string | null>;
}

export interface VerificationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

function isoNow(now: () => Date): string {
	return now().toISOString();
}

function createLoopState(paths: ProjectStorePaths, now: () => Date): LoopState {
	const timestamp = isoNow(now);
	return {
		version: 1,
		projectRoot: paths.projectRoot,
		status: "idle",
		attempts: [],
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

export async function loadLoopState(
	paths: ProjectStorePaths,
	now: () => Date = () => new Date(),
): Promise<LoopState> {
	const raw = await readText(paths.loopPath);
	if (!raw) {
		return createLoopState(paths, now);
	}

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new Error("loop.json: invalid JSON");
	}

	const parsed = LoopStateSchema.safeParse(json);
	if (!parsed.success) {
		throw new Error(
			`loop.json: ${parsed.error.issues[0]?.message ?? "invalid"}`,
		);
	}

	return parsed.data;
}

export async function saveLoopState(
	paths: ProjectStorePaths,
	state: LoopState,
): Promise<void> {
	await writeFile(
		paths.loopPath,
		`${JSON.stringify(state, null, "\t")}\n`,
		"utf8",
	);
}

export async function readProjectTasks(
	paths: ProjectStorePaths,
): Promise<PrdTask[]> {
	const prd = await readText(paths.prdPath);
	const parsed = parsePrd(prd);
	if (parsed.error) {
		throw new Error(`prd.json: ${parsed.error}`);
	}
	return parsed.tasks;
}

export function findNextPendingTaskIndex(tasks: PrdTask[]): number | null {
	const index = tasks.findIndex((task) => !task.passed);
	return index === -1 ? null : index;
}

export function getActiveAttempt(state: LoopState): TaskAttempt | undefined {
	return [...state.attempts]
		.reverse()
		.find((attempt) =>
			["queued", "running", "succeeded", "failed", "needs_attention"].includes(
				attempt.status,
			),
		);
}

function getAttemptCount(state: LoopState, taskIndex: number): number {
	return state.attempts.filter((attempt) => attempt.taskIndex === taskIndex)
		.length;
}

function isTerminalJob(job: DaemonJob): boolean {
	return (
		job.state === "succeeded" ||
		job.state === "failed" ||
		job.state === "cancelled"
	);
}

function jobStateToAttemptStatus(job: DaemonJob): AttemptStatus {
	if (job.state === "succeeded") return "succeeded";
	if (job.state === "failed") return "failed";
	if (job.state === "cancelled") return "cancelled";
	if (job.state === "running") return "running";
	return "queued";
}

async function runGit(
	projectRoot: string,
	args: string[],
): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd: projectRoot,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		if (exitCode !== 0) return null;
		return stdout.trim();
	} catch {
		return null;
	}
}

export async function isGitRepository(projectRoot: string): Promise<boolean> {
	return (
		(await runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"])) ===
		"true"
	);
}

export async function readGitHead(projectRoot: string): Promise<string | null> {
	return runGit(projectRoot, ["rev-parse", "HEAD"]);
}

export async function captureVerificationSnapshot(
	paths: ProjectStorePaths,
): Promise<VerificationSnapshot> {
	const progress = (await readText(paths.progressPath)) ?? "";
	const gitRepository = await isGitRepository(paths.projectRoot);
	const gitHead = gitRepository ? await readGitHead(paths.projectRoot) : null;
	return {
		progressLength: progress.length,
		gitRepository,
		gitHead,
	};
}

function progressMentionsTask(
	progress: string,
	taskIndex: number,
	task: PrdTask,
): boolean {
	const normalized = progress.toLowerCase();
	const description = task.description.trim().toLowerCase();
	const descriptionPrefix = description.slice(
		0,
		Math.min(description.length, 80),
	);
	return (
		normalized.includes(descriptionPrefix) ||
		normalized.includes(`task ${taskIndex}`) ||
		normalized.includes(`task ${taskIndex + 1}`)
	);
}

export function buildExecutionPrompt({
	paths,
	task,
	taskIndex,
	totalTasks,
}: {
	paths: ProjectStorePaths;
	task: PrdTask;
	taskIndex: number;
	totalTasks: number;
}): string {
	const lines = [
		"You are Ralph's execution agent for one PRD task attempt.",
		"",
		"Project:",
		`- Project root: ${paths.projectRoot}`,
		`- Project store: ${paths.storeDir}`,
		`- SPEC.md: ${paths.specPath}`,
		`- prd.json: ${paths.prdPath}`,
		`- progress.md: ${paths.progressPath}`,
		`- loop.json: ${paths.loopPath}`,
		"",
		"Execution contract:",
		`- Implement exactly task index ${taskIndex} (task ${taskIndex + 1} of ${totalTasks}).`,
		"- Read SPEC.md, prd.json, and progress.md from the absolute paths above before editing.",
		"- Do not work on later tasks unless they are strictly required by this task.",
		"- Append a progress.md entry that references this task and summarizes the work.",
		`- Set only tasks[${taskIndex}].passed to true in prd.json after the work is complete.`,
		"- Preserve valid prd.json JSON with the existing tasks array shape.",
		"- If the project root is a git repository, commit the project-root code changes before finishing.",
		`- Print ${TASK_COMPLETE_SENTINEL} on its own line only when the task is truly complete.`,
		"",
		"Task:",
		`Description: ${task.description}`,
		"",
		"Subtasks:",
		...task.subtasks.map((subtask) => `- ${subtask}`),
	];

	if (task.notes?.trim()) {
		lines.push("", `Notes: ${task.notes.trim()}`);
	}

	return lines.join("\n");
}

export async function verifyTaskCompletion({
	paths,
	taskIndex,
	task,
	job,
	before,
	readGitHead: readHead = readGitHead,
}: VerifyTaskCompletionOptions): Promise<VerificationResult> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const missingSentinel = !job.outputText?.includes(TASK_COMPLETE_SENTINEL);

	if (job.state !== "succeeded") {
		errors.push(`job ended as ${job.state}`);
	}

	let tasks: PrdTask[] = [];
	try {
		tasks = await readProjectTasks(paths);
	} catch (error) {
		errors.push(
			error instanceof Error ? error.message : "prd.json did not parse",
		);
	}

	if (!tasks[taskIndex]?.passed) {
		errors.push(`tasks[${taskIndex}].passed is not true`);
	}

	const progress = (await readText(paths.progressPath)) ?? "";
	if (before && progress.length <= before.progressLength) {
		errors.push("progress.md was not appended");
	}
	if (!progressMentionsTask(progress, taskIndex, task)) {
		errors.push("progress.md does not reference the task");
	}

	if (before?.gitRepository) {
		const afterHead = await readHead(paths.projectRoot);
		if (!afterHead) {
			errors.push("git HEAD is missing after the attempt");
		} else if (afterHead === before.gitHead) {
			errors.push("git HEAD did not advance during the attempt");
		}
	}

	if (missingSentinel) {
		if (errors.length === 0) {
			warnings.push("verified without sentinel");
		} else {
			errors.push(`job output is missing ${TASK_COMPLETE_SENTINEL}`);
		}
	}

	return {
		ok: errors.length === 0,
		errors,
		warnings,
	};
}

async function ensureProjectInstance(
	daemonClient: ExecutionDaemon,
	paths: ProjectStorePaths,
): Promise<ManagedInstance> {
	const { instances } = await daemonClient.listInstances();
	const existing = instances.find(
		(instance) => instance.directory === paths.projectRoot,
	);
	if (existing) return existing;
	return (
		await daemonClient.createInstance({
			name: paths.slug,
			directory: paths.projectRoot,
			maxConcurrency: 1,
		})
	).instance;
}

function updateAttempt(
	state: LoopState,
	attemptId: string,
	update: Partial<TaskAttempt>,
): LoopState {
	return {
		...state,
		attempts: state.attempts.map((attempt) =>
			attempt.id === attemptId ? { ...attempt, ...update } : attempt,
		),
	};
}

export async function advanceExecutionLoop({
	paths,
	daemonClient,
	now = () => new Date(),
}: {
	paths: ProjectStorePaths;
	daemonClient: ExecutionDaemon;
	now?: () => Date;
}): Promise<LoopAdvanceResult> {
	const timestamp = isoNow(now);
	let state = await loadLoopState(paths, now);

	if (state.status === "needs_attention") {
		return {
			state,
			action: "paused",
			message: state.lastVerificationFailure ?? "Loop needs attention",
		};
	}

	const tasks = await readProjectTasks(paths);
	const active = getActiveAttempt(state);

	if (active?.jobId) {
		const { job } = await daemonClient.getJob(active.jobId);
		const status = jobStateToAttemptStatus(job);
		state = updateAttempt(state, active.id, {
			status,
			sessionId: job.sessionId ?? active.sessionId,
			updatedAt: timestamp,
		});

		if (!isTerminalJob(job)) {
			state = {
				...state,
				status: "running",
				currentTaskIndex: active.taskIndex,
				updatedAt: timestamp,
			};
			await saveLoopState(paths, state);
			return {
				state,
				action: "monitoring",
				message: `Monitoring job ${job.id.slice(0, 8)}`,
				job,
				attempt: state.attempts.find((attempt) => attempt.id === active.id),
			};
		}

		if (job.state !== "succeeded") {
			const message = job.error ?? `Job ended as ${job.state}`;
			state = updateAttempt(state, active.id, {
				status,
				verificationErrors: [message],
				updatedAt: timestamp,
			});
			state = {
				...state,
				status: job.state === "cancelled" ? "paused" : "needs_attention",
				lastVerificationFailure: message,
				updatedAt: timestamp,
			};
			await saveLoopState(paths, state);
			return {
				state,
				action: "paused",
				message,
				job,
				attempt: state.attempts.find((attempt) => attempt.id === active.id),
			};
		}

		const task = tasks[active.taskIndex];
		if (!task) {
			const message = `Task ${active.taskIndex} no longer exists in prd.json`;
			state = updateAttempt(state, active.id, {
				status: "needs_attention",
				verificationErrors: [message],
				updatedAt: timestamp,
			});
			state = {
				...state,
				status: "needs_attention",
				lastVerificationFailure: message,
				updatedAt: timestamp,
			};
			await saveLoopState(paths, state);
			return { state, action: "paused", message, job };
		}

		const verification = await verifyTaskCompletion({
			paths,
			taskIndex: active.taskIndex,
			task,
			job,
			before: active.before,
		});
		if (!verification.ok) {
			const message = verification.errors.join("; ");
			state = updateAttempt(state, active.id, {
				status: "needs_attention",
				verificationErrors: verification.errors,
				verificationWarnings: verification.warnings,
				updatedAt: timestamp,
			});
			state = {
				...state,
				status: "needs_attention",
				lastVerificationFailure: message,
				updatedAt: timestamp,
			};
			await saveLoopState(paths, state);
			return {
				state,
				action: "paused",
				message,
				job,
				attempt: state.attempts.find((attempt) => attempt.id === active.id),
			};
		}

		state = updateAttempt(state, active.id, {
			status: "verified",
			verificationErrors: [],
			verificationWarnings: verification.warnings,
			verifiedAt: timestamp,
			updatedAt: timestamp,
		});
		state = {
			...state,
			status: "running",
			lastVerificationFailure: undefined,
			updatedAt: timestamp,
		};
		await saveLoopState(paths, state);
		const warningSuffix = verification.warnings.length
			? ` (${verification.warnings.join(", ")})`
			: "";
		return {
			state,
			action: "verified",
			message: `Verified task ${active.taskIndex + 1}${warningSuffix}`,
			job,
			attempt: state.attempts.find((attempt) => attempt.id === active.id),
		};
	}

	const pendingIndex = findNextPendingTaskIndex(tasks);
	if (pendingIndex === null) {
		state = {
			...state,
			status: "completed",
			currentTaskIndex: undefined,
			completedAt: timestamp,
			updatedAt: timestamp,
		};
		await saveLoopState(paths, state);
		return { state, action: "completed", message: "All tasks completed" };
	}

	const task = tasks[pendingIndex];
	if (!task) {
		throw new Error(`Task ${pendingIndex} is missing`);
	}

	const instance = await ensureProjectInstance(daemonClient, paths);
	const before = await captureVerificationSnapshot(paths);
	const prompt = buildExecutionPrompt({
		paths,
		task,
		taskIndex: pendingIndex,
		totalTasks: tasks.length,
	});
	const { job } = await daemonClient.submitJob({
		instanceId: instance.id,
		session: {
			type: "new",
			title: `Task ${pendingIndex + 1}: ${task.description.slice(0, 60)}`,
		},
		task: { type: "prompt", prompt },
	});

	const attempt: TaskAttempt = {
		id: `${pendingIndex}-${Date.now().toString(36)}`,
		taskIndex: pendingIndex,
		taskDescription: task.description,
		attemptNumber: getAttemptCount(state, pendingIndex) + 1,
		status: jobStateToAttemptStatus(job),
		jobId: job.id,
		sessionId: job.sessionId,
		submittedAt: timestamp,
		updatedAt: timestamp,
		before,
	};

	state = {
		...state,
		status: "running",
		currentTaskIndex: pendingIndex,
		attempts: [...state.attempts, attempt],
		lastVerificationFailure: undefined,
		updatedAt: timestamp,
	};
	await saveLoopState(paths, state);
	return {
		state,
		action: "submitted",
		message: `Submitted task ${pendingIndex + 1}`,
		job,
		attempt,
	};
}

export async function markActiveAttemptCancelled(
	paths: ProjectStorePaths,
	now: () => Date = () => new Date(),
): Promise<LoopState> {
	const timestamp = isoNow(now);
	const state = await loadLoopState(paths, now);
	const active = getActiveAttempt(state);
	if (!active) {
		const next = {
			...state,
			status: "paused" as const,
			updatedAt: timestamp,
		};
		await saveLoopState(paths, next);
		return next;
	}
	const next = updateAttempt(state, active.id, {
		status: "cancelled",
		updatedAt: timestamp,
		verificationErrors: ["Cancelled by user"],
	});
	const cancelled = {
		...next,
		status: "paused" as const,
		lastVerificationFailure: "Cancelled by user",
		updatedAt: timestamp,
	};
	await saveLoopState(paths, cancelled);
	return cancelled;
}

export async function markLoopPaused(
	paths: ProjectStorePaths,
	now: () => Date = () => new Date(),
): Promise<LoopState> {
	const timestamp = isoNow(now);
	const state = await loadLoopState(paths, now);
	const paused = {
		...state,
		status: "paused" as const,
		updatedAt: timestamp,
	};
	await saveLoopState(paths, paused);
	return paused;
}

export async function acceptActiveAttempt(
	paths: ProjectStorePaths,
	options: {
		warning?: string;
		now?: () => Date;
	} = {},
): Promise<LoopState> {
	const now = options.now ?? (() => new Date());
	const timestamp = isoNow(now);
	const state = await loadLoopState(paths, now);
	const active = getActiveAttempt(state);
	if (!active) {
		throw new Error("No active attempt to accept");
	}
	const warnings = [
		...(active.verificationWarnings ?? []),
		options.warning ?? "manually accepted",
	].filter((warning, index, all) => all.indexOf(warning) === index);
	const next = updateAttempt(state, active.id, {
		status: "verified",
		verificationErrors: [],
		verificationWarnings: warnings,
		verifiedAt: timestamp,
		updatedAt: timestamp,
	});
	const accepted = {
		...next,
		status: "running" as const,
		lastVerificationFailure: undefined,
		updatedAt: timestamp,
	};
	await saveLoopState(paths, accepted);
	return accepted;
}
