import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, rm } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import type { Part } from "@opencode-ai/sdk/v2";
import { z } from "zod";
import { resolveDaemonRuntimeEnv, SOCKET_PATH } from "./env";
import {
	type ManagedOpencodeRuntime,
	OpencodeRegistry,
	type OpencodeRuntimeManager,
} from "./opencode";
import {
	type CancelResult,
	type DaemonJob,
	type DaemonState,
	DaemonState as DaemonStateSchema,
	type ErrorResponse,
	type GetResult,
	type HealthResult,
	type InstanceHealth,
	type InstanceListResult,
	type InstanceResult,
	type JobState,
	type ListResult,
	type ManagedInstance,
	normalizeIssues,
	type RequestByMethod,
	type RequestMessage,
	RequestMessage as RequestMessageSchema,
	type RequestMethod,
	type ResponseError,
	type ResponseMessage,
	type ResultByMethod,
	type ShutdownResult,
	type SubmitResult,
} from "./protocol";
import { StateStore, StoreError } from "./store";

interface RunningJob {
	controller: AbortController;
	instanceId: string;
}

interface DaemonOptions {
	registry?: OpencodeRuntimeManager;
	maxConcurrency?: number;
}

function extractText(parts: Part[]): string {
	return parts
		.filter(
			(part): part is Extract<Part, { type: "text" }> => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"data" in error &&
		typeof error.data === "object" &&
		error.data !== null &&
		"message" in error.data &&
		typeof error.data.message === "string"
	) {
		return error.data.message;
	}

	return "Unknown daemon error";
}

export class Daemon {
	private state: DaemonState = structuredClone(
		DaemonStateSchema.parse({
			instances: [],
			jobs: [],
		}),
	);
	private readonly registry: OpencodeRuntimeManager;
	private readonly queues = new Map<string, string[]>();
	private readonly runningJobs = new Map<string, RunningJob>();
	private readonly runningTasks = new Map<string, Promise<void>>();
	private startedAt = Date.now();
	private onShutdown: (() => void) | undefined;
	private drainPromise: Promise<void> | undefined;
	private shuttingDown = false;
	private shutdownPromise: Promise<void> | undefined;
	private instanceCursor = 0;
	private readonly maxConcurrency: number;

	constructor(
		private readonly store: StateStore,
		options: DaemonOptions = {},
	) {
		this.registry = options.registry ?? new OpencodeRegistry();
		this.maxConcurrency =
			options.maxConcurrency ?? resolveDaemonRuntimeEnv().maxConcurrency;
	}

	setShutdownHandler(handler: () => void): void {
		this.onShutdown = handler;
	}

	async bootstrap(): Promise<void> {
		this.state = await this.store.load();
		this.state = await this.recoverPersistedState(this.state);
		await this.store.save(this.state);
		this.scheduleDrain();
	}

	handleRequest = async (raw: RequestMessage): Promise<ResponseMessage> => {
		try {
			switch (raw.method) {
				case "daemon.health":
					return this.success(raw, this.healthResult());
				case "daemon.shutdown": {
					const result: ShutdownResult = { ok: true };
					setTimeout(() => this.onShutdown?.(), 50);
					return this.success(raw, result);
				}
				case "instance.create":
					return this.success(raw, await this.handleInstanceCreate(raw));
				case "instance.list":
					return this.success(raw, this.handleInstanceList());
				case "instance.get":
					return this.success(raw, this.handleInstanceGet(raw));
				case "instance.start":
					return this.success(raw, await this.handleInstanceStart(raw));
				case "instance.stop":
					return this.success(raw, await this.handleInstanceStop(raw));
				case "instance.remove":
					return this.success(raw, await this.handleInstanceRemove(raw));
				case "job.submit":
					return this.success(raw, await this.handleJobSubmit(raw));
				case "job.list":
					return this.success(raw, this.handleJobList(raw));
				case "job.get":
					return this.success(raw, this.handleJobGet(raw));
				case "job.cancel":
					return this.success(raw, await this.handleJobCancel(raw));
			}
		} catch (error) {
			return this.failure(raw.id, raw.method, this.toResponseError(error));
		}
	};

	async shutdown(): Promise<void> {
		if (this.shutdownPromise) {
			return this.shutdownPromise;
		}

		this.shuttingDown = true;
		for (const { controller } of this.runningJobs.values()) {
			controller.abort();
		}

		this.shutdownPromise = (async () => {
			await this.drainPromise;
			await Promise.allSettled([...this.runningTasks.values()]);
			await this.registry.stopAll();
			await this.store.save(this.state);
		})();

		return this.shutdownPromise;
	}

