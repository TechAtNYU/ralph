import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonJob, ManagedInstance } from "@techatnyu/ralphd";
import {
	type SessionSummary,
	filterJobsForSession,
	flattenRows,
	listSessions,
	prdJsonProgressAdapter,
} from "./sessions";

async function makeSessionDir(
	ralphHome: string,
	instanceId: string,
	sessionId: string,
	files: Record<string, string> = {},
): Promise<string> {
	const dir = join(ralphHome, "sessions", instanceId, sessionId);
	await mkdir(dir, { recursive: true });
	await Promise.all(
		Object.entries(files).map(([name, content]) =>
			writeFile(join(dir, name), content, "utf8"),
		),
	);
	return dir;
}

function fakeInstance(id: string, name = id): ManagedInstance {
	return {
		id,
		name,
		directory: `/tmp/${id}`,
		status: "stopped",
		maxConcurrency: 1,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("listSessions", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("returns [] when the sessions directory does not exist", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "ralph-sessions-"));
		tempDirs.push(tempHome);

		const result = await listSessions("missing-instance", {
			ralphHome: tempHome,
		});
		expect(result).toEqual([]);
	});

	it("returns [] for an instance with no session subdirectories", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "ralph-sessions-"));
		tempDirs.push(tempHome);
		await mkdir(join(tempHome, "sessions", "inst-1"), { recursive: true });

		const result = await listSessions("inst-1", { ralphHome: tempHome });
		expect(result).toEqual([]);
	});

	it("returns sorted summaries and parses SPEC.md title", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "ralph-sessions-"));
		tempDirs.push(tempHome);

		await makeSessionDir(tempHome, "inst-1", "session-b", {
			"SPEC.md": "# Build the thing\n\nmore content",
			"prd.json": JSON.stringify({
				tasks: [{ done: true }, { done: false }],
			}),
		});
		await makeSessionDir(tempHome, "inst-1", "session-a", {
			// no SPEC.md — title should fall back to sessionId
		});

		const result = await listSessions("inst-1", { ralphHome: tempHome });

		expect(result).toHaveLength(2);
		const [first, second] = result;
		if (!first || !second) throw new Error("expected two sessions");
		expect(first.sessionId).toBe("session-a");
		expect(first.title).toBe("session-a");
		expect(first.progress).toEqual({ total: 0, completed: 0 });

		expect(second.sessionId).toBe("session-b");
		expect(second.title).toBe("Build the thing");
		expect(second.progress).toEqual({ total: 2, completed: 1 });
	});

	it("falls back to sessionId when SPEC.md has no heading", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "ralph-sessions-"));
		tempDirs.push(tempHome);

		await makeSessionDir(tempHome, "inst-1", "only", {
			"SPEC.md": "just body text, no heading",
		});

		const result = await listSessions("inst-1", { ralphHome: tempHome });
		expect(result[0]?.title).toBe("only");
	});
});

describe("prdJsonProgressAdapter", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("counts tasks with done=true and status='done'", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ralph-prd-"));
		tempDirs.push(dir);
		await writeFile(
			join(dir, "prd.json"),
			JSON.stringify({
				tasks: [
					{ done: true },
					{ status: "done" },
					{ done: false },
					{ status: "pending" },
					{},
				],
			}),
			"utf8",
		);

		const progress = await prdJsonProgressAdapter.read(dir);
		expect(progress).toEqual({ total: 5, completed: 2 });
	});

	it("returns {0,0} for missing prd.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ralph-prd-"));
		tempDirs.push(dir);

		const progress = await prdJsonProgressAdapter.read(dir);
		expect(progress).toEqual({ total: 0, completed: 0 });
	});

	it("returns {0,0} for malformed prd.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ralph-prd-"));
		tempDirs.push(dir);
		await writeFile(join(dir, "prd.json"), "{not json", "utf8");

		const progress = await prdJsonProgressAdapter.read(dir);
		expect(progress).toEqual({ total: 0, completed: 0 });
	});

	it("handles empty tasks array", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ralph-prd-"));
		tempDirs.push(dir);
		await writeFile(join(dir, "prd.json"), JSON.stringify({ tasks: [] }), "utf8");

		const progress = await prdJsonProgressAdapter.read(dir);
		expect(progress).toEqual({ total: 0, completed: 0 });
	});
});

describe("flattenRows", () => {
	const summary = (
		instanceId: string,
		sessionId: string,
	): SessionSummary => ({
		instanceId,
		sessionId,
		directory: `/tmp/${instanceId}/${sessionId}`,
		title: sessionId,
		progress: { total: 0, completed: 0 },
	});

	it("returns only instances when nothing is expanded", () => {
		const instances = [fakeInstance("a"), fakeInstance("b")];
		const rows = flattenRows(instances, new Set(), {});
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.kind === "instance")).toBe(true);
	});

	it("interleaves sessions under expanded instances", () => {
		const instances = [fakeInstance("a"), fakeInstance("b")];
		const rows = flattenRows(instances, new Set(["a"]), {
			a: [summary("a", "s1"), summary("a", "s2")],
		});

		expect(rows).toHaveLength(4);
		expect(rows[0]).toMatchObject({ kind: "instance" });
		expect(rows[1]).toMatchObject({ kind: "session" });
		expect(rows[2]).toMatchObject({ kind: "session" });
		expect(rows[3]).toMatchObject({ kind: "instance" });
		const secondRow = rows[1];
		if (secondRow?.kind === "session") {
			expect(secondRow.session.sessionId).toBe("s1");
		}
	});

	it("shows only the instance row when expanded but cache is empty", () => {
		const instances = [fakeInstance("a")];
		const rows = flattenRows(instances, new Set(["a"]), {});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("instance");
	});
});

describe("filterJobsForSession", () => {
	it("returns [] pending Ralph-session ↔ OpenCode-session mapping", () => {
		const job = { id: "j", instanceId: "a" } as unknown as DaemonJob;
		const s: SessionSummary = {
			instanceId: "a",
			sessionId: "s",
			directory: "/tmp/a/s",
			title: "s",
			progress: { total: 0, completed: 0 },
		};
		expect(filterJobsForSession([job], s)).toEqual([]);
	});
});
