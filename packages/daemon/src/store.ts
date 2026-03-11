import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

import {
	type DaemonJob,
	type DaemonState,
	DaemonState as DaemonStateSchema,
	type ManagedInstance,
	type RequestMethod,
	type ResponseError as ResponseErrorSchema,
} from "./protocol";

const EMPTY_STATE: DaemonState = {
	version: 2,
	instances: [],
	jobs: [],
};

export class StoreError extends Error {
	constructor(
		public readonly code: z.infer<typeof ResponseErrorSchema>["code"],
		message: string,
	) {
		super(message);
		this.name = "StoreError";
	}
}

export class StateStore {
	private pendingSave: Promise<void> = Promise.resolve();
	private directoryReady: Promise<void> | undefined;

	constructor(private readonly statePath: string) {}

	async load(): Promise<DaemonState> {
		try {
			const raw = await readFile(this.statePath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			const current = DaemonStateSchema.safeParse(parsed);
			if (current.success) {
				return current.data;
			}

			return structuredClone(EMPTY_STATE);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return structuredClone(EMPTY_STATE);
			}
			throw error;
		}
	}

	async save(state: DaemonState): Promise<void> {
		const payload = `${JSON.stringify(state, null, 2)}\n`;
		const persist = async (): Promise<void> => {
			await this.ensureDirectory();
			await Bun.write(this.statePath, payload);
		};

		const savePromise = this.pendingSave.then(persist, persist);
		this.pendingSave = savePromise.catch(() => undefined);
		await savePromise;
	}

	private async ensureDirectory(): Promise<void> {
		if (!this.directoryReady) {
			this.directoryReady = mkdir(dirname(this.statePath), {
				recursive: true,
			}).then(() => undefined);
		}
		await this.directoryReady;
	}

	upsertJob(state: DaemonState, job: DaemonJob): DaemonState {
		const jobs = state.jobs.filter((item: DaemonJob) => item.id !== job.id);
		jobs.push(job);
		jobs.sort((a: DaemonJob, b: DaemonJob) =>
			a.createdAt < b.createdAt ? 1 : -1,
		);
		return {
			...state,
			jobs,
		};
	}

	getJob(state: DaemonState, jobId: string): DaemonJob | undefined {
		return state.jobs.find((item: DaemonJob) => item.id === jobId);
	}

	listJobs(
		state: DaemonState,
		filter: { instanceId?: string; state?: DaemonJob["state"] },
	): DaemonJob[] {
		return state.jobs.filter((job: DaemonJob) => {
			if (filter.instanceId && job.instanceId !== filter.instanceId) {
				return false;
			}
			if (filter.state && job.state !== filter.state) {
				return false;
			}
			return true;
		});
	}

	createInstance(state: DaemonState, instance: ManagedInstance): DaemonState {
		if (
			state.instances.some(
				(item: ManagedInstance) => item.directory === instance.directory,
			)
		) {
			throw new StoreError(
				"conflict",
				`instance already exists for directory ${instance.directory}`,
			);
		}

		const next = [...state.instances, instance].sort(
			(a: ManagedInstance, b: ManagedInstance) =>
				a.createdAt < b.createdAt ? 1 : -1,
		);
		return {
			...state,
			instances: next,
		};
	}

	upsertInstance(state: DaemonState, instance: ManagedInstance): DaemonState {
		const duplicate = state.instances.find(
			(item: ManagedInstance) =>
				item.directory === instance.directory && item.id !== instance.id,
		);
		if (duplicate) {
			throw new StoreError(
				"conflict",
				`instance already exists for directory ${instance.directory}`,
			);
		}

		const instances = state.instances.filter(
			(item: ManagedInstance) => item.id !== instance.id,
		);
		instances.push(instance);
		instances.sort((a: ManagedInstance, b: ManagedInstance) =>
			a.createdAt < b.createdAt ? 1 : -1,
		);
		return {
			...state,
			instances,
		};
	}

	removeInstance(state: DaemonState, instanceId: string): DaemonState {
		return {
			...state,
			instances: state.instances.filter(
				(item: ManagedInstance) => item.id !== instanceId,
			),
		};
	}

	getInstance(
		state: DaemonState,
		instanceId: string,
	): ManagedInstance | undefined {
		return state.instances.find(
			(item: ManagedInstance) => item.id === instanceId,
		);
	}

	listInstances(state: DaemonState): ManagedInstance[] {
		return [...state.instances];
	}

	assertInstance(state: DaemonState, instanceId: string): ManagedInstance {
		const instance = this.getInstance(state, instanceId);
		if (!instance) {
			throw new StoreError("not_found", `instance ${instanceId} not found`);
		}
		return instance;
	}

	assertJob(state: DaemonState, jobId: string): DaemonJob {
		const job = this.getJob(state, jobId);
		if (!job) {
			throw new StoreError("not_found", `job ${jobId} not found`);
		}
		return job;
	}
}

export function requestMethodList(): RequestMethod[] {
	return [
		"daemon.health",
		"daemon.shutdown",
		"instance.create",
		"instance.list",
		"instance.get",
		"instance.start",
		"instance.stop",
		"instance.remove",
		"job.submit",
		"job.list",
		"job.get",
		"job.cancel",
	];
}
