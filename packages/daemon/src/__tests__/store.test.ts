import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DaemonJob, DaemonState, ManagedInstance } from "../protocol";
import { StateStore, StoreError } from "../store";

function makeInstance(
	overrides: Partial<ManagedInstance> = {},
): ManagedInstance {
	return {
		id: overrides.id ?? "instance-1",
		name: overrides.name ?? "Instance One",
		directory: overrides.directory ?? "/tmp/project-one",
		status: overrides.status ?? "stopped",
		maxConcurrency: overrides.maxConcurrency ?? 1,
		createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
		updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function makeJob(overrides: Partial<DaemonJob> = {}): DaemonJob {
	return {
		id: overrides.id ?? "job-1",
		instanceId: overrides.instanceId ?? "instance-1",
		session: overrides.session ?? { type: "new" },
		task: overrides.task ?? { type: "prompt", prompt: "test prompt" },
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

	test("returns empty state when file does not exist", async () => {
		const state = await store.load();
		expect(state).toEqual({ version: 2, instances: [], jobs: [] });
	});

	test("writes state to disk as formatted JSON", async () => {
		const state: DaemonState = {
			version: 2,
			instances: [makeInstance()],
			jobs: [makeJob()],
		};
		await store.save(state);

		const raw = await readFile(statePath, "utf8");
		expect(raw).toEndWith("\n");
		const parsed = JSON.parse(raw);
		expect(parsed.instances).toHaveLength(1);
		expect(parsed.jobs).toHaveLength(1);
	});

	test("adds and updates instances", () => {
		let state: DaemonState = { version: 2, instances: [], jobs: [] };
		state = store.createInstance(state, makeInstance());
		expect(state.instances).toHaveLength(1);
		state = store.upsertInstance(
			state,
			makeInstance({
				status: "running",
				updatedAt: "2026-01-02T00:00:00.000Z",
			}),
		);
		expect(state.instances[0]?.status).toBe("running");
	});

	test("rejects duplicate instance directories", () => {
		const state: DaemonState = {
			version: 2,
			instances: [makeInstance()],
			jobs: [],
		};
		expect(() =>
			store.createInstance(
				state,
				makeInstance({ id: "instance-2", directory: "/tmp/project-one" }),
			),
		).toThrow(StoreError);
	});

	test("filters jobs by instance and state", () => {
		const state: DaemonState = {
			version: 2,
			instances: [
				makeInstance(),
				makeInstance({ id: "instance-2", directory: "/tmp/project-two" }),
			],
			jobs: [
				makeJob(),
				makeJob({ id: "job-2", instanceId: "instance-2" }),
				makeJob({ id: "job-3", state: "running" }),
			],
		};
		expect(store.listJobs(state, { instanceId: "instance-1" })).toHaveLength(2);
		expect(store.listJobs(state, { state: "running" })).toHaveLength(1);
	});
});
