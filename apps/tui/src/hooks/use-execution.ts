import { daemon } from "@techatnyu/ralphd";
import { useCallback, useRef, useState } from "react";
import { Worktree, type WorktreeInfo } from "../lib/worktree";
import type { PrdTask } from "./use-plan-files";

export type TaskExecutionState =
	| "pending"
	| "creating"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

export interface TaskWorktree {
	taskIndex: number;
	task: PrdTask;
	worktreeName: string;
	worktreeInfo?: WorktreeInfo;
	instanceId?: string;
	jobId?: string;
	state: TaskExecutionState;
	error?: string;
}

export interface UseExecutionReturn {
	taskWorktrees: TaskWorktree[];
	executing: boolean;
	startAll: (tasks: PrdTask[]) => Promise<void>;
	cancelTask: (taskIndex: number) => Promise<void>;
	cancelAll: () => Promise<void>;
	cleanup: () => Promise<void>;
	refresh: () => Promise<void>;
}

function buildTaskPrompt(task: PrdTask): string {
	const lines = [
		task.description,
		"",
		"Subtasks:",
		...task.subtasks.map((s) => `- ${s}`),
	];
	if (task.notes) {
		lines.push("", `Notes: ${task.notes}`);
	}
	return lines.join("\n");
}

export function useExecution(): UseExecutionReturn {
	const [taskWorktrees, setTaskWorktrees] = useState<TaskWorktree[]>([]);
	const [executing, setExecuting] = useState(false);
	const worktreeRef = useRef(new Worktree());
	const taskWorktreesRef = useRef(taskWorktrees);
	taskWorktreesRef.current = taskWorktrees;

	const updateTask = useCallback(
		(taskIndex: number, updates: Partial<TaskWorktree>) => {
			setTaskWorktrees((prev) =>
				prev.map((tw) =>
					tw.taskIndex === taskIndex ? { ...tw, ...updates } : tw,
				),
			);
		},
		[],
	);

	const dispatchSingleTask = useCallback(
		async (tw: TaskWorktree): Promise<void> => {
			const wt = worktreeRef.current;

			try {
				updateTask(tw.taskIndex, { state: "creating" });

				// Check if worktree already exists
				const existing = await wt.list();
				let worktreeInfo = existing.find((w) => w.name === tw.worktreeName);
				if (!worktreeInfo) {
					worktreeInfo = await wt.create(tw.worktreeName);
				}

				// Check if instance already exists at this directory
				const { instances } = await daemon.listInstances();
				let instanceId: string | undefined;
				const existingInstance = instances.find(
					(i) => i.directory === worktreeInfo.path,
				);

				if (existingInstance) {
					instanceId = existingInstance.id;
				} else {
					const created = await daemon.createInstance({
						name: tw.worktreeName,
						directory: worktreeInfo.path,
						maxConcurrency: 1,
					});
					instanceId = created.instance.id;
				}

				// Start instance if stopped
				const instanceResult = await daemon.getInstance(instanceId);
				if (instanceResult.instance.status === "stopped") {
					await daemon.startInstance(instanceId);
				}

				// Submit job
				const prompt = buildTaskPrompt(tw.task);
				const { job } = await daemon.submitJob({
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt },
				});

				updateTask(tw.taskIndex, {
					worktreeInfo,
					instanceId,
					jobId: job.id,
					state: "running",
				});
			} catch (err) {
				updateTask(tw.taskIndex, {
					state: "failed",
					error: err instanceof Error ? err.message : "Failed to dispatch task",
				});
			}
		},
		[updateTask],
	);

	const startAll = useCallback(
		async (tasks: PrdTask[]) => {
			if (executing) return;
			setExecuting(true);

			try {
				// Build entries for pending tasks not already tracked
				const existingIndices = new Set(
					taskWorktreesRef.current.map((tw) => tw.taskIndex),
				);
				const newEntries: TaskWorktree[] = [];

				for (let i = 0; i < tasks.length; i++) {
					const task = tasks[i] as PrdTask;
					if (task.passed) continue;
					if (existingIndices.has(i)) continue;
					newEntries.push({
						taskIndex: i,
						task,
						worktreeName: `task-${i}`,
						state: "pending",
					});
				}

				// Reset previously failed tasks
				setTaskWorktrees((prev) => {
					const reset = prev.map((tw) =>
						tw.state === "failed"
							? { ...tw, state: "pending" as const, error: undefined }
							: tw,
					);
					return [...reset, ...newEntries];
				});

				// Collect all tasks to dispatch
				const toDispatch = [
					...taskWorktreesRef.current.filter(
						(tw) => tw.state === "failed" || tw.state === "pending",
					),
					...newEntries,
				];

				// Dispatch all in parallel
				await Promise.allSettled(
					toDispatch.map((tw) => dispatchSingleTask(tw)),
				);
			} finally {
				setExecuting(false);
			}
		},
		[executing, dispatchSingleTask],
	);

	const refresh = useCallback(async () => {
		const current = taskWorktreesRef.current.filter(
			(tw) => tw.jobId && (tw.state === "running" || tw.state === "creating"),
		);
		if (current.length === 0) return;

		const results = await Promise.allSettled(
			current.map((tw) => daemon.getJob(tw.jobId as string)),
		);

		setTaskWorktrees((prev) =>
			prev.map((tw) => {
				if (!tw.jobId || (tw.state !== "running" && tw.state !== "creating")) {
					return tw;
				}
				const idx = current.findIndex((c) => c.taskIndex === tw.taskIndex);
				if (idx === -1) return tw;
				const result = results[idx];
				if (!result || result.status === "rejected") return tw;

				const job = result.value.job;
				if (job.state === "succeeded") {
					return { ...tw, state: "succeeded" as const };
				}
				if (job.state === "failed") {
					return {
						...tw,
						state: "failed" as const,
						error: job.error ?? "Job failed",
					};
				}
				if (job.state === "cancelled") {
					return { ...tw, state: "cancelled" as const };
				}
				return tw;
			}),
		);
	}, []);

	const cancelTask = useCallback(
		async (taskIndex: number) => {
			const tw = taskWorktreesRef.current.find(
				(t) => t.taskIndex === taskIndex,
			);
			if (!tw?.jobId) return;
			try {
				await daemon.cancelJob(tw.jobId);
				updateTask(taskIndex, { state: "cancelled" });
			} catch (e) {
				updateTask(taskIndex, {
					state: "failed",
					error: e instanceof Error ? e.message : "Failed to cancel",
				});
			}
		},
		[updateTask],
	);

	const cancelAll = useCallback(async () => {
		const running = taskWorktreesRef.current.filter(
			(tw) => tw.jobId && (tw.state === "running" || tw.state === "creating"),
		);
		await Promise.allSettled(running.map((tw) => cancelTask(tw.taskIndex)));
	}, [cancelTask]);

	const cleanup = useCallback(async () => {
		const wt = worktreeRef.current;
		const terminal = taskWorktreesRef.current.filter(
			(tw) =>
				tw.state === "succeeded" ||
				tw.state === "failed" ||
				tw.state === "cancelled",
		);

		await Promise.allSettled(
			terminal.map(async (tw) => {
				if (tw.instanceId) {
					try {
						await daemon.removeInstance(tw.instanceId);
					} catch {
						// instance may already be removed
					}
				}
				try {
					await wt.remove(tw.worktreeName, { force: true });
				} catch {
					// worktree may already be removed
				}
			}),
		);

		setTaskWorktrees((prev) =>
			prev.filter(
				(tw) =>
					tw.state !== "succeeded" &&
					tw.state !== "failed" &&
					tw.state !== "cancelled",
			),
		);
	}, []);

	return {
		taskWorktrees,
		executing,
		startAll,
		cancelTask,
		cancelAll,
		cleanup,
		refresh,
	};
}
