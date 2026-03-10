import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DaemonClient } from "../client";
import type { DaemonJob } from "../protocol";
import { createConnectionHandler, Daemon } from "../server";
import { StateStore } from "../store";
import { FakeOpencodeRegistry } from "./helpers";

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
		daemon = new Daemon(store, { registry: new FakeOpencodeRegistry(20) });
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
		await daemon.shutdown();
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("isDaemonRunning returns true when server is up", async () => {
		expect(await client.isDaemonRunning()).toBe(true);
	});

	test("can create and list instances", async () => {
		const created = await client.createInstance({
			name: "One",
			directory: "/tmp/project-one",
		});
		expect(created.instance.name).toBe("One");

		const listed = await client.listInstances();
		expect(listed.instances).toHaveLength(1);
		expect(listed.defaultInstanceId).toBe(created.instance.id);
	});

	test("can submit and fetch jobs for a selected instance", async () => {
		const created = await client.createInstance({
			name: "One",
			directory: "/tmp/project-one",
		});
		const submitted = await client.submitJob({
			instanceId: created.instance.id,
			session: { type: "new" },
			task: {
				type: "prompt",
				prompt: "integration",
			},
		});
		expect(submitted.job.instanceId).toBe(created.instance.id);

		const listed = await client.listJobs({ instanceId: created.instance.id });
		expect(
			listed.jobs.some((job: DaemonJob) => job.id === submitted.job.id),
		).toBe(true);

		const fetched = await client.getJob(submitted.job.id);
		expect(fetched.job.id).toBe(submitted.job.id);
	});

	test("client surfaces typed server errors", async () => {
		await expect(client.getJob("missing")).rejects.toThrow(
			"job missing not found",
		);
	});
});
