import { describe, expect, it } from "bun:test";
import type { DaemonJob } from "@techatnyu/ralphd";
import {
	buildExecuteViewModel,
	readLatestProgressEntry,
} from "./execute-view-model";
import type { LoopState, TaskAttempt } from "./execution-loop";
import type { PrdTask } from "./plan-validation";

const NOW = "2026-04-28T00:00:00.000Z";

const TASK_0: PrdTask = {
	description: "Set up project structure",
	subtasks: ["Create files"],
	notes: "",
	passed: false,
};

const TASK_1: PrdTask = {
	description: "Render task list",
	subtasks: ["Show tasks"],
	notes: "",
	passed: false,
};

const TASKS: PrdTask[] = [TASK_0, TASK_1];

function attempt(
	partial: Partial<TaskAttempt> & Pick<TaskAttempt, "taskIndex" | "status">,
): TaskAttempt {
	const { id, taskIndex, status, ...rest } = partial;
	return {
		id: id ?? `${taskIndex}-attempt`,
		taskIndex,
		taskDescription: TASKS[taskIndex]?.description ?? "Unknown",
		attemptNumber: 1,
		status,
		updatedAt: NOW,
		...rest,
	};
}

function loopState(
	partial: Partial<LoopState> & { attempts?: TaskAttempt[] } = {},
): LoopState {
	return {
		version: 1,
		projectRoot: "/tmp/project",
		status: "running",
		attempts: [],
		createdAt: NOW,
		updatedAt: NOW,
		...partial,
	};
}

function job(partial: Partial<DaemonJob> & Pick<DaemonJob, "id">): DaemonJob {
	const { id, ...rest } = partial;
	return {
		id,
		instanceId: "instance-1",
		sessionId: "session-1",
		task: {
			type: "prompt",
			prompt: "You are Ralph's execution agent for one PRD task attempt.",
		},
		state: "running",
		createdAt: NOW,
		updatedAt: NOW,
		...rest,
	};
}

describe("execute view model", () => {
	it("renders pending tasks when there are no attempts", () => {
		const model = buildExecuteViewModel({
			tasks: TASKS,
			progress: "",
		});

		expect(model.status).toBe("idle");
		expect(model.rows.map((row) => row.status)).toEqual(["pending", "pending"]);
		expect(model.rows[0]?.description).toBe("Set up project structure");
	});

	it("shows the running active attempt with its job and session", () => {
		const active = attempt({
			taskIndex: 1,
			status: "running",
			jobId: "job-1",
			sessionId: "session-1",
		});
		const model = buildExecuteViewModel({
			tasks: TASKS,
			progress: "",
			loopState: loopState({
				currentTaskIndex: 1,
				attempts: [active],
			}),
			jobs: [job({ id: "job-1", state: "running" })],
		});

		expect(model.currentTaskIndex).toBe(1);
		expect(model.activeAttempt?.id).toBe(active.id);
		expect(model.activeJob?.id).toBe("job-1");
		expect(model.rows[1]).toMatchObject({
			status: "running",
			jobId: "job-1",
			sessionId: "session-1",
		});
	});

	it("renders verified attempts with warnings as warning rows", () => {
		const model = buildExecuteViewModel({
			tasks: [{ ...TASK_0, passed: true }],
			progress: "Task 1: Set up project structure finished.",
			loopState: loopState({
				status: "completed",
				attempts: [
					attempt({
						taskIndex: 0,
						status: "verified",
						jobId: "job-1",
						verificationWarnings: ["verified without sentinel"],
					}),
				],
			}),
			jobs: [job({ id: "job-1", state: "succeeded" })],
		});

		expect(model.rows[0]?.status).toBe("warning");
		expect(model.latestWarning).toBe("verified without sentinel");
	});

	it("surfaces failed and needs_attention verification errors", () => {
		const model = buildExecuteViewModel({
			tasks: TASKS,
			progress: "",
			loopState: loopState({
				status: "needs_attention",
				lastVerificationFailure: "progress.md was not appended",
				attempts: [
					attempt({
						taskIndex: 0,
						status: "needs_attention",
						verificationErrors: ["progress.md was not appended"],
					}),
					attempt({
						taskIndex: 1,
						status: "failed",
						verificationErrors: ["Job failed"],
					}),
				],
			}),
		});

		expect(model.status).toBe("needs_attention");
		expect(model.blockingMessage).toBe("progress.md was not appended");
		expect(model.rows[0]?.status).toBe("needs_attention");
		expect(model.rows[1]?.status).toBe("failed");
	});

	it("shows completed when all tasks passed even if loop state is paused", () => {
		const model = buildExecuteViewModel({
			tasks: TASKS.map((task) => ({ ...task, passed: true })),
			progress: "",
			loopState: loopState({
				status: "paused",
				currentTaskIndex: 1,
				attempts: [
					attempt({ taskIndex: 0, status: "verified" }),
					attempt({ taskIndex: 1, status: "verified" }),
				],
			}),
		});

		expect(model.status).toBe("completed");
		expect(model.completedTasks).toBe(2);
	});

	it("uses PRD descriptions instead of daemon prompt snippets", () => {
		const model = buildExecuteViewModel({
			tasks: TASKS,
			progress: "",
			loopState: loopState({
				attempts: [
					attempt({
						taskIndex: 0,
						status: "running",
						jobId: "job-1",
					}),
				],
			}),
			jobs: [
				job({
					id: "job-1",
					task: {
						type: "prompt",
						prompt: "You are Ralph's execution agent for one PRD task attempt.",
					},
				}),
			],
		});

		expect(model.rows[0]?.description).toBe("Set up project structure");
		expect(model.rows[0]?.description).not.toContain("execution agent");
	});

	it("finds the latest progress entry for a task", () => {
		const entry = readLatestProgressEntry(
			[
				"# Progress Log",
				"",
				"Task 1: Set up project structure finished.",
				"",
				"Task 2: Render task list with empty state.",
			].join("\n"),
			1,
			"Render task list",
		);

		expect(entry).toBe("Task 2: Render task list with empty state.");
	});
});
