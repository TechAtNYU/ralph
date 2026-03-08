import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DaemonState, LoopJob } from "./protocol";

const EMPTY_STATE: DaemonState = {
	jobs: [],
};

export class StateStore {
	constructor(private readonly statePath: string) {}

	async load(): Promise<DaemonState> {
		try {
			const raw = await readFile(this.statePath, "utf8");
			const parsed = JSON.parse(raw) as DaemonState;
			if (!Array.isArray(parsed.jobs)) {
				return structuredClone(EMPTY_STATE);
			}
			return {
				jobs: parsed.jobs,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return structuredClone(EMPTY_STATE);
			}
			throw error;
		}
	}

	async save(state: DaemonState): Promise<void> {
		await mkdir(dirname(this.statePath), { recursive: true });
		await writeFile(
			this.statePath,
			`${JSON.stringify(state, null, 2)}\n`,
			"utf8",
		);
	}

	upsertJob(state: DaemonState, job: LoopJob): DaemonState {
		const next = state.jobs.filter((item) => item.id !== job.id);
		next.push(job);
		next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
		return {
			jobs: next,
		};
	}

	getJob(state: DaemonState, jobId: string): LoopJob | undefined {
		return state.jobs.find((item) => item.id === jobId);
	}
}