	private healthResult(): HealthResult {
		return {
			pid: process.pid,
			uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
			queued: this.jobCount("queued"),
			running: this.jobCount("running"),
			finished: this.state.jobs.filter((job: DaemonJob) =>
				["succeeded", "failed", "cancelled"].includes(job.state),
			).length,
			instances: this.state.instances.map(
				(instance: ManagedInstance): InstanceHealth => ({
					instanceId: instance.id,
					name: instance.name,
					status: instance.status,
					running: this.instanceJobCount(instance.id, "running"),
					queued: this.instanceJobCount(instance.id, "queued"),
					finished: this.state.jobs.filter(
						(job: DaemonJob) =>
							job.instanceId === instance.id &&
							["succeeded", "failed", "cancelled"].includes(job.state),
					).length,
					lastError: instance.lastError,
				}),
			),
		};
	}

	private async handleInstanceCreate(
		request: RequestByMethod<"instance.create">,
	): Promise<InstanceResult> {
		const now = new Date().toISOString();
		const instance: ManagedInstance = {
			id: randomUUID(),
			name: request.params.name.trim(),
			directory: request.params.directory,
			status: "stopped",
			maxConcurrency: request.params.maxConcurrency ?? 1,
			createdAt: now,
			updatedAt: now,
		};
		this.state = this.store.createInstance(this.state, instance);
		await this.store.save(this.state);
		return { instance };
	}

	private handleInstanceList(): InstanceListResult {
		return {
			instances: this.store.listInstances(this.state),
		};
	}

	private handleInstanceGet(
		request: RequestByMethod<"instance.get">,
	): InstanceResult {
		return {
			instance: this.store.assertInstance(
				this.state,
				request.params.instanceId,
			),
		};
	}

	private async handleInstanceStart(
		request: RequestByMethod<"instance.start">,
	): Promise<InstanceResult> {
		const instance = await this.startInstance(request.params.instanceId);
		return { instance };
	}

	private async handleInstanceStop(
		request: RequestByMethod<"instance.stop">,
	): Promise<InstanceResult> {
		const instance = this.store.assertInstance(
			this.state,
			request.params.instanceId,
		);
		if (this.runningCountForInstance(instance.id) > 0) {
			throw new StoreError(
				"conflict",
				`instance ${instance.id} has running jobs and cannot be stopped`,
			);
		}

		await this.registry.stop(instance.id);
		const stopped: ManagedInstance = {
			...instance,
			status: "stopped",
			updatedAt: new Date().toISOString(),
		};
		this.state = this.store.upsertInstance(this.state, stopped);
		await this.store.save(this.state);
		return { instance: stopped };
	}

	private async handleInstanceRemove(
		request: RequestByMethod<"instance.remove">,
	): Promise<InstanceResult> {
		const instance = this.store.assertInstance(
			this.state,
			request.params.instanceId,
		);
		const active = this.state.jobs.some(
			(job: DaemonJob) =>
				job.instanceId === instance.id &&
				(job.state === "queued" || job.state === "running"),
		);
		if (active) {
			throw new StoreError(
				"conflict",
				`instance ${instance.id} has active jobs and cannot be removed`,
			);
		}

		await this.registry.stop(instance.id);
		this.queues.delete(instance.id);
		this.state = this.store.removeInstance(this.state, instance.id);
		await this.store.save(this.state);
		return { instance };
	}

	private async handleJobSubmit(
		request: RequestByMethod<"job.submit">,
	): Promise<SubmitResult> {
		if (this.shuttingDown) {
			throw new StoreError("shutdown", "daemon is shutting down");
		}

		const { instanceId } = request.params;
		this.store.assertInstance(this.state, instanceId);

		const now = new Date().toISOString();
		const job: DaemonJob = {
			id: randomUUID(),
			instanceId,
			session: request.params.session,
			task: request.params.task,
			state: "queued",
			createdAt: now,
			updatedAt: now,
		};
		this.state = this.store.upsertJob(this.state, job);
		this.enqueue(job);
		await this.store.save(this.state);
		this.scheduleDrain();
		return { job };
	}

	private handleJobList(request: RequestByMethod<"job.list">): ListResult {
		return {
			jobs: this.store.listJobs(this.state, request.params),
		};
	}

