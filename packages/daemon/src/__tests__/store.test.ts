import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StateStore, StoreError } from "../store";

describe("StateStore — unopened guard", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("createJob throws when store is not open", () => {
		const fresh = new StateStore(join(tmpDir, "unopened.sqlite"));
		expect(() =>
			fresh.createJob({
				instanceId: "x",
				session: { type: "new" },
				task: { type: "prompt", prompt: "hi" },
			}),
		).toThrow(/not open/);
	});

	test("recoverForBootstrap throws when store is not open", () => {
		const fresh = new StateStore(join(tmpDir, "unopened.sqlite"));
		expect(() => fresh.recoverForBootstrap()).toThrow(/not open/);
	});
});

describe("StateStore", () => {
	let tmpDir: string;
	let databasePath: string;
	let store: StateStore;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-test-"));
		databasePath = join(tmpDir, "state.sqlite");
		store = new StateStore(databasePath);
		await store.open();
	});

	afterEach(async () => {
		store.close();
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("starts empty on a fresh database", () => {
		expect(store.listInstances()).toEqual([]);
		expect(store.listJobs()).toEqual([]);
	});

	test("writes a SQLite file on open", async () => {
		const raw = await readFile(databasePath, "utf8");
		expect(raw.slice(0, 15)).toBe("SQLite format 3");
	});

	test("creates instances with a generated id and stopped status", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 2,
		});
		expect(instance.id).toBeTruthy();
		expect(instance.status).toBe("stopped");
		expect(instance.maxConcurrency).toBe(2);
	});

	test("rejects duplicate instance directories", () => {
		store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		expect(() =>
			store.createInstance({
				name: "Two",
				directory: "/tmp/project-one",
				maxConcurrency: 1,
			}),
		).toThrow(StoreError);
	});

	test("setInstanceStatus updates status and lastError", () => {
		const created = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		const running = store.setInstanceStatus(created.id, "running");
		expect(running.status).toBe("running");
		expect(running.lastError).toBeUndefined();

		const failed = store.setInstanceStatus(created.id, "error", "boom");
		expect(failed.status).toBe("error");
		expect(failed.lastError).toBe("boom");
	});

	test("createJob creates a queued job linked to a session row", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		const job = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "hello" },
		});
		expect(job.state).toBe("queued");
		expect(job.sessionId).toBeUndefined();
		expect(job.task).toEqual({ type: "prompt", prompt: "hello" });
	});

	test("deduplicates sessions for two jobs sharing the same remote session", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		store.createJob({
			instanceId: instance.id,
			session: { type: "existing", sessionId: "remote-sess-1" },
			task: { type: "prompt", prompt: "a" },
		});
		store.createJob({
			instanceId: instance.id,
			session: { type: "existing", sessionId: "remote-sess-1" },
			task: { type: "prompt", prompt: "b" },
		});

		const db = new Database(databasePath, { readonly: true });
		const row = db.query("SELECT COUNT(*) AS c FROM sessions").get() as {
			c: number;
		};
		db.close();
		expect(row.c).toBe(1);
	});

	test("listSessions and assertSession only include resolved remote ids", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		const job = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "hi" },
		});
		expect(store.listSessions({ instanceId: instance.id })).toHaveLength(0);

		store.assignRemoteSessionToJob(job.id, "remote-abc", "My title");
		const sessions = store.listSessions({ instanceId: instance.id });
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.id).toBe("remote-abc");
		expect(sessions[0]?.title).toBe("My title");
		expect(store.assertSession("remote-abc").instanceId).toBe(instance.id);
	});

	test("listJobs filters by sessionId", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		const j1 = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "a" },
		});
		const j2 = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "b" },
		});
		store.assignRemoteSessionToJob(j1.id, "sess-x", "t1");
		store.assignRemoteSessionToJob(j2.id, "sess-y", "t2");

		const filtered = store.listJobs({ sessionId: "sess-x" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.id).toBe(j1.id);
	});

	test("markJobRunning and markJobTerminal drive state transitions", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		const job = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "hi" },
		});

		const running = store.markJobRunning(job.id);
		expect(running.state).toBe("running");
		expect(running.startedAt).toBeTruthy();

		const done = store.markJobTerminal(job.id, "succeeded", {
			outputText: "result",
			messageId: "msg-1",
		});
		expect(done.state).toBe("succeeded");
		expect(done.outputText).toBe("result");
		expect(done.messageId).toBe("msg-1");
		expect(done.endedAt).toBeTruthy();
	});

	test("appendJobOutput concatenates deltas", () => {
		const instance = store.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		const job = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "hi" },
		});
		store.appendJobOutput(job.id, "foo ");
		store.appendJobOutput(job.id, "bar");
		expect(store.assertJob(job.id).outputText).toBe("foo bar");
	});

	test("listJobs filters by instance and state", () => {
		const a = store.createInstance({
			name: "A",
			directory: "/tmp/a",
			maxConcurrency: 1,
		});
		const b = store.createInstance({
			name: "B",
			directory: "/tmp/b",
			maxConcurrency: 1,
		});
		store.createJob({
			instanceId: a.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "1" },
		});
		const j2 = store.createJob({
			instanceId: a.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "2" },
		});
		store.createJob({
			instanceId: b.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "3" },
		});
		store.markJobRunning(j2.id);

		expect(store.listJobs({ instanceId: a.id })).toHaveLength(2);
		expect(store.listJobs({ state: "running" })).toHaveLength(1);
		expect(store.listJobs({ instanceId: a.id, state: "queued" })).toHaveLength(
			1,
		);
	});

	test("recoverForBootstrap requeues running jobs and resets instances", () => {
		const instance = store.createInstance({
			name: "A",
			directory: "/tmp/a",
			maxConcurrency: 1,
		});
		store.setInstanceStatus(instance.id, "running");
		const job = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "hi" },
		});
		store.markJobRunning(job.id);

		const requeued = store.recoverForBootstrap();
		expect(requeued).toEqual([{ id: job.id, instanceId: instance.id }]);
		expect(store.assertJob(job.id).state).toBe("queued");
		expect(store.assertInstance(instance.id).status).toBe("stopped");
	});

	test("recoverForBootstrap appends to existing job error on requeue", () => {
		const instance = store.createInstance({
			name: "A",
			directory: "/tmp/a",
			maxConcurrency: 1,
		});
		const job = store.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "hi" },
		});
		// Seed a running job that already has a non-null error (e.g. from a
		// prior partial terminal write that did not commit to a terminal state).
		store.markJobRunning(job.id);
		const db = new Database(databasePath);
		db.run("UPDATE jobs SET error = 'prior error' WHERE id = ?", [job.id]);
		db.close();

		store.recoverForBootstrap();
		const recovered = store.assertJob(job.id);
		expect(recovered.state).toBe("queued");
		expect(recovered.error).toBe("prior error Recovered after daemon restart");
	});

	test("assignRemoteSessionToJob throws when job does not exist", () => {
		expect(() =>
			store.assignRemoteSessionToJob(
				"00000000-0000-0000-0000-000000000000",
				"remote-xyz",
				"title",
			),
		).toThrow(StoreError);
	});

	test("pruneTerminalJobs keeps the newest N terminal rows", () => {
		const instance = store.createInstance({
			name: "A",
			directory: "/tmp/a",
			maxConcurrency: 1,
		});
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			const job = store.createJob({
				instanceId: instance.id,
				session: { type: "new" },
				task: { type: "prompt", prompt: `p-${i}` },
			});
			store.markJobTerminal(job.id, "succeeded", { outputText: String(i) });
			ids.push(job.id);
			// Space created_at so ordering is deterministic.
			const db = new Database(databasePath);
			db.run("UPDATE jobs SET created_at = ? WHERE id = ?", [
				new Date(Date.now() + i * 1000).toISOString(),
				job.id,
			]);
			db.close();
		}
		store.pruneTerminalJobs(2);
		const remaining = store.listJobs();
		expect(remaining).toHaveLength(2);
		// Newest two should survive (ids[4], ids[3]).
		const remainingIds = new Set(remaining.map((j) => j.id));
		expect(remainingIds.has(ids[4] as string)).toBe(true);
		expect(remainingIds.has(ids[3] as string)).toBe(true);
	});
});
