import { describe, expect, test } from "bun:test";
import { basename, resolve } from "node:path";
import type { ManagedInstance } from "@techatnyu/ralphd";
import { ensureDirectoryInstance } from "./instance";

function instance(overrides: Partial<ManagedInstance>): ManagedInstance {
	const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
	return {
		id: "instance-1",
		name: "project",
		directory: "/tmp/project",
		status: "stopped",
		maxConcurrency: 1,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("ensureDirectoryInstance", () => {
	test("returns an existing instance for the launch directory", async () => {
		const cwd = resolve("/tmp/project");
		const existing = instance({ directory: cwd });
		let creates = 0;

		const result = await ensureDirectoryInstance(cwd, {
			listInstances: async () => ({ instances: [existing] }),
			createInstance: async () => {
				creates += 1;
				return { instance: existing };
			},
		});

		expect(result).toBe(existing);
		expect(creates).toBe(0);
	});

	test("creates an instance named after the launch directory", async () => {
		const cwd = resolve("/tmp/project-two");
		let createInput:
			| { name: string; directory: string; maxConcurrency?: number }
			| undefined;
		const created = instance({
			id: "instance-2",
			name: basename(cwd),
			directory: cwd,
		});

		const result = await ensureDirectoryInstance(cwd, {
			listInstances: async () => ({ instances: [] }),
			createInstance: async (input) => {
				createInput = input;
				return { instance: created };
			},
		});

		expect(result).toBe(created);
		expect(createInput).toEqual({ name: "project-two", directory: cwd });
	});
});
