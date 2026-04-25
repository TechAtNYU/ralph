import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, rm } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
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
	type ErrorResponse,
	type GetResult,
	type HealthResult,
	type InstanceListResult,
	type InstanceResult,
	type JobStreamEvent,
	type ListResult,
	type ManagedInstance,
	normalizeIssues,
	type ProviderListResult,
	type RequestByMethod,
	type RequestMessage,
	RequestMessage as RequestMessageSchema,
	type RequestMethod,
	type ResponseError,
	type ResponseMessage,
	type ResultByMethod,
	type SessionGetResult,
	type SessionListResult,
	type ShutdownResult,
	type StreamAckResult,
	type SubmitResult,
} from "./protocol";
import { type JobSessionRef, StateStore, StoreError } from "./store";

const MAX_TERMINAL_JOBS = 100;
/**
 * Upper bound on how long `job.cancel` will wait for the in-flight execution
 * to settle after the local abort + remote `session.abort` have been issued.
 * If the remote runtime ignores or is slow to honor the abort, the RPC still
 * returns promptly with the job's current (non-terminal) row, and the
 * executor's eventual terminal write is delivered via the `done` stream
 * event.
 */
const CANCEL_WAIT_TIMEOUT_MS = 2_000;

interface RunningJob {
	controller: AbortController;
	instanceId: string;
}

