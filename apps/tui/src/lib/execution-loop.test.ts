import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	DaemonJob,
	JobSession,
	JobTask,
	ManagedInstance,
} from "@techatnyu/ralphd";
import {
	advanceExecutionLoop,
	buildExecutionPrompt,
	type ExecutionDaemon,
	markActiveAttemptCancelled,
	markLoopPaused,
	TASK_COMPLETE_SENTINEL,
	type VerificationSnapshot,
	verifyTaskCompletion,
} from "./execution-loop";
import type { PrdTask } from "./plan-validation";
import { ensureProjectStore, type ProjectStorePaths } from "./project-store";

const TASK_0: PrdTask = {
	description: "Set up project structure and HTML skeleton",
	subtasks: ["Create index.html", "Add app container"],
	notes: "",
	passed: false,
};

const TASK_1: PrdTask = {
	description: "Add task input and persistence",
	subtasks: ["Create form", "Save tasks locally"],
	notes: "",
	passed: false,
};

const TASKS: PrdTask[] = [TASK_0, TASK_1];

class FakeDaemon implements ExecutionDaemon {
	instances: ManagedInstance[] = [];
	jobs: DaemonJob[] = [];
	submittedPrompts: string[] = [];

	async listInstances(): Promise<{ instances: ManagedInstance[] }> {
		return { instances: this.instances };
	}

	async createInstance(params: {
		name: string;
		directory: string;
		maxConcurrency?: number;
	}): Promise<{ instance: ManagedInstance }> {
		const now = new Date().toISOString();
		const instance: ManagedInstance = {
			id: `instance-${this.instances.length}`,
			name: params.name,
			directory: params.directory,
			status: "running",
			maxConcurrency: params.maxConcurrency ?? 1,
			createdAt: now,
			updatedAt: now,
		};
		this.instances.push(instance);
		return { instance };
	}

	async submitJob(params: {
		instanceId: string;
		session: JobSession;
		task: JobTask;
	}): Promise<{ job: DaemonJob }> {
		const now = new Date().toISOString();
		const job: DaemonJob = {
			id: `job-${this.jobs.length}`,
			instanceId: params.instanceId,
			sessionId: `session-${this.jobs.length}`,
			task: params.task,
			state: "running",
			createdAt: now,
			updatedAt: now,
			startedAt: now,
		};
		this.jobs.push(job);
		this.submittedPrompts.push(params.task.prompt);
		return { job };
	}

	async getJob(jobId: string): Promise<{ job: DaemonJob }> {
		const job = this.jobs.find((candidate) => candidate.id === jobId);
		if (!job) throw new Error(`missing job ${jobId}`);
		return { job };
	}

