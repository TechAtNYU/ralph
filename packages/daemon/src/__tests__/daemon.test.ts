import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	RequestMessage,
	RequestMethod,
	ResponseMessage,
	ResultByMethod,
} from "../protocol";
import { RequestMessage as RequestMessageSchema } from "../protocol";
import { Daemon } from "../server";
import { StateStore } from "../store";
import { FakeOpencodeRegistry } from "./helpers";

function req(payload: RequestMessage): RequestMessage {
	return RequestMessageSchema.parse(payload);
}

function expectSuccess<M extends RequestMethod>(
	response: ResponseMessage,
	method: M,
): ResultByMethod<M> {
	expect(response.ok).toBe(true);
	if (!response.ok || response.method !== method || !("result" in response)) {
		throw new Error(`expected success for ${method}`);
	}
	return response.result as ResultByMethod<M>;
}

function expectFailure(
	response: ResponseMessage,
): ResponseMessage & { ok: false } {
	expect(response.ok).toBe(false);
	if (response.ok) {
		throw new Error("expected failure response");
	}
	return response;
}

describe("Daemon", () => {
	let tmpDir: string;
	let store: StateStore;
	let registry: FakeOpencodeRegistry;
	let daemon: Daemon;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-daemon-test-"));
		store = new StateStore(join(tmpDir, "state.json"));
		registry = new FakeOpencodeRegistry(40);
		daemon = new Daemon(store, { registry });
		await daemon.bootstrap();
	});

	afterEach(async () => {
		await daemon.shutdown();
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("creates an instance", async () => {
		const response = await daemon.handleRequest(
			req({
				id: "instance-create",
				method: "instance.create",
				params: {
					name: "One",
					directory: "/tmp/project-one",
				},
			}),
		);
		const result = expectSuccess(response, "instance.create");
		expect(result.instance.id).toBeTruthy();
	});

	test("submits a job against a specific instance", async () => {
		const created = await daemon.handleRequest(
			req({
				id: "instance-create",
				method: "instance.create",
				params: {
					name: "One",
					directory: "/tmp/project-one",
				},
			}),
		);
		const instance = expectSuccess(created, "instance.create");
		const submit = await daemon.handleRequest(
			req({
				id: "job-submit",
				method: "job.submit",
				params: {
					instanceId: instance.instance.id,
					session: { type: "new" },
					task: {
						type: "prompt",
						prompt: "hello world",
					},
				},
			}),
		);
		const result = expectSuccess(submit, "job.submit");
		expect(result.job.instanceId).toBe(instance.instance.id);
	});

	test("rejects submit with nonexistent instance", async () => {
		const submit = await daemon.handleRequest(
			req({
				id: "job-submit",
				method: "job.submit",
				params: {
					instanceId: "nonexistent",
					session: { type: "new" },
					task: {
						type: "prompt",
						prompt: "hello world",
					},
				},
			}),
		);
		expect(expectFailure(submit).error.code).toBe("not_found");
	});

	test("runs jobs on different instances in parallel", async () => {
		const createOne = await daemon.handleRequest(
			req({
				id: "instance-create-1",
				method: "instance.create",
				params: {
					name: "One",
					directory: "/tmp/project-one",
				},
			}),
		);
		const createTwo = await daemon.handleRequest(
			req({
				id: "instance-create-2",
				method: "instance.create",
				params: {
					name: "Two",
					directory: "/tmp/project-two",
				},
			}),
		);
		const one = expectSuccess(createOne, "instance.create");
		const two = expectSuccess(createTwo, "instance.create");

		await daemon.handleRequest(
			req({
				id: "job-submit-1",
				method: "job.submit",
				params: {
					instanceId: one.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "one" },
				},
			}),
		);
		await daemon.handleRequest(
			req({
				id: "job-submit-2",
				method: "job.submit",
				params: {
					instanceId: two.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "two" },
				},
			}),
		);

		await Bun.sleep(80);
		expect(registry.globalMaxConcurrent).toBeGreaterThanOrEqual(2);
	});

	test("respects per-instance concurrency", async () => {
		const created = await daemon.handleRequest(
			req({
				id: "instance-create",
				method: "instance.create",
				params: {
					name: "One",
					directory: "/tmp/project-one",
					maxConcurrency: 1,
				},
			}),
		);
		const createdResult = expectSuccess(created, "instance.create");

		await daemon.handleRequest(
			req({
				id: "job-submit-1",
				method: "job.submit",
				params: {
					instanceId: createdResult.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "first" },
				},
			}),
		);
		await daemon.handleRequest(
			req({
				id: "job-submit-2",
				method: "job.submit",
				params: {
					instanceId: createdResult.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "second" },
				},
			}),
		);

		await Bun.sleep(90);
		expect(
			registry.maxConcurrentByInstance.get(createdResult.instance.id),
		).toBe(1);
	});

	test("cancels a queued job", async () => {
		const one = await daemon.handleRequest(
			req({
				id: "instance-create-1",
				method: "instance.create",
				params: {
					name: "One",
					directory: "/tmp/project-one",
					maxConcurrency: 1,
				},
			}),
		);
		const oneResult = expectSuccess(one, "instance.create");

		await daemon.handleRequest(
			req({
				id: "job-submit-1",
				method: "job.submit",
				params: {
					instanceId: oneResult.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "first" },
				},
			}),
		);
		const queued = await daemon.handleRequest(
			req({
				id: "job-submit-2",
				method: "job.submit",
				params: {
					instanceId: oneResult.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "second" },
				},
			}),
		);
		const queuedResult = expectSuccess(queued, "job.submit");

		const cancel = await daemon.handleRequest(
			req({
				id: "job-cancel",
				method: "job.cancel",
				params: {
					jobId: queuedResult.job.id,
				},
			}),
		);
		expect(expectSuccess(cancel, "job.cancel").job.state).toBe("cancelled");
	});

	test("requeues running jobs after restart", async () => {
		await store.save({
			instances: [
				{
					id: "instance-1",
					name: "One",
					directory: "/tmp/project-one",
					status: "running",
					maxConcurrency: 1,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
			sessions: [],
			jobs: [
				{
					id: "job-1",
					instanceId: "instance-1",
					session: { type: "new" },
					task: { type: "prompt", prompt: "recover" },
					state: "running",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		const nextDaemon = new Daemon(store, {
			registry: new FakeOpencodeRegistry(10),
		});
		await nextDaemon.bootstrap();
		const response = await nextDaemon.handleRequest(
			req({
				id: "job-get",
				method: "job.get",
				params: { jobId: "job-1" },
			}),
		);
		expect(["queued", "running", "succeeded"]).toContain(
			expectSuccess(response, "job.get").job.state,
		);
		await nextDaemon.shutdown();
	});
});

describe("Daemon sessions", () => {
	let tmpDir: string;
	let store: StateStore;
	let registry: FakeOpencodeRegistry;
	let daemon: Daemon;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-daemon-session-"));
		store = new StateStore(join(tmpDir, "state.json"));
		registry = new FakeOpencodeRegistry(10);
		daemon = new Daemon(store, { registry });
		await daemon.bootstrap();
	});

	afterEach(async () => {
		await daemon.shutdown();
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function createInstance(
		name = "One",
		directory = "/tmp/project-one",
	): Promise<string> {
		const res = await daemon.handleRequest(
			req({
				id: `create-${name}`,
				method: "instance.create",
				params: { name, directory },
			}),
		);
		return expectSuccess(res, "instance.create").instance.id;
	}

	test("creates a session when a new-session job completes", async () => {
		const instanceId = await createInstance();

		await daemon.handleRequest(
			req({
				id: "submit",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: "hello world" },
				},
			}),
		);

		await Bun.sleep(80);

		const res = await daemon.handleRequest(
			req({
				id: "session-list",
				method: "session.list",
				params: { instanceId },
			}),
		);
		const result = expectSuccess(res, "session.list");
		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0]?.instanceId).toBe(instanceId);
		expect(result.sessions[0]?.title).toBe("hello world");
	});

	test("derives title from prompt text, truncating long prompts", async () => {
		const instanceId = await createInstance();
		const longPrompt = "a".repeat(200);

		await daemon.handleRequest(
			req({
				id: "submit",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: longPrompt },
				},
			}),
		);

		await Bun.sleep(80);

		const res = await daemon.handleRequest(
			req({
				id: "session-list",
				method: "session.list",
				params: { instanceId },
			}),
		);
		const result = expectSuccess(res, "session.list");
		expect(result.sessions[0]?.title.length).toBeLessThanOrEqual(80);
		const title = result.sessions[0]?.title ?? "";
		expect(title).toEndWith("...");
	});

	test("session.get returns a specific session", async () => {
		const instanceId = await createInstance();

		await daemon.handleRequest(
			req({
				id: "submit",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: "test get" },
				},
			}),
		);

		await Bun.sleep(80);

		const listRes = await daemon.handleRequest(
			req({
				id: "session-list",
				method: "session.list",
				params: { instanceId },
			}),
		);
		const sessions = expectSuccess(listRes, "session.list").sessions;
		const session = sessions[0];
		if (!session) throw new Error("expected at least one session");

		const getRes = await daemon.handleRequest(
			req({
				id: "session-get",
				method: "session.get",
				params: { sessionId: session.id },
			}),
		);
		const result = expectSuccess(getRes, "session.get");
		expect(result.session.id).toBe(session.id);
		expect(result.session.title).toBe("test get");
	});

	test("job.list filters by sessionId", async () => {
		const instanceId = await createInstance();

		// Submit two jobs that create separate sessions
		await daemon.handleRequest(
			req({
				id: "submit-1",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: "first session" },
				},
			}),
		);

		await Bun.sleep(80);

		await daemon.handleRequest(
			req({
				id: "submit-2",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: "second session" },
				},
			}),
		);

		await Bun.sleep(80);

		// Get all jobs — should be 2
		const allRes = await daemon.handleRequest(
			req({
				id: "job-list-all",
				method: "job.list",
				params: { instanceId },
			}),
		);
		const allJobs = expectSuccess(allRes, "job.list").jobs;
		expect(allJobs).toHaveLength(2);

		// Get the sessionId of the first job
		const firstJob = allJobs.find(
			(j) => j.task.type === "prompt" && j.task.prompt === "first session",
		);
		if (!firstJob?.sessionId) throw new Error("expected job with sessionId");

		// Filter by that sessionId
		const filteredRes = await daemon.handleRequest(
			req({
				id: "job-list-filtered",
				method: "job.list",
				params: { instanceId, sessionId: firstJob.sessionId },
			}),
		);
		const filtered = expectSuccess(filteredRes, "job.list").jobs;
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.sessionId).toBe(firstJob.sessionId);
	});

	test("removing an instance cascades to its sessions", async () => {
		const instanceId = await createInstance();

		await daemon.handleRequest(
			req({
				id: "submit",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: "doomed" },
				},
			}),
		);

		await Bun.sleep(80);

		// Verify session exists
		const before = await daemon.handleRequest(
			req({
				id: "session-list-before",
				method: "session.list",
				params: { instanceId },
			}),
		);
		expect(expectSuccess(before, "session.list").sessions).toHaveLength(1);

		// Remove the instance
		await daemon.handleRequest(
			req({
				id: "instance-remove",
				method: "instance.remove",
				params: { instanceId },
			}),
		);

		// Verify sessions are gone
		const after = await daemon.handleRequest(
			req({
				id: "session-list-after",
				method: "session.list",
				params: { instanceId },
			}),
		);
		expect(expectSuccess(after, "session.list").sessions).toHaveLength(0);
	});
});

