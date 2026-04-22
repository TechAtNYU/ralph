import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DaemonClient } from "../client";
import type { DaemonJob, JobStreamEvent } from "../protocol";
import { createConnectionHandler, Daemon } from "../server";
import { StateStore } from "../store";
import { FakeOpencodeRegistry } from "./helpers";

/** False in restricted environments (e.g. some sandboxes) where binding a Unix socket returns EPERM. */
async function canBindUnixSocket(): Promise<boolean> {
	let probeDir: string | undefined;
	try {
		probeDir = await mkdtemp(join(tmpdir(), "ralph-unix-probe-"));
		const path = join(probeDir, "p.sock");
		const srv = createServer();
		await new Promise<void>((resolve, reject) => {
			const onError = (err: NodeJS.ErrnoException) => reject(err);
			srv.once("error", onError);
			try {
				srv.listen(path, () => {
					srv.removeListener("error", onError);
					srv.close((closeErr) => {
						if (closeErr) reject(closeErr);
						else resolve();
					});
				});
			} catch (err) {
				reject(err);
			}
		});
		return true;
	} catch {
		return false;
	} finally {
		if (probeDir) {
			await rm(probeDir, { recursive: true, force: true }).catch(() => {});
		}
	}
}

const unixSocketAvailable = await canBindUnixSocket();

const integrationDescribe = unixSocketAvailable ? describe : describe.skip;

integrationDescribe("Integration: server + client over Unix socket", () => {
	let tmpDir: string;
	let testSocketPath: string;
	let server: Server;
	let daemon: Daemon;
	let registry: FakeOpencodeRegistry;
	let client: DaemonClient;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ralph-integration-"));
		testSocketPath = join(tmpDir, "test.sock");
		try {
			await unlink(testSocketPath);
		} catch {
			// ignore
		}
		const store = new StateStore(join(tmpDir, "state.sqlite"));
		registry = new FakeOpencodeRegistry(20);
		daemon = new Daemon(store, { registry });
		await daemon.bootstrap();

		server = createServer(createConnectionHandler(daemon));
		client = new DaemonClient(testSocketPath);

		await new Promise<void>((resolve, reject) => {
			const onError = (err: NodeJS.ErrnoException) => {
				reject(err);
			};
			server.once("error", onError);
			try {
				server.listen(testSocketPath, async () => {
					try {
						await chmod(testSocketPath, 0o600);
						server.removeListener("error", onError);
						resolve();
					} catch (err) {
						server.removeListener("error", onError);
						reject(err);
					}
				});
			} catch (err) {
				server.removeListener("error", onError);
				reject(err);
			}
		});
	});

	afterEach(async () => {
		server?.close();
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

	test("client.streamJob streams snapshot, deltas, and done end-to-end", async () => {
		registry.streamingDeltas = ["red ", "green ", "blue"];
		registry.deltaIntervalMs = 10;

		const created = await client.createInstance({
			name: "stream-instance",
			directory: "/tmp/project-stream",
		});
		const submitted = await client.submitJob({
			instanceId: created.instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "stream me" },
		});

		const events: JobStreamEvent[] = [];
		for await (const event of client.streamJob(submitted.job.id)) {
			events.push(event);
		}

		const types = events.map((e) => e.type);
		expect(types[0]).toBe("snapshot");
		expect(types[types.length - 1]).toBe("done");
		expect(types).toContain("delta");

		const done = events[events.length - 1];
		if (done?.type !== "done") throw new Error("expected done event");
		expect(done.job.state).toBe("succeeded");
		expect(done.job.outputText).toBe("red green blue");
	});

	test("client.streamJob returns immediately for an already-terminal job", async () => {
		const created = await client.createInstance({
			name: "fast-instance",
			directory: "/tmp/project-fast",
		});
		const submitted = await client.submitJob({
			instanceId: created.instance.id,
			session: { type: "new" },
			task: { type: "prompt", prompt: "fast" },
		});

		await Bun.sleep(100);

		const events: JobStreamEvent[] = [];
		for await (const event of client.streamJob(submitted.job.id)) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("done");
	});
});
