import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DaemonState, LoopJob } from "../protocol";
import { StateStore } from "../store";

function makeJob(overrides: Partial<LoopJob> = {}): LoopJob {
	return {
		id: overrides.id ?? "job-1",
		prompt: overrides.prompt ?? "test prompt",
		state: overrides.state ?? "queued",
		createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
		updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("StateStore", () => {
	let tmpDir: string;
	let statePath: string;
	let store: StateStore;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-test-"));
		statePath = join(tmpDir, "state.json");
		store = new StateStore(statePath);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("load", () => {
		test("returns empty state when file does not exist", async () => {
			const state = await store.load();
			expect(state).toEqual({ jobs: [] });
		});

		test("returns empty state when file has invalid JSON structure", async () => {
			await Bun.write(statePath, JSON.stringify({ jobs: "not-an-array" }));
			const state = await store.load();
			expect(state).toEqual({ jobs: [] });
		});

		test("loads persisted jobs from disk", async () => {
			const job = makeJob();
			await Bun.write(statePath, JSON.stringify({ jobs: [job] }));

			const state = await store.load();
			expect(state.jobs).toHaveLength(1);
			expect(state.jobs[0]?.id).toBe("job-1");
		});

		test("throws on non-ENOENT errors", async () => {
			// Point at a directory instead of file to trigger EISDIR
			const badStore = new StateStore(tmpDir);
			expect(badStore.load()).rejects.toThrow();
		});
	});

	describe("save", () => {
		test("writes state to disk as formatted JSON", async () => {
			const state: DaemonState = { jobs: [makeJob()] };
			await store.save(state);

			const raw = await readFile(statePath, "utf8");
			expect(raw).toEndWith("\n");
			const parsed = JSON.parse(raw);
			expect(parsed.jobs).toHaveLength(1);
			expect(parsed.jobs[0].id).toBe("job-1");
		});

		test("creates parent directories if missing", async () => {
			const nestedPath = join(tmpDir, "a", "b", "state.json");
			const nestedStore = new StateStore(nestedPath);
			await nestedStore.save({ jobs: [] });

			const raw = await readFile(nestedPath, "utf8");
			expect(JSON.parse(raw)).toEqual({ jobs: [] });
		});
	});

	describe("upsertJob", () => {
		test("adds a new job to empty state", () => {
			const state: DaemonState = { jobs: [] };
			const job = makeJob();
			const next = store.upsertJob(state, job);
			expect(next.jobs).toHaveLength(1);
			expect(next.jobs[0]?.id).toBe("job-1");
		});

		test("replaces existing job with same id", () => {
			const state: DaemonState = { jobs: [makeJob()] };
			const updated = makeJob({ state: "running" });
			const next = store.upsertJob(state, updated);
			expect(next.jobs).toHaveLength(1);
			expect(next.jobs[0]?.state).toBe("running");
		});

		test("does not mutate original state object", () => {
			const state: DaemonState = { jobs: [makeJob()] };
			const updated = makeJob({
				id: "job-2",
				createdAt: "2026-01-02T00:00:00.000Z",
			});
			const next = store.upsertJob(state, updated);
			expect(state.jobs).toHaveLength(1);
			expect(next.jobs).toHaveLength(2);
		});

		test("sorts jobs by createdAt descending", () => {
			const state: DaemonState = { jobs: [] };
			const job1 = makeJob({
				id: "job-1",
				createdAt: "2026-01-01T00:00:00.000Z",
			});
			const job2 = makeJob({
				id: "job-2",
				createdAt: "2026-01-03T00:00:00.000Z",
			});
			const job3 = makeJob({
				id: "job-3",
				createdAt: "2026-01-02T00:00:00.000Z",
			});
			let next = store.upsertJob(state, job1);
			next = store.upsertJob(next, job2);
			next = store.upsertJob(next, job3);
			expect(next.jobs.map((j) => j.id)).toEqual(["job-2", "job-3", "job-1"]);
		});
	});

	describe("getJob", () => {
		test("returns job by id", () => {
			const state: DaemonState = { jobs: [makeJob()] };
			const found = store.getJob(state, "job-1");
			expect(found).toBeDefined();
			expect(found?.id).toBe("job-1");
		});

		test("returns undefined for missing id", () => {
			const state: DaemonState = { jobs: [makeJob()] };
			const found = store.getJob(state, "nonexistent");
			expect(found).toBeUndefined();
		});
	});

	describe("round-trip", () => {
		test("save then load preserves data", async () => {
			const job = makeJob({ state: "succeeded", output: "done" });
			const state: DaemonState = { jobs: [job] };
			await store.save(state);

			const loaded = await store.load();
			expect(loaded.jobs).toHaveLength(1);
			expect(loaded.jobs[0]?.state).toBe("succeeded");
			expect(loaded.jobs[0]?.output).toBe("done");
		});
	});
});