	completeJob(jobId: string, outputText = TASK_COMPLETE_SENTINEL): void {
		const index = this.jobs.findIndex((job) => job.id === jobId);
		const job = this.jobs[index];
		if (!job) throw new Error(`missing job ${jobId}`);
		this.jobs[index] = {
			...job,
			state: "succeeded",
			outputText,
			endedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
	}
}

describe("execution loop", () => {
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

	async function createStore(): Promise<ProjectStorePaths> {
		const projectRoot = await tempDir("ralph-loop-project-");
		const ralphHome = await tempDir("ralph-loop-home-");
		await mkdir(projectRoot, { recursive: true });
		await writeFile(join(projectRoot, "package.json"), "{}", "utf8");
		const paths = await ensureProjectStore({ projectRoot, ralphHome });
		await writePrd(paths, TASKS);
		await writeFile(paths.progressPath, "# Progress Log\n", "utf8");
		return paths;
	}

	async function writePrd(
		paths: ProjectStorePaths,
		tasks: PrdTask[],
	): Promise<void> {
		await writeFile(
			paths.prdPath,
			`${JSON.stringify({ tasks }, null, "\t")}\n`,
			"utf8",
		);
	}

	async function appendProgress(
		paths: ProjectStorePaths,
		text: string,
	): Promise<void> {
		const current = await readFile(paths.progressPath, "utf8");
		await writeFile(paths.progressPath, `${current}\n${text}\n`, "utf8");
	}

	it("builds prompts with user-root artifact paths and the exact task index", async () => {
		const paths = await createStore();
		const prompt = buildExecutionPrompt({
			paths,
			task: TASK_1,
			taskIndex: 1,
			totalTasks: TASKS.length,
		});

		expect(prompt).toContain(paths.specPath);
		expect(prompt).toContain(paths.prdPath);
		expect(prompt).toContain(paths.progressPath);
		expect(prompt).toContain("task index 1");
		expect(prompt).toContain("tasks[1].passed");
	});

	it("verifies a completed task and reports contract failures", async () => {
		const paths = await createStore();
		const before: VerificationSnapshot = {
			progressLength: (await readFile(paths.progressPath, "utf8")).length,
			gitRepository: false,
			gitHead: null,
		};
		const passedTasks = [{ ...TASK_0, passed: true }, TASK_1];
		await writePrd(paths, passedTasks);
		await appendProgress(paths, `Task 1: ${TASK_0.description}`);

		const ok = await verifyTaskCompletion({
			paths,
			taskIndex: 0,
			task: TASK_0,
			job: makeJob("succeeded", TASK_COMPLETE_SENTINEL),
			before,
		});
		expect(ok).toEqual({ ok: true, errors: [] });

		const missingSentinel = await verifyTaskCompletion({
			paths,
			taskIndex: 0,
			task: TASK_0,
			job: makeJob("succeeded", "done"),
			before,
		});
		expect(missingSentinel.errors).toContain(
			`job output is missing ${TASK_COMPLETE_SENTINEL}`,
		);

		await writePrd(paths, TASKS);
		const unchangedPrd = await verifyTaskCompletion({
			paths,
			taskIndex: 0,
			task: TASK_0,
			job: makeJob("succeeded", TASK_COMPLETE_SENTINEL),
			before,
		});
		expect(unchangedPrd.errors).toContain("tasks[0].passed is not true");

		const unchangedProgress = await verifyTaskCompletion({
			paths,
			taskIndex: 0,
			task: TASK_0,
			job: makeJob("succeeded", TASK_COMPLETE_SENTINEL),
			before: {
				...before,
				progressLength: (await readFile(paths.progressPath, "utf8")).length,
			},
		});
		expect(unchangedProgress.errors).toContain("progress.md was not appended");

		const failedJob = await verifyTaskCompletion({
			paths,
			taskIndex: 0,
			task: TASK_0,
			job: makeJob("failed", TASK_COMPLETE_SENTINEL),
			before,
		});
		expect(failedJob.errors).toContain("job ended as failed");

		const missingCommit = await verifyTaskCompletion({
			paths,
			taskIndex: 0,
			task: TASK_0,
			job: makeJob("succeeded", TASK_COMPLETE_SENTINEL),
			before: { ...before, gitRepository: true, gitHead: "abc" },
			readGitHead: async () => "abc",
		});
		expect(missingCommit.errors).toContain(
			"git HEAD did not advance during the attempt",
		);
	});

	it("runs pending tasks sequentially without resubmitting a verified task", async () => {
		const paths = await createStore();
		const fakeDaemon = new FakeDaemon();

		const first = await advanceExecutionLoop({
			paths,
			daemonClient: fakeDaemon,
		});
		expect(first.action).toBe("submitted");
		expect(fakeDaemon.submittedPrompts).toHaveLength(1);
		expect(fakeDaemon.submittedPrompts[0]).toContain("task index 0");

		await writePrd(paths, [{ ...TASK_0, passed: true }, TASK_1]);
		await appendProgress(paths, `Task 1: ${TASK_0.description}`);
		fakeDaemon.completeJob("job-0");

		const verified = await advanceExecutionLoop({
			paths,
			daemonClient: fakeDaemon,
		});
		expect(verified.action).toBe("verified");
		expect(fakeDaemon.submittedPrompts).toHaveLength(1);

		const second = await advanceExecutionLoop({
			paths,
			daemonClient: fakeDaemon,
		});
		expect(second.action).toBe("submitted");
		expect(fakeDaemon.submittedPrompts).toHaveLength(2);
		expect(fakeDaemon.submittedPrompts[1]).toContain("task index 1");
	});

	it("pauses without cancelling and cancellation leaves the task pending", async () => {
		const paths = await createStore();
		const fakeDaemon = new FakeDaemon();

		const submitted = await advanceExecutionLoop({
			paths,
			daemonClient: fakeDaemon,
		});
		expect(submitted.action).toBe("submitted");

		const paused = await markLoopPaused(paths);
		expect(paused.status).toBe("paused");
		expect(paused.attempts[0]?.status).toBe("running");

		const cancelled = await markActiveAttemptCancelled(paths);
		expect(cancelled.status).toBe("paused");
		expect(cancelled.attempts[0]?.status).toBe("cancelled");

		const resumed = await advanceExecutionLoop({
			paths,
			daemonClient: fakeDaemon,
		});
		expect(resumed.action).toBe("submitted");
		expect(resumed.attempt?.taskIndex).toBe(0);
		expect(fakeDaemon.submittedPrompts).toHaveLength(2);
	});
});

function makeJob(state: DaemonJob["state"], outputText?: string): DaemonJob {
	const now = new Date().toISOString();
	return {
		id: "job-test",
		instanceId: "instance-test",
		task: { type: "prompt", prompt: "test" },
		state,
		createdAt: now,
		updatedAt: now,
		outputText,
	};
}
