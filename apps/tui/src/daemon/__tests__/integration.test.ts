import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DaemonClient } from "../client";
import { createConnectionHandler, Daemon } from "../server";
import { StateStore } from "../store";

describe("Integration: server + client over Unix socket", () => {
	let tmpDir: string;
	let testSocketPath: string;
	let server: Server;
	let daemon: Daemon;
	let client: DaemonClient;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-integration-"));
		testSocketPath = join(tmpDir, "test.sock");
		const store = new StateStore(join(tmpDir, "state.json"));
		daemon = new Daemon(store);
		await daemon.bootstrap();

		server = createServer(createConnectionHandler(daemon));
		client = new DaemonClient(testSocketPath);

		await new Promise<void>((resolve) => {
			server.listen(testSocketPath, async () => {
				await chmod(testSocketPath, 0o600);
				resolve();
			});
		});
	});

	afterEach(async () => {
		server.close();
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("isDaemonRunning returns true when server is up", async () => {
		const running = await client.isDaemonRunning();
		expect(running).toBe(true);
	});

	test("health returns valid response", async () => {
		const result = await client.health();
		expect(result.pid).toBe(process.pid);
		expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
	});

	test("submit and then list shows the job", async () => {
		const submitResult = await client.submit("integration test prompt");
		expect(submitResult.job.prompt).toBe("integration test prompt");
		expect(submitResult.job.id).toBeTruthy();

		const listResult = await client.listJobs();
		expect(listResult.jobs.length).toBeGreaterThanOrEqual(1);
		const found = listResult.jobs.find((j) => j.id === submitResult.job.id);
		expect(found).toBeDefined();
	});

	test("submit and then get returns the same job", async () => {
		const submitResult = await client.submit("get test");
		const getResult = await client.getJob(submitResult.job.id);
		expect(getResult.job.id).toBe(submitResult.job.id);
		expect(getResult.job.prompt).toBe("get test");
	});

	test("submit two jobs and cancel the queued one", async () => {
		// First job will start running (CONCURRENCY=1)
		await client.submit("first job");
		// Second job should be queued
		const second = await client.submit("second job");

		await Bun.sleep(10);

		const cancelResult = await client.cancelJob(second.job.id);
		expect(cancelResult.job.state).toBe("cancelled");
	});

	test("getJob returns error for nonexistent job", async () => {
		expect(client.getJob("does-not-exist")).rejects.toThrow("not found");
	});

	test("cancelJob returns error for nonexistent job", async () => {
		expect(client.cancelJob("does-not-exist")).rejects.toThrow("not found");
	});

	test("multiple sequential requests work correctly", async () => {
		const health1 = await client.health();
		const submit1 = await client.submit("seq test 1");
		const submit2 = await client.submit("seq test 2");
		const list = await client.listJobs();
		const health2 = await client.health();

		expect(health1.pid).toBe(health2.pid);
		expect(list.jobs.length).toBeGreaterThanOrEqual(2);
		expect(list.jobs.find((j) => j.id === submit1.job.id)).toBeDefined();
		expect(list.jobs.find((j) => j.id === submit2.job.id)).toBeDefined();
	});
});

describe("Client: isDaemonRunning when no server", () => {
	test("returns false when socket does not exist", async () => {
		const client = new DaemonClient("/tmp/ralph-nonexistent-test.sock");
		const running = await client.isDaemonRunning();
		expect(running).toBe(false);
	});
});
