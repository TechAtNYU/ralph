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
		store = new StateStore(join(tmpDir, "state.sqlite"));
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

	test("forwards new session titles when creating remote sessions", async () => {
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

		await daemon.handleRequest(
			req({
				id: "job-submit",
				method: "job.submit",
				params: {
					instanceId: instance.instance.id,
					session: { type: "new", title: "Sprint Planning" },
					task: {
						type: "prompt",
						prompt: "hello world",
					},
				},
			}),
		);

		await Bun.sleep(80);
		expect(registry.sessionCreateCalls).toContainEqual({
			instanceId: instance.instance.id,
			directory: "/tmp/project-one",
			title: "Sprint Planning",
		});
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

	test("cancelling a running job preserves the cancel error on the terminal row", async () => {
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

		const submitted = await daemon.handleRequest(
			req({
				id: "job-submit",
				method: "job.submit",
				params: {
					instanceId: createdResult.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "long-task" },
				},
			}),
		);
		const submittedResult = expectSuccess(submitted, "job.submit");

		// Wait until the job has transitioned to running inside the fake runtime.
		await Bun.sleep(10);

		const cancel = await daemon.handleRequest(
			req({
				id: "job-cancel",
				method: "job.cancel",
				params: { jobId: submittedResult.job.id },
			}),
		);
		const cancelled = expectSuccess(cancel, "job.cancel").job;
		expect(cancelled.state).toBe("cancelled");
		expect(cancelled.error).toBe("Job cancelled");

		// Double-check via store after execution has fully settled — no later
		// terminal write should have nulled out the error column.
		await Bun.sleep(60);
		const get = await daemon.handleRequest(
			req({
				id: "job-get",
				method: "job.get",
				params: { jobId: submittedResult.job.id },
			}),
		);
		const finalJob = expectSuccess(get, "job.get").job;
		expect(finalJob.state).toBe("cancelled");
		expect(finalJob.error).toBe("Job cancelled");
	});

	test("cancelling a running job returns within the timeout when the remote is slow", async () => {
		// Recreate the daemon with a very long prompt delay and a short
		// cancel wait timeout. The fake runtime's `abort` is a no-op so
		// the prompt always runs to completion — this simulates a remote
		// runtime that ignores `session.abort`.
		await daemon.shutdown();
		const slowRegistry = new FakeOpencodeRegistry(1_000);
		const slowStore = new StateStore(join(tmpDir, "slow.sqlite"));
		const slowDaemon = new Daemon(slowStore, {
			registry: slowRegistry,
			cancelWaitTimeoutMs: 30,
		});
		await slowDaemon.bootstrap();

		const created = await slowDaemon.handleRequest(
			req({
				id: "inst",
				method: "instance.create",
				params: {
					name: "slow",
					directory: "/tmp/project-slow",
					maxConcurrency: 1,
				},
			}),
		);
		const instanceId = expectSuccess(created, "instance.create").instance.id;

		const submitted = await slowDaemon.handleRequest(
			req({
				id: "sub",
				method: "job.submit",
				params: {
					instanceId,
					session: { type: "new" },
					task: { type: "prompt", prompt: "slow" },
				},
			}),
		);
		const jobId = expectSuccess(submitted, "job.submit").job.id;

		// Wait until the job is running.
		await Bun.sleep(20);

		// Cancel and measure.
		const start = Date.now();
		const cancel = await slowDaemon.handleRequest(
			req({
				id: "cancel",
				method: "job.cancel",
				params: { jobId },
			}),
		);
		const elapsed = Date.now() - start;

		// Must return well before the 1s prompt delay completes.
		expect(elapsed).toBeLessThan(500);
		// Returned row may still be `running` (timeout fired first) — that
		// is the point of the timeout; the terminal row will arrive via
		// the `done` stream event.
		const returned = expectSuccess(cancel, "job.cancel").job;
		expect(["running", "cancelled"]).toContain(returned.state);

		// Allow the fake's prompt to complete and executeJob to record
		// the terminal row.
		await Bun.sleep(1_100);
		const get = await slowDaemon.handleRequest(
			req({
				id: "get",
				method: "job.get",
				params: { jobId },
			}),
		);
		const settled = expectSuccess(get, "job.get").job;
		expect(settled.state).toBe("cancelled");
		expect(settled.error).toBe("Job cancelled");

		await slowDaemon.shutdown();
	});

	test("session.list rejects unknown instance ids", async () => {
		const response = await daemon.handleRequest(
			req({
				id: "session-list",
				method: "session.list",
				params: { instanceId: "does-not-exist" },
			}),
		);
		expect(expectFailure(response).error.code).toBe("not_found");
	});

	test("submitting a second job during an in-flight drain still runs it promptly", async () => {
		const createOne = await daemon.handleRequest(
			req({
				id: "inst-1",
				method: "instance.create",
				params: { name: "One", directory: "/tmp/project-one" },
			}),
		);
		const createTwo = await daemon.handleRequest(
			req({
				id: "inst-2",
				method: "instance.create",
				params: { name: "Two", directory: "/tmp/project-two" },
			}),
		);
		const one = expectSuccess(createOne, "instance.create");
		const two = expectSuccess(createTwo, "instance.create");

		// Submit two jobs back-to-back. The second submit happens while the
		// first scheduleDrain()'s microtask/promise is still in flight and
		// must be coalesced via drainPending so the second job runs without
		// waiting for the first to complete.
		await daemon.handleRequest(
			req({
				id: "submit-1",
				method: "job.submit",
				params: {
					instanceId: one.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "first" },
				},
			}),
		);
		await daemon.handleRequest(
			req({
				id: "submit-2",
				method: "job.submit",
				params: {
					instanceId: two.instance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "second" },
				},
			}),
		);

		// Fake prompt delay is 40ms; if drain coalescing regressed, the
		// second job would run strictly after the first and both jobs would
		// not be concurrently active.
		await Bun.sleep(30);
		expect(registry.globalMaxConcurrent).toBeGreaterThanOrEqual(2);
	});

	test("requeues running jobs after restart", async () => {
		// Shut down the beforeEach daemon so we can simulate a crashed state
		// by writing directly to the SQLite file.
		await daemon.shutdown();

		const seedStore = new StateStore(join(tmpDir, "state.sqlite"));
		await seedStore.open();
		const instance = seedStore.createInstance({
			name: "One",
			directory: "/tmp/project-one",
			maxConcurrency: 1,
		});
		seedStore.setInstanceStatus(instance.id, "running");
		const job = seedStore.createJob({
			instanceId: instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "recover" },
		});
		seedStore.markJobRunning(job.id);
		seedStore.close();

		const nextStore = new StateStore(join(tmpDir, "state.sqlite"));
		const nextDaemon = new Daemon(nextStore, {
			registry: new FakeOpencodeRegistry(10),
		});
		await nextDaemon.bootstrap();
		const response = await nextDaemon.handleRequest(
			req({
				id: "job-get",
				method: "job.get",
				params: { jobId: job.id },
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
		store = new StateStore(join(tmpDir, "state.sqlite"));
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

		// After removal, session.list for that instance must fail with
		// not_found — the cascade deletes sessions with the instance row.
		const after = await daemon.handleRequest(
			req({
				id: "session-list-after",
				method: "session.list",
				params: { instanceId },
			}),
		);
		expect(expectFailure(after).error.code).toBe("not_found");
	});
});