interface DaemonOptions {
	registry?: OpencodeRuntimeManager;
	maxConcurrency?: number;
	/** Override for `CANCEL_WAIT_TIMEOUT_MS`. Tests only. */
	cancelWaitTimeoutMs?: number;
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

const MAX_SESSION_TITLE_LENGTH = 80;

function deriveSessionTitle(sessionRef: JobSessionRef, job: DaemonJob): string {
	if (sessionRef.kind === "new" && sessionRef.title) {
		return sessionRef.title;
	}
	if (job.task.type === "prompt") {
		const text = job.task.prompt.trim();
		if (text.length === 0) {
			return "Untitled";
		}
		if (text.length > MAX_SESSION_TITLE_LENGTH) {
			return `${text.slice(0, MAX_SESSION_TITLE_LENGTH - 3)}...`;
		}
		return text;
	}
	return "Untitled";
}

/**
 * Resolves when either `promise` settles or `timeoutMs` elapses, whichever
 * comes first. Never rejects. The caller should read downstream state from
 * the store after this returns — the returned value is intentionally unused.
 */
function raceWithTimeout(
	promise: Promise<unknown>,
	timeoutMs: number,
): Promise<void> {
	return new Promise<void>((resolve) => {
		let settled = false;
		const done = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const timer = setTimeout(done, timeoutMs);
		promise.finally(() => {
			clearTimeout(timer);
			done();
		});
	});
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

function normalizeSessionError(error: unknown): string {
	if (!error) {
		return "OpenCode session error";
	}

	if (typeof error === "string") {
		return error;
	}

	if (typeof error !== "object") {
		return String(error);
	}

	const record = error as {
		name?: unknown;
		data?: unknown;
		message?: unknown;
	};
	const name = typeof record.name === "string" ? record.name : "OpenCodeError";
	const data = record.data;

	if (typeof data === "object" && data !== null) {
		const dataRecord = data as {
			message?: unknown;
			providerID?: unknown;
			modelID?: unknown;
		};
		if (typeof dataRecord.message === "string") {
			return `${name}: ${dataRecord.message}`;
		}
		if (
			typeof dataRecord.providerID === "string" &&
			typeof dataRecord.modelID === "string"
		) {
			return `${name}: ${dataRecord.providerID}/${dataRecord.modelID}`;
		}
	}

	if (typeof record.message === "string") {
		return `${name}: ${record.message}`;
	}

	try {
		return `${name}: ${JSON.stringify(data ?? error)}`;
	} catch {
		return name;
	}
}

export class Daemon {
	private readonly registry: OpencodeRuntimeManager;
	/** Per-instance queue of job ids waiting to be scheduled. */
	private readonly queues = new Map<string, string[]>();
	private readonly runningJobs = new Map<string, RunningJob>();
	private readonly runningTasks = new Map<string, Promise<void>>();
	/** Maps running job id → its OpenCode session id, for delta routing. */
	private readonly runningSessionIds = new Map<string, string>();
	private readonly jobStreams = new Map<
		string,
		Set<(event: JobStreamEvent) => void>
	>();
	private startedAt = Date.now();
	private onShutdown: (() => void) | undefined;
	private drainPromise: Promise<void> | undefined;
	/** True if `scheduleDrain` ran while a drain was already in flight — run again when it finishes. */
	private drainPending = false;
	private shuttingDown = false;
	private shutdownPromise: Promise<void> | undefined;
	private instanceCursor = 0;
	private readonly maxConcurrency: number;
	private readonly cancelWaitTimeoutMs: number;
	private readonly sessionIdleWaiters = new Map<string, () => void>();
	private readonly sessionErrors = new Map<string, string>();
	private readonly pendingPermissions = new Map<string, Array<{ permission: string; pattern: string; action: string }>>();

	constructor(
		private readonly store: StateStore,
		options: DaemonOptions = {},
	) {
		this.registry = options.registry ?? new OpencodeRegistry();
		this.registry.setOnEvent((instanceId, event) => {
			process.stdout.write(`[${event.type}] `);
			if (event.type === "message.part.delta") {
				this.routeDeltaToJob(
					instanceId,
					event.properties.sessionID,
					event.properties.field,
					event.properties.delta,
				);
			} else if (event.type === "session.idle") {
				this.resolveSessionIdle(event.properties.sessionID);
			} else if (
				event.type === "session.status" &&
				event.properties.status.type === "idle"
			) {
				this.resolveSessionIdle(event.properties.sessionID);
			} else if (event.type === "session.error") {
				const sessionId = event.properties.sessionID;
				if (sessionId) {
					this.sessionErrors.set(
						sessionId,
						normalizeSessionError(event.properties.error),
					);
					this.resolveSessionIdle(sessionId);
				}
			}
		});
		this.maxConcurrency =
			options.maxConcurrency ?? resolveDaemonRuntimeEnv().maxConcurrency;
		this.cancelWaitTimeoutMs =
			options.cancelWaitTimeoutMs ?? CANCEL_WAIT_TIMEOUT_MS;
	}

	setShutdownHandler(handler: () => void): void {
		this.onShutdown = handler;
	}

	async bootstrap(): Promise<void> {
		await this.store.open();
		const requeued = this.store.recoverForBootstrap();
		this.queues.clear();
		for (const { id, instanceId } of requeued) {
			this.enqueueById(instanceId, id);
		}
		// Also enqueue any queued-at-startup jobs that were never running.
		for (const job of this.store.listJobs({ state: "queued" })) {
			this.enqueueById(job.instanceId, job.id);
		}
		this.store.pruneTerminalJobs(MAX_TERMINAL_JOBS);
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
				case "provider.list":
					return this.success(raw, await this.handleProviderList(raw));
				case "session.list":
					return this.success(raw, this.handleSessionList(raw));
				case "session.get":
					return this.success(raw, this.handleSessionGet(raw));
				case "job.submit":
					return this.success(raw, this.handleJobSubmit(raw));
				case "job.list":
					return this.success(raw, this.handleJobList(raw));
				case "job.get":
					return this.success(raw, this.handleJobGet(raw));
				case "job.cancel":
					return this.success(raw, await this.handleJobCancel(raw));
				case "job.stream":
					return this.success(raw, this.handleJobStream(raw));
				case "job.submit_and_stream":
					return this.success(raw, await this.handleJobSubmitAndStream(raw));
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
			this.store.close();
		})();

		return this.shutdownPromise;
	}

	private healthResult(): HealthResult {
		return {
			pid: process.pid,
			uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
			queued: this.store.countJobsByState("queued"),
			running: this.store.countJobsByState("running"),
			finished: this.store.countFinishedJobs(),
			instances: this.store.instanceHealth(),
		};
	}

	private handleInstanceCreate(
		request: RequestByMethod<"instance.create">,
	): InstanceResult {
		const instance = this.store.createInstance({
			name: request.params.name.trim(),
			directory: request.params.directory,
			maxConcurrency: request.params.maxConcurrency ?? 1,
		});
		return { instance };
	}

	private handleInstanceList(): InstanceListResult {
		return { instances: this.store.listInstances() };
	}

