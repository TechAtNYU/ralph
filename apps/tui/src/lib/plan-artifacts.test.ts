import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePrdArtifact, writeSpecArtifact } from "./plan-artifacts";

describe("plan artifacts", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	async function tempScaffold(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "ralph-plan-artifacts-"));
		tempDirs.push(dir);
		return dir;
	}

	it("writes valid SPEC markdown", async () => {
		const scaffold = await tempScaffold();
		const spec = `# Todo App

> A small task manager for personal use.

## Overview
Build a browser todo app that lets one person add, complete, and delete tasks while keeping state locally.

## Scope
- Add tasks
- Complete tasks
- Delete tasks
`;

		await writeSpecArtifact(scaffold, spec);

		expect(await readFile(join(scaffold, "SPEC.md"), "utf8")).toBe(
			`${spec.trim()}\n`,
		);
	});

	it("rejects too-short SPEC markdown", async () => {
		const scaffold = await tempScaffold();

		await expect(writeSpecArtifact(scaffold, "# Tiny\n")).rejects.toThrow(
			"too short",
		);
	});

	it("rejects fake tool calls for SPEC output", async () => {
		const scaffold = await tempScaffold();

		await expect(
			writeSpecArtifact(scaffold, '<tool_call>write("SPEC.md", "# Todo")'),
		).rejects.toThrow("printed a tool call");
	});

	it("accepts a single fenced markdown SPEC block", async () => {
		const scaffold = await tempScaffold();
		const spec = `# Todo App

> A small task manager for personal use.

## Overview
Build a browser todo app that lets one person add, complete, and delete tasks while keeping state locally.

## Scope
- Add tasks
- Complete tasks
- Delete tasks`;

		await writeSpecArtifact(scaffold, ["```markdown", spec, "```"].join("\n"));

		expect(await readFile(join(scaffold, "SPEC.md"), "utf8")).toBe(`${spec}\n`);
	});

	it("writes valid PRD JSON and normalizes formatting", async () => {
		const scaffold = await tempScaffold();
		const prd = `{"tasks":[{"description":"Build task storage","subtasks":["Create storage helper","Run tests"]}]}`;

		await writePrdArtifact(scaffold, prd);

		const written = await readFile(join(scaffold, "prd.json"), "utf8");
		expect(written).toContain('\n\t"tasks"');
		expect(JSON.parse(written)).toEqual({
			tasks: [
				{
					description: "Build task storage",
					subtasks: ["Create storage helper", "Run tests"],
					notes: "",
					passed: false,
				},
			],
		});
	});

	it("accepts a single fenced json PRD block", async () => {
		const scaffold = await tempScaffold();

		await writePrdArtifact(
			scaffold,
			[
				"```json",
				'{"tasks":[{"description":"Create UI","subtasks":["Add form","Run typecheck"],"notes":"Keep it simple","passed":false}]}',
				"```",
			].join("\n"),
		);

		const written = await readFile(join(scaffold, "prd.json"), "utf8");
		expect(JSON.parse(written).tasks).toHaveLength(1);
	});

	it("rejects prose-wrapped PRD JSON", async () => {
		const scaffold = await tempScaffold();

		await expect(
			writePrdArtifact(
				scaffold,
				`Here is the JSON:
{"tasks":[{"description":"Create UI","subtasks":["Run tests"]}]}`,
			),
		).rejects.toThrow("raw JSON or a single fenced json block");
	});

	it("rejects schema-invalid PRD JSON", async () => {
		const scaffold = await tempScaffold();

		await expect(writePrdArtifact(scaffold, `{"tasks":[]}`)).rejects.toThrow(
			"tasks",
		);
	});
});
