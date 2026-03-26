import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { Worktree } from "./worktree";

type FakeResult = {
	cwd(directory: string): FakeResult;
	text(): Promise<string>;
};

type FakeShell = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => FakeResult;

type CommandCall = {
	command: string;
	cwd?: string;
};

function createFakeShell(outputs: Record<string, string>): {
	shell: FakeShell;
	calls: CommandCall[];
} {
	const calls: CommandCall[] = [];

	const shell: FakeShell = (strings, ...values) => {
		const command = strings
			.reduce((acc, part, idx) => {
				const value = idx < values.length ? String(values[idx]) : "";
				return `${acc}${part}${value}`;
			}, "")
			.trim();

		const call: CommandCall = { command };
		calls.push(call);

		return {
			cwd(directory: string) {
				call.cwd = directory;
				return this;
			},
			async text() {
				return outputs[command] ?? "";
			},
		};
	};

	return { shell, calls };
}

describe("Worktree", () => {
	it("creates a worktree with expected branch and path", async () => {
		const repoRoot = "/tmp/project/repo";
		const { shell, calls } = createFakeShell({
			"git rev-parse --show-toplevel": `${repoRoot}\n`,
		});
		const worktree = new Worktree(shell);

		const info = await worktree.create("worker-1");

		expect(info).toEqual({
			name: "worker-1",
			path: resolve(repoRoot, "..", ".worktrees", "worker-1"),
			branch: "worktree/worker-1",
		});
		expect(calls[1]).toEqual({
			command: `git worktree add ${resolve(repoRoot, "..", ".worktrees", "worker-1")} -b worktree/worker-1`,
			cwd: repoRoot,
		});
	});

	it("rejects invalid names before running git commands", async () => {
		const { shell, calls } = createFakeShell({
			"git rev-parse --show-toplevel": "/tmp/project/repo\n",
		});
		const worktree = new Worktree(shell);

		await expect(worktree.create("../escape")).rejects.toThrow("Invalid worktree name");
		await expect(worktree.remove(" bad")).rejects.toThrow("Invalid worktree name");
		await expect(worktree.merge("a/b")).rejects.toThrow("Invalid worktree name");
		expect(calls).toHaveLength(0);
	});

	it("lists attached and detached worktrees", async () => {
		const repoRoot = "/tmp/project/repo";
		const { shell } = createFakeShell({
			"git rev-parse --show-toplevel": `${repoRoot}\n`,
			"git worktree list --porcelain": [
				"worktree /tmp/project/repo",
				"HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"branch refs/heads/main",
				"",
				"worktree /tmp/project/.worktrees/worker-2",
				"HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				"detached",
				"",
			].join("\n"),
		});
		const worktree = new Worktree(shell);

		await expect(worktree.list()).resolves.toEqual([
			{ name: "repo", path: "/tmp/project/repo", branch: "main" },
			{
				name: "worker-2",
				path: "/tmp/project/.worktrees/worker-2",
				branch: "HEAD",
			},
		]);
	});

	it("fails fast on malformed worktree entries", async () => {
		const repoRoot = "/tmp/project/repo";
		const { shell } = createFakeShell({
			"git rev-parse --show-toplevel": `${repoRoot}\n`,
			"git worktree list --porcelain": ["HEAD deadbeef", "branch refs/heads/main", ""].join(
				"\n",
			),
		});
		const worktree = new Worktree(shell);

		await expect(worktree.list()).rejects.toThrow("Unable to parse worktree entry");
	});

	it("removes a worktree without force by default", async () => {
		const repoRoot = "/tmp/project/repo";
		const { shell, calls } = createFakeShell({
			"git rev-parse --show-toplevel": `${repoRoot}\n`,
		});
		const worktree = new Worktree(shell);

		await worktree.remove("worker-4");

		expect(calls.map((call) => call.command)).toEqual([
			"git rev-parse --show-toplevel",
			`git worktree remove ${resolve(repoRoot, "..", ".worktrees", "worker-4")}`,
		]);
		expect(calls[1]?.cwd).toBe(repoRoot);
	});

	it("removes a worktree with force when specified", async () => {
		const repoRoot = "/tmp/project/repo";
		const { shell, calls } = createFakeShell({
			"git rev-parse --show-toplevel": `${repoRoot}\n`,
		});
		const worktree = new Worktree(shell);

		await worktree.remove("worker-4", { force: true });

		expect(calls.map((call) => call.command)).toEqual([
			"git rev-parse --show-toplevel",
			`git worktree remove ${resolve(repoRoot, "..", ".worktrees", "worker-4")} --force`,
		]);
		expect(calls[1]?.cwd).toBe(repoRoot);
	});

	it("merge runs merge, force-removes worktree, and deletes branch", async () => {
		const repoRoot = "/tmp/project/repo";
		const { shell, calls } = createFakeShell({
			"git rev-parse --show-toplevel": `${repoRoot}\n`,
		});
		const worktree = new Worktree(shell);

		await worktree.merge("worker-3");

		expect(calls.map((call) => call.command)).toEqual([
			"git rev-parse --show-toplevel",
			"git merge worktree/worker-3",
			`git worktree remove ${resolve(repoRoot, "..", ".worktrees", "worker-3")} --force`,
			"git branch -d worktree/worker-3",
		]);
		expect(calls[1]?.cwd).toBe(repoRoot);
		expect(calls[2]?.cwd).toBe(repoRoot);
		expect(calls[3]?.cwd).toBe(repoRoot);
	});
});
