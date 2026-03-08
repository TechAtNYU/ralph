import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	CancelResult,
	GetResult,
	HealthResult,
	ListResult,
	RequestMessage,
	SubmitResult,
} from "../protocol";
import { Daemon } from "../server";
import { StateStore } from "../store";

function req(
	method: RequestMessage["method"],
	params?: Record<string, unknown>,
): RequestMessage {
	return { id: `req-${Date.now()}-${Math.random()}`, method, params };
}

describe("Daemon", () => {
	let tmpDir: string;
	let store: StateStore;
	let daemon: Daemon;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-daemon-test-"));
		store = new StateStore(join(tmpDir, "state.json"));
		daemon = new Daemon(store);
		await daemon.bootstrap();
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("health", () => {
		test("returns pid and zero counters on fresh daemon", async () => {
			const res = await daemon.handleRequest(req("health"));
			expect(res.ok).toBe(true);
			const result = res.result as HealthResult;
			expect(result.pid).toBe(process.pid);
			expect(result.queued).toBe(0);
			expect(result.running).toBe(0);
			expect(result.finished).toBe(0);
			expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
		});
	});

	describe("submit", () => {
		test("creates a job and returns it", async () => {
			const res = await daemon.handleRequest(
				req("submit", { prompt: "hello world" }),
			);
			expect(res.ok).toBe(true);
			const result = res.result as SubmitResult;
			expect(result.job.prompt).toBe("hello world");
			expect(result.job.id).toBeTruthy();
			// Job should be running or queued (CONCURRENCY=1 so first job starts immediately)
			expect(["queued", "running"]).toContain(result.job.state);
		});

		test("rejects empty prompt", async () => {
			const res = await daemon.handleRequest(req("submit", { prompt: "" }));
			expect(res.ok).toBe(false);
			expect(res.error).toBe("prompt is required");
		});

		test("rejects missing prompt", async () => {
			const res = await daemon.handleRequest(req("submit", {}));
			expect(res.ok).toBe(false);
			expect(res.error).toBe("prompt is required");
		});

		test("rejects whitespace-only prompt", async () => {
			const res = await daemon.handleRequest(req("submit", { prompt: "   " }));
			expect(res.ok).toBe(false);
			expect(res.error).toBe("prompt is required");
		});
	});

	describe("list", () => {
		test("returns empty list on fresh daemon", async () => {
			const res = await daemon.handleRequest(req("list"));
			expect(res.ok).toBe(true);
			const result = res.result as ListResult;
			expect(result.jobs).toEqual([]);
		});

		test("returns submitted jobs", async () => {
			await daemon.handleRequest(req("submit", { prompt: "job 1" }));
			await daemon.handleRequest(req("submit", { prompt: "job 2" }));

			const res = await daemon.handleRequest(req("list"));
			expect(res.ok).toBe(true);
			const result = res.result as ListResult;
			expect(result.jobs).toHaveLength(2);
		});
	});

	describe("get", () => {
		test("returns a specific job by id", async () => {
			const submitRes = await daemon.handleRequest(
				req("submit", { prompt: "find me" }),
			);
			const jobId = (submitRes.result as SubmitResult).job.id;

			const res = await daemon.handleRequest(req("get", { jobId }));
			expect(res.ok).toBe(true);
			const result = res.result as GetResult;
			expect(result.job.id).toBe(jobId);
			expect(result.job.prompt).toBe("find me");
		});

		test("returns error for nonexistent job", async () => {
			const res = await daemon.handleRequest(
				req("get", { jobId: "nonexistent" }),
			);
			expect(res.ok).toBe(false);
			expect(res.error).toContain("not found");
		});
	});

	describe("cancel", () => {
		test("cancels a queued job", async () => {
			// Submit two jobs — with CONCURRENCY=1, the second should be queued
			await daemon.handleRequest(req("submit", { prompt: "first" }));
			const submitRes = await daemon.handleRequest(
				req("submit", { prompt: "second" }),
			);
			const secondJob = (submitRes.result as SubmitResult).job;

			// Wait a tick for drain to run
			await Bun.sleep(10);

			const res = await daemon.handleRequest(
				req("cancel", { jobId: secondJob.id }),
			);
			expect(res.ok).toBe(true);
			const result = res.result as CancelResult;
			expect(result.job.state).toBe("cancelled");
			expect(result.job.endedAt).toBeTruthy();
		});

		test("returns error for nonexistent job", async () => {
			const res = await daemon.handleRequest(req("cancel", { jobId: "ghost" }));
			expect(res.ok).toBe(false);
			expect(res.error).toContain("not found");
		});
	});

	describe("unsupported method", () => {
		test("returns error for unknown method", async () => {
			const res = await daemon.handleRequest(
				req("unknown" as RequestMessage["method"]),
			);
			expect(res.ok).toBe(false);
			expect(res.error).toContain("unsupported method");
		});
	});

	describe("health counters after operations", () => {
		test("reflects queued and running counts", async () => {
			await daemon.handleRequest(req("submit", { prompt: "a" }));
			await daemon.handleRequest(req("submit", { prompt: "b" }));

			// Let drain run
			await Bun.sleep(10);

			const res = await daemon.handleRequest(req("health"));
			const result = res.result as HealthResult;
			// With CONCURRENCY=1: 1 running, 1 queued
			expect(result.running).toBe(1);
			expect(result.queued).toBe(1);
		});
	});

	describe("bootstrap recovery", () => {
		test("recovers running jobs as queued on restart", async () => {
			// Pre-seed state with a "running" job
			const now = new Date().toISOString();
			await store.save({
				jobs: [
					{
						id: "stale-job",
						prompt: "stale",
						state: "running",
						createdAt: now,
						updatedAt: now,
						startedAt: now,
					},
				],
			});

			// Create a new daemon with same store and bootstrap
			const daemon2 = new Daemon(store);
			await daemon2.bootstrap();

			const res = await daemon2.handleRequest(
				req("get", { jobId: "stale-job" }),
			);
			expect(res.ok).toBe(true);
			const result = res.result as GetResult;
			// Should have been re-queued (and likely immediately picked up as running again)
			expect(["queued", "running"]).toContain(result.job.state);
			expect(result.job.error).toBe("Recovered after daemon restart");
		});

		test("preserves succeeded/failed jobs on restart", async () => {
			const now = new Date().toISOString();
			await store.save({
				jobs: [
					{
						id: "done-job",
						prompt: "done",
						state: "succeeded",
						createdAt: now,
						updatedAt: now,
						startedAt: now,
						endedAt: now,
						output: "result",
					},
				],
			});

			const daemon2 = new Daemon(store);
			await daemon2.bootstrap();

			const res = await daemon2.handleRequest(
				req("get", { jobId: "done-job" }),
			);
			expect(res.ok).toBe(true);
			const result = res.result as GetResult;
			expect(result.job.state).toBe("succeeded");
		});
	});
});
