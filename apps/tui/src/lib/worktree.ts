import { basename, isAbsolute, relative, resolve } from "node:path";
import { type ShellExpression, $ } from "bun";

export interface WorktreeInfo {
	name: string;
	path: string;
	branch: string;
}

type ShellTag = (
	strings: TemplateStringsArray,
	...values: ShellExpression[]
) => {
	cwd(directory: string): { text(): Promise<string> };
	text(): Promise<string>;
};

export class Worktree {
	constructor(private readonly shell: ShellTag = $) {}

	async create(name: string): Promise<WorktreeInfo> {
		this.assertValidName(name);
		const root = await this.repoRoot();
		const path = this.worktreePath(root, name);
		const branch = this.branchName(name);

		await this.shell`git worktree add ${path} -b ${branch}`.cwd(root).text();

		return { name, path, branch };
	}

	async remove(name: string, { force = false } = {}): Promise<void> {
		this.assertValidName(name);
		const root = await this.repoRoot();
		await this.removeAt(root, name, force);
	}

	async merge(name: string): Promise<void> {
		this.assertValidName(name);
		const root = await this.repoRoot();
		const branch = this.branchName(name);
		await this.shell`git merge ${branch}`.cwd(root).text();
		await this.removeAt(root, name, true);
		await this.shell`git branch -d ${branch}`.cwd(root).text();
	}

	async list(): Promise<WorktreeInfo[]> {
		const root = await this.repoRoot();
		const output = await this.shell`git worktree list --porcelain`
			.cwd(root)
			.text();

		if (!output.trim()) {
			return [];
		}

		return output
			.trim()
			.split("\n\n")
			.filter(Boolean)
			.map((entry) => {
				const lines = entry.split("\n");
				const worktreeLine = lines.find((line) => line.startsWith("worktree "));
				const branchLine = lines.find((line) => line.startsWith("branch "));
				const detached = lines.includes("detached");

				if (!worktreeLine) {
					throw new Error(`Unable to parse worktree entry: ${entry}`);
				}

				if (!branchLine && !detached) {
					throw new Error(`Unable to parse worktree branch: ${entry}`);
				}

				const path = worktreeLine.replace("worktree ", "").trim();
				const branchRef = branchLine?.replace("branch ", "").trim();
				const branch = branchRef
					? branchRef.replace("refs/heads/", "")
					: "HEAD";
				const name = basename(path);

				return { name, path, branch };
			});
	}

	private async removeAt(
		root: string,
		name: string,
		force = false,
	): Promise<void> {
		const path = this.worktreePath(root, name);
		if (force) {
			await this.shell`git worktree remove ${path} --force`.cwd(root).text();
		} else {
			await this.shell`git worktree remove ${path}`.cwd(root).text();
		}
	}

	private branchName(name: string): string {
		return `worktree/${name}`;
	}

	private worktreePath(root: string, name: string): string {
		const base = resolve(root, "..", ".worktrees");
		const path = resolve(base, name);
		const rel = relative(base, path);

		if (isAbsolute(rel) || rel.startsWith("..")) {
			throw new Error(`Worktree path escapes base directory: ${name}`);
		}

		return path;
	}

	private assertValidName(name: string): void {
		if (name.length === 0 || name.trim() !== name) {
			throw new Error(`Invalid worktree name: "${name}"`);
		}

		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
			throw new Error(`Invalid worktree name: "${name}"`);
		}
	}

	private async repoRoot(): Promise<string> {
		return (await this.shell`git rev-parse --show-toplevel`.text()).trim();
	}
}