	private handleInstanceGet(
		request: RequestByMethod<"instance.get">,
	): InstanceResult {
		return {
			instance: this.store.assertInstance(request.params.instanceId),
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
		const instance = this.store.assertInstance(request.params.instanceId);
		if (this.runningCountForInstance(instance.id) > 0) {
			throw new StoreError(
				"conflict",
				`instance ${instance.id} has running jobs and cannot be stopped`,
			);
		}

		await this.registry.stop(instance.id);
		const stopped = this.store.setInstanceStatus(instance.id, "stopped");
		return { instance: stopped };
	}

	private async handleInstanceRemove(
		request: RequestByMethod<"instance.remove">,
	): Promise<InstanceResult> {
		const instance = this.store.assertInstance(request.params.instanceId);
		if (this.store.hasActiveJobs(instance.id)) {
			throw new StoreError(
				"conflict",
				`instance ${instance.id} has active jobs and cannot be removed`,
			);
		}

		await this.registry.stop(instance.id);
		this.queues.delete(instance.id);
		this.store.removeInstance(instance.id);
		return { instance };
	}

	private async handleProviderList(
		request: RequestByMethod<"provider.list">,
	): Promise<ProviderListResult> {
		return this.registry.queryProviders(
			this.store.listInstances().map((instance) => instance.directory),
			request.params.directory,
			request.params.refresh,
		);
	}

	private handleSessionList(
		request: RequestByMethod<"session.list">,
	): SessionListResult {
		this.store.assertInstance(request.params.instanceId);
		return {
			sessions: this.store.listSessions({
				instanceId: request.params.instanceId,
			}),
		};
	}

	private handleSessionGet(
		request: RequestByMethod<"session.get">,
	): SessionGetResult {
		return {
			session: this.store.assertSession(request.params.sessionId),
		};
	}

	private handleJobSubmit(
		request: RequestByMethod<"job.submit">,
	): SubmitResult {
		if (this.shuttingDown) {
			throw new StoreError("shutdown", "daemon is shutting down");
		}

		const { instanceId } = request.params;
		this.store.assertInstance(instanceId);

		const job = this.store.createJob({
			instanceId,
			session: request.params.session,
			task: request.params.task,
		});
		if (
			request.params.session.type === "new" &&
			request.params.session.permission
		) {
			this.pendingPermissions.set(job.id, request.params.session.permission);
		}
		this.enqueueById(instanceId, job.id);
		this.scheduleDrain();
		return { job };
	}

	private async handleJobSubmitAndStream(
		request: RequestByMethod<"job.submit_and_stream">,
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
		return { job };
	}

	private handleJobList(request: RequestByMethod<"job.list">): ListResult {
		return { jobs: this.store.listJobs(request.params) };
	}

	private handleJobGet(request: RequestByMethod<"job.get">): GetResult {
		return { job: this.store.assertJob(request.params.jobId) };
	}

	private handleJobStream(
		request: RequestByMethod<"job.stream">,
	): StreamAckResult {
		this.store.assertJob(request.params.jobId);
		return { jobId: request.params.jobId };
	}

	private async handleJobCancel(
		request: RequestByMethod<"job.cancel">,
	): Promise<CancelResult> {
		const job = this.store.assertJob(request.params.jobId);

		if (
			job.state === "succeeded" ||
			job.state === "failed" ||
			job.state === "cancelled"
		) {
			throw new StoreError(
				"conflict",
				`job ${job.id} is already in terminal state "${job.state}"`,
			);
		}

		if (job.state === "queued") {
			this.removeFromQueue(job.instanceId, job.id);
			const cancelled = this.store.markJobTerminal(job.id, "cancelled", {
				error: "Job cancelled",
			});
			return { job: cancelled };
		}

		// Running branch: let `executeJob` own the single terminal write so
		// there is exactly one state transition and one `done` event. We
		// abort the controller (which triggers `executeJob`'s catch path or
		// the aborted-after-success branch) and await completion before
		// returning the terminal job row.
		const running = this.runningJobs.get(job.id);
		if (!running) {
			// Job was in state=running per the store, but no in-memory task —
			// likely a stale state. Fall back to writing the terminal row
			// directly so the caller still sees a cancelled job.
			const cancelled = this.store.markJobTerminal(job.id, "cancelled", {
				error: "Job cancelled",
			});
			return { job: cancelled };
		}

		running.controller.abort();
		const remoteSessionId = this.runningSessionIds.get(job.id);
		if (remoteSessionId) {
			void this.abortRemoteSession(running.instanceId, remoteSessionId);
		}

		// Wait for `executeJob` to settle so the caller sees the terminal
		// row, but cap the wait: the SDK prompt is not wired to our abort
		// signal, so if the remote runtime is slow to honor `session.abort`
		// we would otherwise block the RPC for the full prompt duration.
		// On timeout, return the current (still-running) row — the caller
		// can subscribe to `job.stream` for the eventual `done` event.
		const execution = this.runningTasks.get(job.id);
		if (execution) {
			await raceWithTimeout(execution, this.cancelWaitTimeoutMs);
		}

		return { job: this.store.assertJob(job.id) };
	}

	/**
	 * Subscribe to a job's stream events. Synchronously delivers a snapshot
	 * of the current accumulated text (if the job is running) before
	 * registering the callback for future events. If the job is already in
	 * a terminal state, immediately delivers a `done` event and returns a
	 * no-op unsubscribe.
	 *
	 * MUST remain fully synchronous. The snapshot read and subscriber
	 * registration must happen in the same synchronous block so no delta
	 * can interleave between them — see the concurrency note in
	 * routeDeltaToJob.
	 */
	subscribeJob(jobId: string, cb: (event: JobStreamEvent) => void): () => void {
		const job = this.store.getJob(jobId);
		if (
			job &&
			(job.state === "succeeded" ||
				job.state === "failed" ||
				job.state === "cancelled")
		) {
			cb({ type: "done", jobId, job });
			return () => {};
		}

		// ATOMIC SECTION — no `await` allowed below this line until cb is
		// invoked with the snapshot. JS is single-threaded so any delta
		// arriving after this block is guaranteed to either land in the
		// snapshot text or be delivered to us as a delta event.
		let subscribers = this.jobStreams.get(jobId);
		if (!subscribers) {
			subscribers = new Set();
			this.jobStreams.set(jobId, subscribers);
		}
		const subscriberSet = subscribers;
		subscriberSet.add(cb);
		const snapshotText = job?.outputText ?? "";
		// END ATOMIC SECTION

		// Deliver the snapshot directly to this subscriber only — never via
		// emitJobEvent, which would broadcast to existing subscribers too.
		cb({ type: "snapshot", jobId, text: snapshotText });

		return () => {
			subscriberSet.delete(cb);
			if (subscriberSet.size === 0) {
				this.jobStreams.delete(jobId);
			}
		};
	}

	private emitJobEvent(jobId: string, event: JobStreamEvent): void {
		const subscribers = this.jobStreams.get(jobId);
		if (!subscribers) return;

		for (const cb of subscribers) {
			cb(event);
		}

		if (event.type === "done" || event.type === "error") {
			this.jobStreams.delete(jobId);
		}
	}

	private resolveSessionIdle(sessionId: string): void {
		const resolve = this.sessionIdleWaiters.get(sessionId);
		if (resolve) {
			this.sessionIdleWaiters.delete(sessionId);
			resolve();
		}
	}

	/**
	 * Route an incoming delta from the OpenCode event stream to the matching
	 * running job. Synchronously appends the delta to the job's `output_text`
	 * in SQLite BEFORE emitting the event, so the daemon's stored state
	 * always reflects what subscribers have seen.
	 *
	 * MUST remain fully synchronous to preserve the snapshot/delta ordering
	 * guarantee — see the concurrency note in subscribeJob. `bun:sqlite` is
	 * synchronous, so this holds.
	 */
	private routeDeltaToJob(
		instanceId: string,
		sessionId: string,
		field: string,
		delta: string,
	): void {
		for (const [jobId, running] of this.runningJobs) {
			if (running.instanceId !== instanceId) continue;
			if (this.runningSessionIds.get(jobId) !== sessionId) continue;
			if (field === "text") {
				this.store.appendJobOutput(jobId, delta);
			}
			this.emitJobEvent(jobId, { type: "delta", jobId, field, delta });
			return;
		}
	}

	private enqueueById(instanceId: string, jobId: string): void {
		const queue = this.queues.get(instanceId) ?? [];
		if (!queue.includes(jobId)) {
			queue.push(jobId);
		}
		this.queues.set(instanceId, queue);
	}

	private removeFromQueue(instanceId: string, jobId: string): void {
		const queue = this.queues.get(instanceId);
		if (!queue) return;
		const idx = queue.indexOf(jobId);
		if (idx >= 0) queue.splice(idx, 1);
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

	scheduleDrain(): void {
		if (this.drainPromise) {
			this.drainPending = true;
			return;
		}

		this.drainPromise = this.drainQueue().finally(() => {
			this.drainPromise = undefined;
			if (this.drainPending) {
				this.drainPending = false;
				this.scheduleDrain();
			}
		});
	}

	private dequeueNextJob(): DaemonJob | undefined {
		const instances = this.store.listInstances();
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
				if (!jobId) break;
				const job = this.store.getJob(jobId);
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

		const runningJob = this.store.markJobRunning(job.id);

		const execution = this.executeJob(runningJob, controller)
			.catch(() => undefined)
			.finally(() => {
				this.runningJobs.delete(job.id);
				this.runningTasks.delete(job.id);
				this.runningSessionIds.delete(job.id);
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
		let terminalState: Extract<
			DaemonJob["state"],
			"succeeded" | "failed" | "cancelled"
		>;
		const patch: { error?: string; outputText?: string; messageId?: string } =
			{};
		const log = (msg: string) =>
			process.stdout.write(`\n[job:${job.id.slice(0, 8)}] ${msg}\n`);

		try {
			log("starting instance");
			const instance = await this.startInstance(job.instanceId);
			log("ensuring runtime");
			const runtime = await this.registry.ensureStarted(
				instance.id,
				instance.directory,
			);
			log("resolving session");
			const sessionId = await this.resolveSession(
				runtime.client,
				instance,
				job,
			);
			this.runningSessionIds.set(job.id, sessionId);
			log(`session=${sessionId}`);

			switch (job.task.type) {
				case "prompt": {
					const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
					const NO_INFO_TIMEOUT_MS = 30 * 1000;
					const idlePromise = new Promise<void>((resolve) => {
						this.sessionIdleWaiters.set(sessionId, resolve);
					});
					log(`sending prompt: "${job.task.prompt.slice(0, 50)}"`);
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
					patch.messageId = response.info?.id;
					const finalText = extractText(response.parts ?? []);
					const current = this.store.getJob(job.id);
					if (!current?.outputText || current.outputText.length === 0) {
						patch.outputText = finalText;
					}
					if (!patch.outputText || patch.outputText.length === 0) {
						log("prompt sent, awaiting idle");
						try {
							await Promise.race([
								idlePromise,
								response.info
									? new Promise<void>((_, reject) => {
											setTimeout(
												() => reject(new Error("session.idle timeout")),
												IDLE_TIMEOUT_MS,
											);
										})
									: new Promise<void>((_, reject) => {
											setTimeout(
												() =>
													reject(
														new Error("OpenCode returned no message data"),
													),
												NO_INFO_TIMEOUT_MS,
											);
										}),
							]);
							log("idle received");
						} catch {
							log("idle timeout — completing anyway");
							this.sessionIdleWaiters.delete(sessionId);
						}
					}
					const sessionError = this.sessionErrors.get(sessionId);
					if (sessionError) {
						terminalState = controller.signal.aborted
							? "cancelled"
							: "failed";
						patch.error = controller.signal.aborted
							? "Job cancelled"
							: sessionError;
					} else if (!patch.outputText?.trim() && !current?.outputText?.trim()) {
						terminalState = controller.signal.aborted
							? "cancelled"
							: "failed";
						patch.error = controller.signal.aborted
							? "Job cancelled"
							: "OpenCode returned no response. Check provider credentials and model availability.";
					} else if (controller.signal.aborted) {
						terminalState = "cancelled";
						patch.error = "Job cancelled";
					} else {
						terminalState = "succeeded";
					}
					log(
						`job ${terminalState}, outputText length: ${patch.outputText?.length ?? current?.outputText?.length ?? 0}`,
					);
					break;
				}
			}
		} catch (error) {
			terminalState = controller.signal.aborted ? "cancelled" : "failed";
			patch.error = controller.signal.aborted
				? "Job cancelled"
				: normalizeErrorMessage(error);
			log(`job error: ${patch.error}`);
		} finally {
			if (job.sessionId) {
				this.sessionIdleWaiters.delete(job.sessionId);
				this.sessionErrors.delete(job.sessionId);
			}
		}

		const finalJob = this.store.markJobTerminal(job.id, terminalState, patch);
		this.emitJobEvent(job.id, { type: "done", jobId: job.id, job: finalJob });
	}

	private async resolveSession(
		client: ManagedOpencodeRuntime["client"],
		instance: ManagedInstance,
		job: DaemonJob,
	): Promise<string> {
		if (job.sessionId) return job.sessionId;
		const sessionRef = this.store.getSessionForJob(job.id);
		if (sessionRef.remoteSessionId) return sessionRef.remoteSessionId;

		const title = deriveSessionTitle(sessionRef, job);
		const permission = this.pendingPermissions.get(job.id) ?? [
			{ permission: "*", pattern: "*", action: "allow" },
		];
		this.pendingPermissions.delete(job.id);
		const session = await client.session.create({
			directory: instance.directory,
			title,
			permission,
		});
		this.store.assignRemoteSessionToJob(job.id, session.id, title);
		return session.id;
	}

	private async startInstance(instanceId: string): Promise<ManagedInstance> {
		const current = this.store.assertInstance(instanceId);
		if (this.registry.isRunning(instanceId)) {
			if (current.status !== "running") {
				return this.store.setInstanceStatus(instanceId, "running");
			}
			return current;
		}

		this.store.setInstanceStatus(instanceId, "starting");

		try {
			await this.registry.ensureStarted(instanceId, current.directory);
			return this.store.setInstanceStatus(instanceId, "running");
		} catch (error) {
			const message = normalizeErrorMessage(error);
			this.store.setInstanceStatus(instanceId, "error", message);
			throw new StoreError("instance_unavailable", message);
		}
	}

	private async abortRemoteSession(
		instanceId: string,
		sessionId: string,
	): Promise<void> {
		const runtime = this.registry.get(instanceId);
		const instance = this.store.getInstance(instanceId);
		if (!runtime || !instance) return;

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
			if (running.instanceId === instanceId) total += 1;
		}
		return total;
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
		socket.on("error", () => {});
		const rl = createInterface({ input: socket });
		socket.on("close", () => rl.close());

		const writeLine = (msg: unknown): boolean => {
			if (!socket.writable) return false;
			socket.write(`${JSON.stringify(msg)}\n`);
			return true;
		};

		rl.on("line", (line) => {
			if (!line.trim()) return;

			let parsed: unknown;
			try {
				parsed = JSON.parse(line) as unknown;
			} catch {
				writeLine({
					id: randomUUID(),
					method: "unknown",
					ok: false,
					error: { code: "invalid_json", message: "invalid json request" },
				} satisfies ErrorResponse);
				return;
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
				writeLine({
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
				} satisfies ErrorResponse);
				return;
			}

			if (request.data.method === "job.submit_and_stream") {
				void daemon.handleRequest(request.data).then((ack) => {
					if (!writeLine(ack)) return;
					if (!ack.ok) return;

					const jobId = (ack.result as SubmitResult).job.id;
					const unsub = daemon.subscribeJob(jobId, (event) => {
						if (socket.writable) {
							socket.write(`${JSON.stringify(event)}\n`);
						}
						if (event.type === "done" || event.type === "error") {
							socket.end();
						}
					});
					socket.on("close", unsub);
					daemon.scheduleDrain();
				});
				return;
			}

			if (request.data.method === "job.stream") {
				const { jobId } = request.data.params as { jobId: string };
				void daemon.handleRequest(request.data).then((ack) => {
					if (!writeLine(ack)) return;
					if (!ack.ok) return;

					const unsub = daemon.subscribeJob(jobId, (event) => {
						if (socket.writable) {
							socket.write(`${JSON.stringify(event)}\n`);
						}
						if (event.type === "done" || event.type === "error") {
							socket.end();
						}
					});
					socket.on("close", unsub);
				});
				return;
			}

			void daemon.handleRequest(request.data).then((response) => {
				writeLine(response);
			});
		});
	};
}

export async function runDaemonServer(): Promise<void> {
	const env = resolveDaemonRuntimeEnv();
	await mkdir(env.ralphHome, { recursive: true });
	await ensureSocketDir(env.socketPath);
	await clearStaleSocket(env.socketPath);

	const daemon = new Daemon(new StateStore(env.databasePath), {
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