	private handleJobGet(request: RequestByMethod<"job.get">): GetResult {
		return {
			job: this.store.assertJob(this.state, request.params.jobId),
		};
	}

	private async handleJobCancel(
		request: RequestByMethod<"job.cancel">,
	): Promise<CancelResult> {
		const job = this.store.assertJob(this.state, request.params.jobId);
		if (job.state === "queued") {
			const queue = this.queues.get(job.instanceId);
			if (queue) {
				const index = queue.indexOf(job.id);
				if (index >= 0) {
					queue.splice(index, 1);
				}
			}
			job.state = "cancelled";
			job.endedAt = new Date().toISOString();
			job.updatedAt = job.endedAt;
			job.error = "Job cancelled";
			this.state = this.store.upsertJob(this.state, job);
			await this.store.save(this.state);
			return { job };
		}

		const running = this.runningJobs.get(job.id);
		if (running) {
			job.state = "cancelled";
			job.error = "Job cancelled";
			job.updatedAt = new Date().toISOString();
			this.state = this.store.upsertJob(this.state, job);
			await this.store.save(this.state);
			running.controller.abort();
			if (job.sessionId) {
				void this.abortRemoteSession(running.instanceId, job.sessionId);
			}
		}

		return { job };
	}

	private async recoverPersistedState(
		state: DaemonState,
	): Promise<DaemonState> {
		let next: DaemonState = {
			...state,
			instances: state.instances.map(
				(instance: ManagedInstance): ManagedInstance => ({
					...instance,
					status: "stopped",
					updatedAt: new Date().toISOString(),
				}),
			),
		};
		this.queues.clear();

		for (const job of next.jobs) {
			if (job.state === "running") {
				job.state = "queued";
				job.error = [job.error, "Recovered after daemon restart"]
					.filter(Boolean)
					.join(" ");
				job.updatedAt = new Date().toISOString();
			}

			next = this.store.upsertJob(next, job);
			if (job.state === "queued" && job.instanceId) {
				this.enqueue(job);
			}
		}

		return next;
	}

	private enqueue(job: DaemonJob): void {
		const queue = this.queues.get(job.instanceId) ?? [];
		if (!queue.includes(job.id)) {
			queue.push(job.id);
		}
		this.queues.set(job.instanceId, queue);
	}

	private async drainQueue(): Promise<void> {
		while (!this.shuttingDown && this.runningJobs.size < this.maxConcurrency) {
			const job = this.dequeueNextJob();
			if (!job) {
				break;
			}
			await this.startJob(job);
		}
	}

	private scheduleDrain(): void {
		if (this.drainPromise) {
			return;
		}

		this.drainPromise = this.drainQueue().finally(() => {
			this.drainPromise = undefined;
		});
	}

	private dequeueNextJob(): DaemonJob | undefined {
		const instances = this.state.instances;
		if (instances.length === 0) {
			return undefined;
		}

		const start = this.instanceCursor % instances.length;
		const ordered = instances.slice(start).concat(instances.slice(0, start));
		this.instanceCursor = (start + 1) % instances.length;

		for (const instance of ordered) {
			if (
				this.runningCountForInstance(instance.id) >= instance.maxConcurrency
			) {
				continue;
			}

			const queue = this.queues.get(instance.id);
			if (!queue || queue.length === 0) {
				continue;
			}

			while (queue.length > 0) {
				const jobId = queue.shift();
				if (!jobId) {
					break;
				}
				const job = this.store.getJob(this.state, jobId);
				if (job && job.state === "queued" && job.instanceId === instance.id) {
					return job;
				}
			}
		}

		return undefined;
	}

	private async startJob(job: DaemonJob): Promise<void> {
		const controller = new AbortController();
		this.runningJobs.set(job.id, {
			controller,
			instanceId: job.instanceId,
		});

		job.state = "running";
		job.startedAt = new Date().toISOString();
		job.updatedAt = job.startedAt;
		this.state = this.store.upsertJob(this.state, job);
		await this.store.save(this.state);

		const execution = this.executeJob(job, controller)
			.catch(() => undefined)
			.finally(async () => {
				this.runningJobs.delete(job.id);
				this.runningTasks.delete(job.id);
				await this.store.save(this.state);
				if (!this.shuttingDown) {
					this.scheduleDrain();
				}
			});
		this.runningTasks.set(job.id, execution);
	}

