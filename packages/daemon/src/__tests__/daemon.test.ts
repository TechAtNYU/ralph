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
	if (!response.ok || response.method !== method) {
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
