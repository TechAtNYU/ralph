import { access } from "node:fs/promises";
import { connect } from "node:net";
import { createInterface } from "node:readline";

import {
	type JobStreamEvent,
	type ParamsByMethod,
	RequestMessage as RequestMessageSchema,
	type RequestMethod,
	type ResponseMessage,
	ResponseMessage as ResponseMessageSchema,
	type ResultByMethod,
	SOCKET_PATH,
} from "./protocol";

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
					finish(new Error(parsed.error.message));
					return;
				}

				// Stream-event envelopes don't carry a `result` field; they
				// only flow through streamJob, never the one-shot send() path.
				if (!("result" in parsed)) continue;

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
	 * arrive. The first line on the wire is the ack response; every
	 * subsequent line is a JobStreamEventMessage envelope wrapping a
	 * JobStreamEvent. The generator returns when a `done` or `error` event
	 * is received, or when the socket closes.
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

				const response = ResponseMessageSchema.safeParse(parsed);
				if (!response.success) {
					throw new Error("invalid daemon response");
				}

				const data = response.data;
				if (data.id !== request.id) continue;

				if (!data.ok) {
					throw new Error(data.error.message);
				}

				if (!acked) {
					// First success line is the stream ack — no event payload.
					acked = true;
					continue;
				}

				if (!("event" in data)) continue;
				yield data.event;
				if (data.event.type === "done" || data.event.type === "error") {
					return;
				}
			}
		} finally {
			rl.close();
			socket.destroy();
		}
	}
}

export const daemon = new DaemonClient();