describe("Daemon streaming", () => {
	let tmpDir: string;
	let store: StateStore;
	let registry: FakeOpencodeRegistry;
	let daemon: Daemon;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-daemon-stream-"));
		store = new StateStore(join(tmpDir, "state.json"));
		registry = new FakeOpencodeRegistry(40);
		daemon = new Daemon(store, { registry });
		await daemon.bootstrap();
	});

	afterEach(async () => {
		await daemon.shutdown();
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function createInstanceAndSubmit(
		prompt: string,
	): Promise<{ instanceId: string; jobId: string }> {
		const created = await daemon.handleRequest(
			req({
				id: "instance-create",
				method: "instance.create",
				params: { name: "One", directory: "/tmp/project-one" },
			}),
		);
		const instance = expectSuccess(created, "instance.create");
		const submitted = await daemon.handleRequest(
			req({
				id: "job-submit",
				method: "job.submit",
				params: {
					instanceId: instance.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt },
				},
			}),
		);
		const submitResult = expectSuccess(submitted, "job.submit");
		return {
			instanceId: instance.instance.id,
			jobId: submitResult.job.id,
		};
	}

	test("subscribeJob delivers an immediate done for a terminal job", async () => {
		const { jobId } = await createInstanceAndSubmit("hello");
		await Bun.sleep(120);

		const events: Array<{ type: string }> = [];
		const unsub = daemon.subscribeJob(jobId, (event) => {
			events.push(event);
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("done");
		unsub();
	});

	test("subscribeJob delivers a snapshot for a running job", async () => {
		registry.streamingDeltas = [" hello", " world", "!"];
		registry.deltaIntervalMs = 30;

		const { jobId } = await createInstanceAndSubmit("hi");
		await Bun.sleep(45);

		const events: Array<
			| { type: "snapshot"; text: string }
			| { type: "delta"; delta: string }
			| { type: "done" }
			| { type: "error" }
		> = [];
		const unsub = daemon.subscribeJob(jobId, (event) => {
			events.push(event as never);
		});

		expect(events[0]?.type).toBe("snapshot");
		const snapshot = events[0] as { type: "snapshot"; text: string };
		expect(snapshot.text.length).toBeGreaterThan(0);

		await Bun.sleep(150);
		unsub();

		const types = events.map((e) => e.type);
		expect(types[0]).toBe("snapshot");
		expect(types[types.length - 1]).toBe("done");
		expect(types).toContain("delta");
	});

	test("deltas accumulate into job.outputText", async () => {
		registry.streamingDeltas = ["foo ", "bar ", "baz"];

		const { jobId } = await createInstanceAndSubmit("ignored");
		await Bun.sleep(120);

		const get = await daemon.handleRequest(
			req({ id: "g", method: "job.get", params: { jobId } }),
		);
		const job = expectSuccess(get, "job.get").job;
		expect(job.state).toBe("succeeded");
		expect(job.outputText).toBe("foo bar baz");
	});

	test("executeJob preserves accumulated text rather than overwriting with parts", async () => {
		registry.streamingDeltas = ["a", "b", "c"];
		registry.deltaIntervalMs = 25;

		const { jobId } = await createInstanceAndSubmit("test");

		await Bun.sleep(40);
		let mid = await daemon.handleRequest(
			req({ id: "g1", method: "job.get", params: { jobId } }),
		);
		let midJob = expectSuccess(mid, "job.get").job;
		expect(midJob.state).toBe("running");
		expect(midJob.outputText?.length ?? 0).toBeGreaterThan(0);
		expect(midJob.outputText?.length ?? 0).toBeLessThan(3);

		await Bun.sleep(100);
		mid = await daemon.handleRequest(
			req({ id: "g2", method: "job.get", params: { jobId } }),
		);
		midJob = expectSuccess(mid, "job.get").job;
		expect(midJob.state).toBe("succeeded");
		expect(midJob.outputText).toBe("abc");
	});

	test("executeJob falls back to extractText when no deltas were emitted", async () => {
		const { jobId } = await createInstanceAndSubmit("plain");
		await Bun.sleep(80);

		const get = await daemon.handleRequest(
			req({ id: "g", method: "job.get", params: { jobId } }),
		);
		const job = expectSuccess(get, "job.get").job;
		expect(job.state).toBe("succeeded");
		expect(job.outputText).toBe("reply:plain");
	});

	test("late subscriber gets snapshot of accumulated text and continues without duplicates", async () => {
		registry.streamingDeltas = ["alpha ", "beta ", "gamma ", "delta"];
		registry.deltaIntervalMs = 25;

		const { jobId } = await createInstanceAndSubmit("late");
		await Bun.sleep(70);

		const events: Array<
			| { type: "snapshot"; text: string }
			| { type: "delta"; delta: string }
			| { type: "done" }
			| { type: "error" }
		> = [];
		const unsub = daemon.subscribeJob(jobId, (event) => {
			events.push(event as never);
		});

		await Bun.sleep(150);
		unsub();

		const first = events[0];
		if (first?.type !== "snapshot") {
			throw new Error("expected first event to be snapshot");
		}
		expect(first.text.length).toBeGreaterThan(0);

		const observedFromSnapshot = events
			.slice(1)
			.filter((e): e is { type: "delta"; delta: string } => e.type === "delta")
			.reduce((acc, e) => acc + e.delta, first.text);

		const get = await daemon.handleRequest(
			req({ id: "g", method: "job.get", params: { jobId } }),
		);
		const finalText = expectSuccess(get, "job.get").job.outputText ?? "";
		expect(observedFromSnapshot).toBe(finalText);
	});
});
