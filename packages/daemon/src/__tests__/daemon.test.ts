import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	JobStreamEventMessage,
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
	response: ResponseMessage | JobStreamEventMessage | undefined,
	method: M,
): ResultByMethod<M> {
	if (
		!response ||
		!response.ok ||
		response.method !== method ||
		!("result" in response)
	) {
		throw new Error(`expected success for ${method}`);
	}
	return response.result as ResultByMethod<M>;
}

function expectFailure(
	response: ResponseMessage | JobStreamEventMessage | undefined,
): ResponseMessage & { ok: false } {
	if (!response || response.ok) {
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
		const stream = daemon.handleRequest(
			req({
				id: "instance-create",
				method: "instance.create",
				params: {
					name: "One",
					directory: "/tmp/project-one",
				},
			}),
		);
		const { value } = await stream.next();
		const result = expectSuccess(value, "instance.create");
		expect(result.instance.id).toBeTruthy();
	});

	test("submits a job against a specific instance", async () => {
		const created = await daemon
			.handleRequest(
				req({
					id: "instance-create",
					method: "instance.create",
					params: {
						name: "One",
						directory: "/tmp/project-one",
					},
				}),
			)
			.next();
		const instance = expectSuccess(created.value, "instance.create");

		const submit = await daemon
			.handleRequest(
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
			)
			.next();
		const result = expectSuccess(submit.value, "job.submit");
		expect(result.job.instanceId).toBe(instance.instance.id);
	});

	test("rejects submit with nonexistent instance", async () => {
		const submit = await daemon
			.handleRequest(
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
			)
			.next();
		expect(expectFailure(submit.value).error.code).toBe("not_found");
	});

	test("runs jobs on different instances in parallel", async () => {
		const createOne = await daemon
			.handleRequest(
				req({
					id: "instance-create-1",
					method: "instance.create",
					params: {
						name: "One",
						directory: "/tmp/project-one",
					},
				}),
			)
			.next();
		const createTwo = await daemon
			.handleRequest(
				req({
					id: "instance-create-2",
					method: "instance.create",
					params: {
						name: "Two",
						directory: "/tmp/project-two",
					},
				}),
			)
			.next();
		const one = expectSuccess(createOne.value, "instance.create");
		const two = expectSuccess(createTwo.value, "instance.create");

		await daemon
			.handleRequest(
				req({
					id: "job-submit-1",
					method: "job.submit",
					params: {
						instanceId: one.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt: "one" },
					},
				}),
			)
			.next();
		await daemon
			.handleRequest(
				req({
					id: "job-submit-2",
					method: "job.submit",
					params: {
						instanceId: two.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt: "two" },
					},
				}),
			)
			.next();

		await Bun.sleep(80);
		expect(registry.globalMaxConcurrent).toBeGreaterThanOrEqual(2);
	});

	test("respects per-instance concurrency", async () => {
		const created = await daemon
			.handleRequest(
				req({
					id: "instance-create",
					method: "instance.create",
					params: {
						name: "One",
						directory: "/tmp/project-one",
						maxConcurrency: 1,
					},
				}),
			)
			.next();
		const createdResult = expectSuccess(created.value, "instance.create");

		await daemon
			.handleRequest(
				req({
					id: "job-submit-1",
					method: "job.submit",
					params: {
						instanceId: createdResult.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt: "first" },
					},
				}),
			)
			.next();
		await daemon
			.handleRequest(
				req({
					id: "job-submit-2",
					method: "job.submit",
					params: {
						instanceId: createdResult.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt: "second" },
					},
				}),
			)
			.next();

		await Bun.sleep(90);
		expect(
			registry.maxConcurrentByInstance.get(createdResult.instance.id),
		).toBe(1);
	});

	test("cancels a queued job", async () => {
		const one = await daemon
			.handleRequest(
				req({
					id: "instance-create-1",
					method: "instance.create",
					params: {
						name: "One",
						directory: "/tmp/project-one",
						maxConcurrency: 1,
					},
				}),
			)
			.next();
		const oneResult = expectSuccess(one.value, "instance.create");

		await daemon
			.handleRequest(
				req({
					id: "job-submit-1",
					method: "job.submit",
					params: {
						instanceId: oneResult.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt: "first" },
					},
				}),
			)
			.next();
		const queued = await daemon
			.handleRequest(
				req({
					id: "job-submit-2",
					method: "job.submit",
					params: {
						instanceId: oneResult.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt: "second" },
					},
				}),
			)
			.next();
		const queuedResult = expectSuccess(queued.value, "job.submit");

		const cancel = await daemon
			.handleRequest(
				req({
					id: "job-cancel",
					method: "job.cancel",
					params: {
						jobId: queuedResult.job.id,
					},
				}),
			)
			.next();
		expect(expectSuccess(cancel.value, "job.cancel").job.state).toBe(
			"cancelled",
		);
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
		const response = await nextDaemon
			.handleRequest(
				req({
					id: "job-get",
					method: "job.get",
					params: { jobId: "job-1" },
				}),
			)
			.next();
		expect(["queued", "running", "succeeded"]).toContain(
			expectSuccess(response.value, "job.get").job.state,
		);
		await nextDaemon.shutdown();
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
		const created = await daemon
			.handleRequest(
				req({
					id: "instance-create",
					method: "instance.create",
					params: { name: "One", directory: "/tmp/project-one" },
				}),
			)
			.next();
		const instance = expectSuccess(created.value, "instance.create");
		const submitted = await daemon
			.handleRequest(
				req({
					id: "job-submit",
					method: "job.submit",
					params: {
						instanceId: instance.instance.id,
						session: { type: "new" },
						task: { type: "prompt", prompt },
					},
				}),
			)
			.next();
		const submitResult = expectSuccess(submitted.value, "job.submit");
		return {
			instanceId: instance.instance.id,
			jobId: submitResult.job.id,
		};
	}

	test("subscribeJob delivers an immediate done for a terminal job", async () => {
		const { jobId } = await createInstanceAndSubmit("hello");
		// Wait for the job to finish.
		await Bun.sleep(120);

		const events: Array<{ type: string }> = [];
		const unsub = daemon.subscribeJob(jobId, (event) => {
			events.push(event);
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("done");
		// Unsubscribe should be a no-op (no throw).
		unsub();
	});

	test("subscribeJob delivers a snapshot for a running job", async () => {
		// Configure deltas so the prompt() takes long enough to subscribe
		// while it's still running.
		registry.streamingDeltas = [" hello", " world", "!"];
		registry.deltaIntervalMs = 30;

		const { jobId } = await createInstanceAndSubmit("hi");

		// Give one delta time to arrive before subscribing.
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

		// First event must always be a snapshot.
		expect(events[0]?.type).toBe("snapshot");
		const snapshot = events[0] as { type: "snapshot"; text: string };
		expect(snapshot.text.length).toBeGreaterThan(0);

		// Wait for the rest of the deltas + done.
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

		const get = await daemon
			.handleRequest(req({ id: "g", method: "job.get", params: { jobId } }))
			.next();
		const job = expectSuccess(get.value, "job.get").job;
		expect(job.state).toBe("succeeded");
		expect(job.outputText).toBe("foo bar baz");
	});

	test("executeJob preserves accumulated text rather than overwriting with parts", async () => {
		// Streaming deltas produce "abc"; the fake's final parts will also
		// be "abc" (joined deltas), so we can't distinguish overwrite vs
		// preserve from outputText alone. Instead assert that the
		// accumulation happened during streaming by checking outputText
		// before completion.
		registry.streamingDeltas = ["a", "b", "c"];
		registry.deltaIntervalMs = 25;

		const { jobId } = await createInstanceAndSubmit("test");

		// Snapshot the job mid-stream — outputText should be partial.
		await Bun.sleep(40);
		let mid = await daemon
			.handleRequest(req({ id: "g1", method: "job.get", params: { jobId } }))
			.next();
		let midJob = expectSuccess(mid.value, "job.get").job;
		expect(midJob.state).toBe("running");
		expect(midJob.outputText?.length ?? 0).toBeGreaterThan(0);
		expect(midJob.outputText?.length ?? 0).toBeLessThan(3);

		// After completion, outputText should be the full accumulated value.
		await Bun.sleep(100);
		mid = await daemon
			.handleRequest(req({ id: "g2", method: "job.get", params: { jobId } }))
			.next();
		midJob = expectSuccess(mid.value, "job.get").job;
		expect(midJob.state).toBe("succeeded");
		expect(midJob.outputText).toBe("abc");
	});

	test("executeJob falls back to extractText when no deltas were emitted", async () => {
		// No streamingDeltas configured — fake returns reply:<prompt>.
		const { jobId } = await createInstanceAndSubmit("plain");
		await Bun.sleep(80);

		const get = await daemon
			.handleRequest(req({ id: "g", method: "job.get", params: { jobId } }))
			.next();
		const job = expectSuccess(get.value, "job.get").job;
		expect(job.state).toBe("succeeded");
		expect(job.outputText).toBe("reply:plain");
	});

	test("job.stream generator yields ack, snapshot, deltas, then done", async () => {
		registry.streamingDeltas = ["one ", "two ", "three"];
		registry.deltaIntervalMs = 10;

		const { jobId } = await createInstanceAndSubmit("test");

		const messages: Array<ResponseMessage | JobStreamEventMessage> = [];
		for await (const msg of daemon.handleRequest(
			req({
				id: "stream-1",
				method: "job.stream",
				params: { jobId },
			}),
		)) {
			messages.push(msg);
		}

		// First message: the ack (carries result, no event).
		expect(messages[0]?.ok).toBe(true);
		expect("result" in (messages[0] ?? {})).toBe(true);

		// Subsequent messages all carry an event field.
		const eventMessages = messages
			.slice(1)
			.filter((m): m is JobStreamEventMessage => "event" in m);
		const eventTypes = eventMessages.map((m) => m.event.type);

		expect(eventTypes[0]).toBe("snapshot");
		expect(eventTypes[eventTypes.length - 1]).toBe("done");
		expect(eventTypes).toContain("delta");

		// The done event must carry the final job with full outputText.
		const doneMsg = eventMessages[eventMessages.length - 1];
		if (doneMsg?.event.type !== "done") {
			throw new Error("expected last event to be done");
		}
		expect(doneMsg.event.job.outputText).toBe("one two three");
	});

	test("late subscriber gets snapshot of accumulated text and continues without duplicates", async () => {
		registry.streamingDeltas = ["alpha ", "beta ", "gamma ", "delta"];
		registry.deltaIntervalMs = 25;

		const { jobId } = await createInstanceAndSubmit("late");

		// Wait long enough for ~2 deltas to have been processed.
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

		// First event is the snapshot, which should already contain some text.
		const first = events[0];
		if (first?.type !== "snapshot") {
			throw new Error("expected first event to be snapshot");
		}
		expect(first.text.length).toBeGreaterThan(0);

		// Reconstruct what the late subscriber observed:
		// snapshot.text + every subsequent delta.delta should equal the
		// final accumulated outputText. If a delta were dropped or
		// duplicated, this would fail.
		const observedFromSnapshot = events
			.slice(1)
			.filter((e): e is { type: "delta"; delta: string } => e.type === "delta")
			.reduce((acc, e) => acc + e.delta, first.text);

		const get = await daemon
			.handleRequest(req({ id: "g", method: "job.get", params: { jobId } }))
			.next();
		const finalText = expectSuccess(get.value, "job.get").job.outputText ?? "";
		expect(observedFromSnapshot).toBe(finalText);
	});
});
