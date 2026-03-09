import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
	CancelResult,
	DaemonState,
	GetResult,
	HealthResult,
	ListResult,
	LoopJob,
	RequestMessage,
	ResponseMessage,
	ShutdownResult,
	SubmitResult,
} from "./protocol";
import { SOCKET_PATH } from "./protocol";
import { StateStore } from "./store";

const RALPH_HOME = join(homedir(), ".ralph");
const STATE_PATH = join(RALPH_HOME, "state.json");
const CONCURRENCY = Number.parseInt(
	process.env.RALPHD_MAX_CONCURRENCY ?? "1",
	10,
);

export class Daemon {
	private state: DaemonState = { jobs: [] };
	private readonly queue: string[] = [];
	private readonly running = new Map<string, AbortController>();
	private startedAt = Date.now();
	private onShutdown: (() => void) | undefined;

	constructor(private readonly store: StateStore) {}

	setShutdownHandler(handler: () => void): void {
		this.onShutdown = handler;
	}

	async bootstrap(): Promise<void> {
		this.state = await this.store.load();
		for (const job of this.state.jobs) {
			if (job.state === "running") {
				job.state = "queued";
				job.updatedAt = new Date().toISOString();
				job.error = "Recovered after daemon restart";
			}
			if (job.state === "queued") {
				this.queue.push(job.id);
			}
		}
		await this.store.save(this.state);
		this.drainQueue();
	}

