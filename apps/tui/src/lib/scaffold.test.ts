import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bootstrapSessionScaffold,
	resolveSessionScaffoldPath,
} from "./scaffold";

describe("scaffold", () => {
	const tempDirs: string[] = [];
	const originalRalphHome = process.env.RALPH_HOME;

	afterEach(async () => {
		if (originalRalphHome === undefined) {
			delete process.env.RALPH_HOME;
		} else {
			process.env.RALPH_HOME = originalRalphHome;
		}

		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("resolves the session path from an explicit Ralph home", () => {
		expect(
			resolveSessionScaffoldPath({
				instanceId: "instance-1",
				sessionId: "session-1",
				ralphHome: "/tmp/ralph-home",
			}),
		).toBe("/tmp/ralph-home/sessions/instance-1/session-1");
	});

	it("falls back to the RALPH_HOME environment variable", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "ralph-scaffold-home-"));
		tempDirs.push(tempHome);
		process.env.RALPH_HOME = tempHome;

		expect(
			resolveSessionScaffoldPath({
				instanceId: "instance-2",
				sessionId: "session-2",
			}),
		).toBe(join(tempHome, "sessions", "instance-2", "session-2"));
	});

	it("rejects invalid path segments before building a session path", () => {
		expect(() =>
			resolveSessionScaffoldPath({
				instanceId: "",
				sessionId: "session-1",
				ralphHome: "/tmp/ralph-home",
			}),
		).toThrow("instanceId is required");

		expect(() =>
			resolveSessionScaffoldPath({
				instanceId: "instance/1",
				sessionId: "session-1",
				ralphHome: "/tmp/ralph-home",
			}),
		).toThrow("instanceId must not contain path separators");

		expect(() =>
			resolveSessionScaffoldPath({
				instanceId: "instance-1",
				sessionId: "..",
				ralphHome: "/tmp/ralph-home",
			}),
		).toThrow("sessionId must not be a dot path segment");
	});

	it("bootstraps the workspace template into the session directory", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "ralph-scaffold-template-"));
		tempDirs.push(tempHome);

		const sessionPath = await bootstrapSessionScaffold({
			instanceId: "instance-3",
			sessionId: "session-3",
			ralphHome: tempHome,
		});

		expect(sessionPath).toBe(
			join(tempHome, "sessions", "instance-3", "session-3"),
		);

		const [spec, prompt, prd, progress] = await Promise.all([
			readFile(join(sessionPath, "SPEC.md"), "utf8"),
			readFile(join(sessionPath, "PROMPT.md"), "utf8"),
			readFile(join(sessionPath, "prd.json"), "utf8"),
			readFile(join(sessionPath, "progress.md"), "utf8"),
		]);

		expect(spec).toContain("# Instance instance-3 Session session-3");
		expect(prompt).toContain("RALPH_TASK_COMPLETE");
		expect(JSON.parse(prd)).toEqual({ tasks: [] });
		expect(progress.trim()).toBe("# Progress Log");
	});
});
