import { access } from "node:fs/promises";
import { connect } from "node:net";
import { createInterface } from "node:readline";

import {
	type JobStreamEvent,
	JobStreamEvent as JobStreamEventSchema,
	type ParamsByMethod,
	RequestMessage as RequestMessageSchema,
	type RequestMethod,
	type ResponseError,
	type ResponseMessage,
	ResponseMessage as ResponseMessageSchema,
	type ResultByMethod,
	SOCKET_PATH,
} from "./protocol";

export class DaemonError extends Error {
	constructor(
		message: string,
		public readonly code: ResponseError["code"],
	) {
		super(message);
		this.name = "DaemonError";
	}
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const HEALTHCHECK_TIMEOUT_MS = 500;

function send<M extends RequestMethod>(
	socketPath: string,
	method: M,
	params: ParamsByMethod<M>,
	timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const request = RequestMessageSchema.parse({
		id: Bun.randomUUIDv7(),
		method,
		params,
	});

	return new Promise<unknown>((resolve, reject) => {
		const socket = connect(socketPath);
		let buffer = "";
		let settled = false;
		const timeout = setTimeout(() => {
			finish(
				new Error(`daemon request timed out after ${timeoutMs}ms: ${method}`),
			);
		}, timeoutMs);

		const finish = (error?: Error, result?: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			socket.destroy();
			if (error) {
				reject(error);
				return;
			}
			if (result === undefined) {
				reject(new Error("daemon response missing result"));
				return;
			}
			resolve(result);
		};

		socket.setEncoding("utf8");

		socket.on("connect", () => {
			socket.write(`${JSON.stringify(request)}\n`);
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.trim()) {
					continue;
				}

				const parsed = parseResponse(line);
				if (parsed instanceof Error) {
					finish(parsed);
					return;
				}

				if (parsed.id !== request.id || parsed.method !== request.method) {
					continue;
				}

				if (!parsed.ok) {
					finish(new DaemonError(parsed.error.message, parsed.error.code));
					return;
				}

				finish(undefined, parsed.result);
				return;
			}
		});

		socket.on("error", (error) => {
			finish(error instanceof Error ? error : new Error(String(error)));
		});
	});
}

function parseResponse(raw: string): ResponseMessage | Error {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return new Error("invalid daemon response");
	}

	const response = ResponseMessageSchema.safeParse(parsed);
	if (!response.success) {
		return new Error("invalid daemon response");
	}
	return response.data;
}

export class DaemonClient {
	constructor(private readonly socketPath: string = SOCKET_PATH) {}

	async isDaemonRunning(): Promise<boolean> {
		try {
			await access(this.socketPath);
			const result = (await send(
				this.socketPath,
				"daemon.health",
				{},
				HEALTHCHECK_TIMEOUT_MS,
			)) as ResultByMethod<"daemon.health">;
			return Boolean(result.pid);
		} catch {
			return false;
		}
	}

	health() {
		return send(this.socketPath, "daemon.health", {}) as Promise<
			ResultByMethod<"daemon.health">
		>;
	}

	shutdown() {
		return send(this.socketPath, "daemon.shutdown", {}) as Promise<
			ResultByMethod<"daemon.shutdown">
		>;
	}

	createInstance(params: ParamsByMethod<"instance.create">) {
		return send(this.socketPath, "instance.create", params) as Promise<
			ResultByMethod<"instance.create">
		>;
	}

	listInstances() {
		return send(this.socketPath, "instance.list", {}) as Promise<
			ResultByMethod<"instance.list">
		>;
	}

	getInstance(instanceId: string) {
		return send(this.socketPath, "instance.get", { instanceId }) as Promise<
			ResultByMethod<"instance.get">
		>;
	}

	startInstance(instanceId: string) {
		return send(this.socketPath, "instance.start", { instanceId }) as Promise<
			ResultByMethod<"instance.start">
		>;
	}

	stopInstance(instanceId: string) {
		return send(this.socketPath, "instance.stop", { instanceId }) as Promise<
			ResultByMethod<"instance.stop">
		>;
	}

	removeInstance(instanceId: string) {
		return send(this.socketPath, "instance.remove", { instanceId }) as Promise<
			ResultByMethod<"instance.remove">
		>;
	}

	providerList(params: ParamsByMethod<"provider.list"> = {}) {
		return send(this.socketPath, "provider.list", params, 30_000) as Promise<
			ResultByMethod<"provider.list">
		>;
	}

	listSessions(instanceId: string) {
		return send(this.socketPath, "session.list", { instanceId }) as Promise<
			ResultByMethod<"session.list">
		>;
	}

	getSession(sessionId: string) {
		return send(this.socketPath, "session.get", { sessionId }) as Promise<
			ResultByMethod<"session.get">
		>;
	}

	submitJob(params: ParamsByMethod<"job.submit">) {
		return send(this.socketPath, "job.submit", params) as Promise<
			ResultByMethod<"job.submit">
		>;
	}

	listJobs(params: ParamsByMethod<"job.list"> = {}) {
		return send(this.socketPath, "job.list", params) as Promise<
			ResultByMethod<"job.list">
		>;
	}

	getJob(jobId: string) {
		return send(this.socketPath, "job.get", { jobId }) as Promise<
			ResultByMethod<"job.get">
		>;
	}

	cancelJob(jobId: string) {
		return send(this.socketPath, "job.cancel", { jobId }) as Promise<
			ResultByMethod<"job.cancel">
		>;
	}

	/**
	 * Open a stream over the daemon socket and yield job events as they
	 * arrive. The first line on the wire is the ack response (a normal
	 * ResponseMessage); every subsequent line is a bare JobStreamEvent.
	 * The generator returns when a `done` or `error` event is received,
	 * or when the socket closes.
	 */
	async *streamJob(jobId: string): AsyncGenerator<JobStreamEvent> {
		const request = RequestMessageSchema.parse({
			id: Bun.randomUUIDv7(),
			method: "job.stream",
			params: { jobId },
		});

		const socket = connect(this.socketPath);
		socket.setEncoding("utf8");
		socket.on("error", () => {});
		const rl = createInterface({ input: socket });

		try {
			socket.write(`${JSON.stringify(request)}\n`);

			let acked = false;
			for await (const line of rl) {
				if (!line.trim()) continue;

				let parsed: unknown;
				try {
					parsed = JSON.parse(line) as unknown;
				} catch {
					throw new Error("invalid daemon response");
				}

				// First line is the ack — validate it as a ResponseMessage.
				if (!acked) {
					const response = ResponseMessageSchema.safeParse(parsed);
					if (!response.success) {
						throw new Error("invalid daemon response");
					}
					if (!response.data.ok) {
						throw new Error(response.data.error.message);
					}
					acked = true;
					continue;
				}

				// Subsequent lines are bare JobStreamEvent objects.
				const event = JobStreamEventSchema.safeParse(parsed);
				if (!event.success) continue;
				yield event.data;
				if (event.data.type === "done" || event.data.type === "error") {
					return;
				}
			}
		} finally {
			rl.close();
			socket.destroy();
		}
	}

	sessionDiffs(params: ParamsByMethod<"session.diffs">) {
		return send(this.socketPath, "session.diffs", params) as Promise<
			ResultByMethod<"session.diffs">
		>;
	}
}

export const daemon = new DaemonClient();