	handleRequest = async (raw: RequestMessage): Promise<ResponseMessage> => {
		try {
			switch (raw.method) {
				case "health": {
					const result: HealthResult = {
						pid: process.pid,
						uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
						queued: this.state.jobs.filter((job) => job.state === "queued")
							.length,
						running: this.state.jobs.filter((job) => job.state === "running")
							.length,
						finished: this.state.jobs.filter(
							(job) =>
								job.state === "succeeded" ||
								job.state === "failed" ||
								job.state === "cancelled",
						).length,
					};
					return { id: raw.id, ok: true, result };
				}
				case "submit": {
					const prompt = String(raw.params?.prompt ?? "").trim();
					if (!prompt) {
						return { id: raw.id, ok: false, error: "prompt is required" };
					}

					const now = new Date().toISOString();
					const job: LoopJob = {
						id: randomUUID(),
						prompt,
						state: "queued",
						createdAt: now,
						updatedAt: now,
					};

					this.state = this.store.upsertJob(this.state, job);
					this.queue.push(job.id);
					await this.store.save(this.state);
					this.drainQueue();

					const result: SubmitResult = { job };
					return { id: raw.id, ok: true, result };
				}
				case "list": {
					const result: ListResult = {
						jobs: this.state.jobs,
					};
					return { id: raw.id, ok: true, result };
				}
				case "get": {
					const jobId = String(raw.params?.jobId ?? "");
					const job = this.store.getJob(this.state, jobId);
					if (!job) {
						return { id: raw.id, ok: false, error: `job ${jobId} not found` };
					}

					const result: GetResult = { job };
					return { id: raw.id, ok: true, result };
				}
				case "cancel": {
					const jobId = String(raw.params?.jobId ?? "");
					const job = this.store.getJob(this.state, jobId);
					if (!job) {
						return { id: raw.id, ok: false, error: `job ${jobId} not found` };
					}

					if (job.state === "queued") {
						job.state = "cancelled";
						job.endedAt = new Date().toISOString();
						job.updatedAt = job.endedAt;
						const index = this.queue.findIndex((item) => item === job.id);
						if (index >= 0) {
							this.queue.splice(index, 1);
						}
						this.state = this.store.upsertJob(this.state, job);
						await this.store.save(this.state);
					}

					this.running.get(job.id)?.abort();

					const result: CancelResult = { job };
					return { id: raw.id, ok: true, result };
				}
				case "shutdown": {
					const result: ShutdownResult = { ok: true };
					// Respond before shutting down so the client gets a reply
					setTimeout(() => this.onShutdown?.(), 50);
					return { id: raw.id, ok: true, result };
				}
				default:
					return {
						id: raw.id,
						ok: false,
						error: `unsupported method: ${raw.method}`,
					};
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "unknown daemon error";
			return { id: raw.id, ok: false, error: message };
		}
	};

	private async drainQueue(): Promise<void> {
		while (this.running.size < CONCURRENCY && this.queue.length > 0) {
			const jobId = this.queue.shift();
			if (!jobId) {
				break;
			}

			const job = this.store.getJob(this.state, jobId);
			if (!job || job.state !== "queued") {
				continue;
			}

			const signal = new AbortController();
			this.running.set(job.id, signal);

			job.state = "running";
			job.startedAt = new Date().toISOString();
			job.updatedAt = job.startedAt;
			this.state = this.store.upsertJob(this.state, job);
			await this.store.save(this.state);

			void this.executeJob(job, signal)
				.catch(() => {
					// Error details are persisted in executeJob.
				})
				.finally(async () => {
					this.running.delete(job.id);
					await this.store.save(this.state);
					await this.drainQueue();
				});
		}
	}

	private async executeJob(
		job: LoopJob,
		controller: AbortController,
	): Promise<void> {
		try {
			await this.simulateRalphLoop(job.prompt, controller.signal);
			if (controller.signal.aborted) {
				job.state = "cancelled";
				job.error = "Job cancelled";
			} else {
				job.state = "succeeded";
				job.output = `Loop finished for prompt: ${job.prompt}`;
				job.error = undefined;
			}
		} catch (error) {
			if (controller.signal.aborted) {
				job.state = "cancelled";
				job.error = "Job cancelled";
			} else {
				job.state = "failed";
				job.error =
					error instanceof Error ? error.message : "Unknown loop error";
			}
		} finally {
			job.endedAt = new Date().toISOString();
			job.updatedAt = job.endedAt;
			this.state = this.store.upsertJob(this.state, job);
		}
	}

	private async simulateRalphLoop(
		prompt: string,
		signal: AbortSignal,
	): Promise<void> {
		const duration = Math.min(20000, Math.max(4000, prompt.length * 100));
		const step = 500;
		let elapsed = 0;
		while (elapsed < duration) {
			if (signal.aborted) {
				throw new Error("aborted");
			}
			await Bun.sleep(step);
			elapsed += step;
		}
	}
}

export async function ensureSocketDir(): Promise<void> {
	await mkdir(dirname(SOCKET_PATH), { recursive: true });
}

export async function clearStaleSocket(): Promise<void> {
	try {
		await access(SOCKET_PATH);
		await rm(SOCKET_PATH);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
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

				let message: RequestMessage;
				try {
					message = JSON.parse(line) as RequestMessage;
				} catch {
					const response: ResponseMessage = {
						id: randomUUID(),
						ok: false,
						error: "invalid json request",
					};
					socket.write(`${JSON.stringify(response)}\n`);
					continue;
				}

				void daemon.handleRequest(message).then((response) => {
					socket.write(`${JSON.stringify(response)}\n`);
				});
			}
		});
	};
}

export async function runDaemonServer(): Promise<void> {
	await mkdir(RALPH_HOME, { recursive: true });
	await ensureSocketDir();
	await clearStaleSocket();

	const daemon = new Daemon(new StateStore(STATE_PATH));
	await daemon.bootstrap();

	const server = createServer(createConnectionHandler(daemon));
	server.listen(SOCKET_PATH, async () => {
		await chmod(SOCKET_PATH, 0o600);
		process.stdout.write(`ralphd listening on ${SOCKET_PATH}\n`);
	});

	const shutdown = async () => {
		server.close();
		await rm(SOCKET_PATH, { force: true });
		process.exit(0);
	};

	daemon.setShutdownHandler(() => void shutdown());
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

if (import.meta.main) {
	void runDaemonServer();
}
