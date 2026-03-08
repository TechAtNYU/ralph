import { homedir } from "node:os";

export const SOCKET_PATH = `${homedir()}/.ralph/ralphd.sock`;

export type JobState =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

export interface LoopJob {
	id: string;
	prompt: string;
	state: JobState;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	endedAt?: string;
	error?: string;
	output?: string;
}

export interface DaemonState {
	jobs: LoopJob[];
}

export interface RequestMessage {
	id: string;
	method: "health" | "submit" | "list" | "get" | "cancel";
	params?: Record<string, unknown>;
}

export interface ResponseMessage {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export interface HealthResult {
	pid: number;
	uptimeSeconds: number;
	queued: number;
	running: number;
	finished: number;
}

export interface SubmitResult {
	job: LoopJob;
}

export interface ListResult {
	jobs: LoopJob[];
}

export interface GetResult {
	job: LoopJob;
}

export interface CancelResult {
	job: LoopJob;
}