	private async executeJob(
		job: DaemonJob,
		controller: AbortController,
	): Promise<void> {
		try {
			const instance = await this.startInstance(job.instanceId);
			const runtime = await this.registry.ensureStarted(instance.id);
			const sessionId = await this.resolveSession(
				runtime.client,
				instance,
				job,
			);

			switch (job.task.type) {
				case "prompt": {
					const response = await runtime.client.session.prompt({
						sessionID: sessionId,
						directory: instance.directory,
						agent: job.task.agent,
						model: job.task.model
							? {
									providerID: job.task.model.providerId,
									modelID: job.task.model.modelId,
								}
							: undefined,
						system: job.task.system,
						variant: job.task.variant,
						parts: [{ type: "text", text: job.task.prompt }],
					});
					job.messageId = response.data.info.id;
					job.outputText = extractText(response.data.parts);
					job.error = undefined;
					job.state = controller.signal.aborted ? "cancelled" : "succeeded";
					break;
				}
			}
		} catch (error) {
			job.state = controller.signal.aborted ? "cancelled" : "failed";
			job.error = controller.signal.aborted
				? "Job cancelled"
				: normalizeErrorMessage(error);
		} finally {
			job.endedAt = new Date().toISOString();
			job.updatedAt = job.endedAt;
			this.state = this.store.upsertJob(this.state, job);
		}
	}

	private async resolveSession(
		client: ManagedOpencodeRuntime["client"],
		instance: ManagedInstance,
		job: DaemonJob,
	): Promise<string> {
		if (job.sessionId) {
			return job.sessionId;
		}

		if (job.session.type === "existing") {
			job.sessionId = job.session.sessionId;
			return job.sessionId;
		}

		const session = await client.session.create({
			directory: instance.directory,
			title: job.session.title,
		});
		job.sessionId = session.data.id;
		this.state = this.store.upsertJob(this.state, job);
		await this.store.save(this.state);
		return session.data.id;
	}

	private async startInstance(instanceId: string): Promise<ManagedInstance> {
		const current = this.store.assertInstance(this.state, instanceId);
		if (this.registry.isRunning(instanceId)) {
			if (current.status !== "running") {
				const running = {
					...current,
					status: "running" as const,
					lastError: undefined,
					updatedAt: new Date().toISOString(),
				};
				this.state = this.store.upsertInstance(this.state, running);
				await this.store.save(this.state);
				return running;
			}
			return current;
		}

		const starting: ManagedInstance = {
			...current,
			status: "starting",
			updatedAt: new Date().toISOString(),
		};
		this.state = this.store.upsertInstance(this.state, starting);
		await this.store.save(this.state);

		try {
			await this.registry.ensureStarted(instanceId);
			const running: ManagedInstance = {
				...starting,
				status: "running",
				lastError: undefined,
				updatedAt: new Date().toISOString(),
			};
			this.state = this.store.upsertInstance(this.state, running);
			await this.store.save(this.state);
			return running;
		} catch (error) {
			const failed: ManagedInstance = {
				...starting,
				status: "error",
				lastError: normalizeErrorMessage(error),
				updatedAt: new Date().toISOString(),
			};
			this.state = this.store.upsertInstance(this.state, failed);
			await this.store.save(this.state);
			throw new StoreError(
				"instance_unavailable",
				failed.lastError ?? "failed to start instance",
			);
		}
	}

	private async abortRemoteSession(
		instanceId: string,
		sessionId: string,
	): Promise<void> {
		const runtime = this.registry.get(instanceId);
		const instance = this.store.getInstance(this.state, instanceId);
		if (!runtime || !instance) {
			return;
		}

		try {
			await runtime.client.session.abort({
				sessionID: sessionId,
				directory: instance.directory,
			});
		} catch {
			// The local cancellation state is authoritative for daemon jobs.
		}
	}

	private runningCountForInstance(instanceId: string): number {
		let total = 0;
		for (const running of this.runningJobs.values()) {
			if (running.instanceId === instanceId) {
				total += 1;
			}
		}
		return total;
	}

	private jobCount(state: JobState): number {
		return this.state.jobs.filter((job: DaemonJob) => job.state === state)
			.length;
	}

	private instanceJobCount(instanceId: string, state: JobState): number {
		return this.state.jobs.filter(
			(job: DaemonJob) => job.instanceId === instanceId && job.state === state,
		).length;
	}

