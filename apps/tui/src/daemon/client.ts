import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { connect } from "node:net";

import type {
	CancelResult,
	GetResult,
	HealthResult,
	ListResult,
	RequestMessage,
	ResponseMessage,
	SubmitResult,
} from "./protocol";
import { SOCKET_PATH } from "./protocol";

function send<T>(
	socketPath: string,
	method: RequestMessage["method"],
	params?: Record<string, unknown>,
): Promise<T> {
	const request: RequestMessage = {
		id: randomUUID(),
		method,
		params,
	};

	return new Promise<T>((resolve, reject) => {
		const socket = connect(socketPath);
		let buffer = "";

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

				let response: ResponseMessage;
				try {
					response = JSON.parse(line) as ResponseMessage;
				} catch {
					reject(new Error("invalid daemon response"));
					socket.destroy();
					return;
				}

				if (response.id !== request.id) {
					continue;
				}

				if (!response.ok) {
					reject(new Error(response.error ?? "daemon request failed"));
				} else {
					resolve(response.result as T);
				}
				socket.end();
			}
		});

		socket.on("error", (error) => {
			reject(error);
		});
	});
}

export class DaemonClient {
	constructor(private readonly socketPath: string = SOCKET_PATH) {}

	async isDaemonRunning(): Promise<boolean> {
		try {
			await access(this.socketPath);
			const result = await send<HealthResult>(this.socketPath, "health");
			return Boolean(result.pid);
		} catch {
			return false;
		}
	}

	async health(): Promise<HealthResult> {
		return send<HealthResult>(this.socketPath, "health");
	}

	async submit(prompt: string): Promise<SubmitResult> {
		return send<SubmitResult>(this.socketPath, "submit", { prompt });
	}

	async listJobs(): Promise<ListResult> {
		return send<ListResult>(this.socketPath, "list");
	}

	async getJob(jobId: string): Promise<GetResult> {
		return send<GetResult>(this.socketPath, "get", { jobId });
	}

	async cancelJob(jobId: string): Promise<CancelResult> {
		return send<CancelResult>(this.socketPath, "cancel", { jobId });
	}
}

// Default client using the standard socket path — convenience for production callers.
const defaultClient = new DaemonClient();

export const isDaemonRunning = () => defaultClient.isDaemonRunning();
export const health = () => defaultClient.health();
export const submit = (prompt: string) => defaultClient.submit(prompt);
export const listJobs = () => defaultClient.listJobs();
export const getJob = (jobId: string) => defaultClient.getJob(jobId);
export const cancelJob = (jobId: string) => defaultClient.cancelJob(jobId);