describe("Daemon streaming", () => {
	let tmpDir: string;
	let store: StateStore;
	let registry: FakeOpencodeRegistry;
	let daemon: Daemon;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-daemon-stream-"));
		store = new StateStore(join(tmpDir, "state.sqlite"));
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

	test("routes OpenCode question events to the matching job stream", async () => {
		const { instanceId, jobId } = await createInstanceAndSubmit("needs input");
		const events: Array<{ type: string; question?: string }> = [];
		const unsub = daemon.subscribeJob(jobId, (event) => {
			events.push(
				event.type === "question"
					? { type: event.type, question: event.questions[0]?.question }
					: { type: event.type },
			);
		});

		for (let i = 0; i < 20 && registry.promptCalls.length === 0; i += 1) {
			await Bun.sleep(10);
		}
		const sessionId = registry.promptCalls[0]?.sessionId;
		if (!sessionId) {
			throw new Error("expected prompt call");
		}

		registry.emitEvent(instanceId, {
			type: "question.asked",
			properties: {
				id: "question-1",
				sessionID: sessionId,
				questions: [
					{
						header: "Choice",
						question: "Which path should I take?",
						options: [
							{ label: "A", description: "Use option A" },
							{ label: "B", description: "Use option B" },
						],
					},
				],
			},
		});

		for (
			let i = 0;
			i < 20 && !events.some((event) => event.type === "question");
			i += 1
		) {
			await Bun.sleep(10);
		}
		unsub();

		expect(events).toContainEqual({
			type: "question",
			question: "Which path should I take?",
		});
	});

	test("replies to OpenCode question requests through the runtime", async () => {
		const { instanceId } = await createInstanceAndSubmit("needs answer");
		for (let i = 0; i < 20 && registry.promptCalls.length === 0; i += 1) {
			await Bun.sleep(10);
		}

		const response = await daemon.handleRequest(
			req({
				id: "question-reply",
				method: "question.reply",
				params: {
					instanceId,
					requestId: "question-1",
					answers: [["A"]],
				},
			}),
		);

		expect(expectSuccess(response, "question.reply")).toEqual({ ok: true });
		expect(registry.questionReplyCalls).toContainEqual({
			instanceId,
			requestId: "question-1",
			directory: "/tmp/project-one",
			answers: [["A"]],
		});
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

	test("two instances stream independently without cross-leak", async () => {
		registry.streamingDeltas = ["x", "y", "z"];
		registry.deltaIntervalMs = 20;

		const alpha = await daemon.handleRequest(
			req({
				id: "instance-alpha",
				method: "instance.create",
				params: { name: "Alpha", directory: "/tmp/alpha" },
			}),
		);
		const beta = await daemon.handleRequest(
			req({
				id: "instance-beta",
				method: "instance.create",
				params: { name: "Beta", directory: "/tmp/beta" },
			}),
		);
		const alphaInstance = expectSuccess(alpha, "instance.create").instance;
		const betaInstance = expectSuccess(beta, "instance.create").instance;

		const submitAlpha = await daemon.handleRequest(
			req({
				id: "submit-alpha",
				method: "job.submit",
				params: {
					instanceId: alphaInstance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "alpha-prompt" },
				},
			}),
		);
		const submitBeta = await daemon.handleRequest(
			req({
				id: "submit-beta",
				method: "job.submit",
				params: {
					instanceId: betaInstance.id,
					session: { type: "new" },
					task: { type: "prompt", prompt: "beta-prompt" },
				},
			}),
		);
		const alphaJobId = expectSuccess(submitAlpha, "job.submit").job.id;
		const betaJobId = expectSuccess(submitBeta, "job.submit").job.id;

		const alphaEvents: Array<{ type: string }> = [];
		const betaEvents: Array<{ type: string }> = [];
		const unsubA = daemon.subscribeJob(alphaJobId, (e) => alphaEvents.push(e));
		const unsubB = daemon.subscribeJob(betaJobId, (e) => betaEvents.push(e));

		await Bun.sleep(200);
		unsubA();
		unsubB();

		const alphaJob = expectSuccess(
			await daemon.handleRequest(
				req({ id: "g-a", method: "job.get", params: { jobId: alphaJobId } }),
			),
			"job.get",
		).job;
		const betaJob = expectSuccess(
			await daemon.handleRequest(
				req({ id: "g-b", method: "job.get", params: { jobId: betaJobId } }),
			),
			"job.get",
		).job;

		expect(alphaJob.outputText).toBe("xyz");
		expect(betaJob.outputText).toBe("xyz");
		expect(alphaEvents.some((e) => e.type === "delta")).toBe(true);
		expect(betaEvents.some((e) => e.type === "delta")).toBe(true);
		expect(alphaEvents[alphaEvents.length - 1]?.type).toBe("done");
		expect(betaEvents[betaEvents.length - 1]?.type).toBe("done");

		expect(registry.directoriesStarted).toContain("/tmp/alpha");
		expect(registry.directoriesStarted).toContain("/tmp/beta");
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