	private success<M extends RequestMethod>(
		request: RequestByMethod<M>,
		result: ResultByMethod<M>,
	): ResponseMessage {
		return {
			id: request.id,
			method: request.method,
			ok: true,
			result,
		} as ResponseMessage;
	}

	private failure(
		id: string,
		method: RequestMethod | "unknown",
		error: ResponseError,
	): ErrorResponse {
		return {
			id,
			method,
			ok: false,
			error,
		};
	}

	private toResponseError(error: unknown): ResponseError {
		if (error instanceof StoreError) {
			return {
				code: error.code,
				message: error.message,
			};
		}

		if (error instanceof z.ZodError) {
			return {
				code: "invalid_request",
				message: "request validation failed",
				issues: normalizeIssues(error),
			};
		}

		return {
			code: "internal",
			message: normalizeErrorMessage(error),
		};
	}
}

export async function ensureSocketDir(
	socketPath: string = SOCKET_PATH,
): Promise<void> {
	await mkdir(dirname(socketPath), { recursive: true });
}

export async function clearStaleSocket(
	socketPath: string = SOCKET_PATH,
): Promise<void> {
	try {
		await access(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
		return;
	}

	if (await canConnectToSocket(socketPath)) {
		throw new Error(`ralphd is already running at ${socketPath}`);
	}

	await rm(socketPath, { force: true });
}

async function canConnectToSocket(socketPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(socketPath);
		let settled = false;

		const finish = (result: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			socket.destroy();
			resolve(result);
		};

		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.setTimeout(250, () => finish(false));
	});
}

export function createConnectionHandler(daemon: Daemon) {
	return (socket: Socket) => {
		socket.setEncoding("utf8");
		let buffer = "";

		socket.on("data", (chunk) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.trim()) {
					continue;
				}

				let parsed: unknown;
				try {
					parsed = JSON.parse(line) as unknown;
				} catch {
					const response: ErrorResponse = {
						id: randomUUID(),
						method: "unknown",
						ok: false,
						error: {
							code: "invalid_json",
							message: "invalid json request",
						},
					};
					socket.write(`${JSON.stringify(response)}\n`);
					continue;
				}

				const request = RequestMessageSchema.safeParse(parsed);
				if (!request.success) {
					const maybeMethod =
						typeof parsed === "object" &&
						parsed !== null &&
						"method" in parsed &&
						typeof parsed.method === "string"
							? parsed.method
							: "unknown";
					const maybeId =
						typeof parsed === "object" &&
						parsed !== null &&
						"id" in parsed &&
						typeof parsed.id === "string"
							? parsed.id
							: randomUUID();
					const response: ErrorResponse = {
						id: maybeId,
						method:
							maybeMethod === "unknown"
								? "unknown"
								: (maybeMethod as RequestMethod | "unknown"),
						ok: false,
						error: {
							code: "invalid_request",
							message: "request validation failed",
							issues: normalizeIssues(request.error),
						},
					};
					socket.write(`${JSON.stringify(response)}\n`);
					continue;
				}

				void daemon.handleRequest(request.data).then((response) => {
					socket.write(`${JSON.stringify(response)}\n`);
				});
			}
		});
	};
}

export async function runDaemonServer(): Promise<void> {
	const env = resolveDaemonRuntimeEnv();
	await mkdir(env.ralphHome, { recursive: true });
	await ensureSocketDir(env.socketPath);
	await clearStaleSocket(env.socketPath);

	const daemon = new Daemon(new StateStore(env.statePath), {
		maxConcurrency: env.maxConcurrency,
	});
	await daemon.bootstrap();

	const server = createServer(createConnectionHandler(daemon));
	server.listen(env.socketPath, async () => {
		await chmod(env.socketPath, 0o600);
		process.stdout.write(`ralphd listening on ${env.socketPath}\n`);
	});

	let shutdownPromise: Promise<void> | undefined;
	const shutdown = async () => {
		if (shutdownPromise) {
			return shutdownPromise;
		}

		shutdownPromise = (async () => {
			server.close();
			await daemon.shutdown();
			await rm(env.socketPath, { force: true });
		})();

		return shutdownPromise;
	};

	daemon.setShutdownHandler(() => void shutdown());
	process.on("SIGINT", () => {
		void shutdown().finally(() => process.exit(0));
	});
	process.on("SIGTERM", () => {
		void shutdown().finally(() => process.exit(0));
	});
}

if (import.meta.main) {
	void runDaemonServer();
}
