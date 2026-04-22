import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DaemonJob, ManagedInstance } from "@techatnyu/ralphd";
import { resolveDaemonPaths } from "@techatnyu/ralphd";

const SPEC_FILENAME = "SPEC.md";
const PRD_FILENAME = "prd.json";
const SPEC_READ_LIMIT_BYTES = 4096;

export interface SessionProgress {
	total: number;
	completed: number;
}

export interface SessionSummary {
	instanceId: string;
	sessionId: string;
	directory: string;
	title: string;
	progress: SessionProgress;
}

export interface SessionProgressAdapter {
	read(sessionDir: string): Promise<SessionProgress>;
}

interface PrdTask {
	done?: unknown;
	status?: unknown;
}

interface PrdShape {
	tasks?: PrdTask[];
}

function isDoneTask(task: PrdTask): boolean {
	return task.done === true || task.status === "done";
}

export const prdJsonProgressAdapter: SessionProgressAdapter = {
	async read(sessionDir: string): Promise<SessionProgress> {
		try {
			const raw = await readFile(join(sessionDir, PRD_FILENAME), "utf8");
			const parsed = JSON.parse(raw) as PrdShape;
			if (!parsed || !Array.isArray(parsed.tasks)) {
				return { total: 0, completed: 0 };
			}
			const total = parsed.tasks.length;
			let completed = 0;
			for (const task of parsed.tasks) {
				if (task && typeof task === "object" && isDoneTask(task)) {
					completed++;
				}
			}
			return { total, completed };
		} catch {
			return { total: 0, completed: 0 };
		}
	},
};

async function readSpecTitle(
	sessionDir: string,
	fallback: string,
): Promise<string> {
	try {
		const handle = await readFile(join(sessionDir, SPEC_FILENAME), "utf8");
		const head = handle.slice(0, SPEC_READ_LIMIT_BYTES);
		const match = head.match(/^#\s+(.+)$/m);
		const captured = match?.[1];
		if (captured) {
			const title = captured.trim();
			if (title.length > 0) {
				return title;
			}
		}
		return fallback;
	} catch {
		return fallback;
	}
}

export interface ListSessionsOptions {
	ralphHome?: string;
	progressAdapter?: SessionProgressAdapter;
}

export async function listSessions(
	instanceId: string,
	opts: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
	const ralphHome = opts.ralphHome ?? resolveDaemonPaths(process.env).ralphHome;
	const adapter = opts.progressAdapter ?? prdJsonProgressAdapter;
	const instanceDir = join(ralphHome, "sessions", instanceId);

	let entries: Dirent[];
	try {
		entries = (await readdir(instanceDir, { withFileTypes: true })) as Dirent[];
	} catch {
		return [];
	}

	const sessionIds = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	return Promise.all(
		sessionIds.map(async (sessionId) => {
			const directory = join(instanceDir, sessionId);
			const [title, progress] = await Promise.all([
				readSpecTitle(directory, sessionId),
				adapter.read(directory),
			]);
			return { instanceId, sessionId, directory, title, progress };
		}),
	);
}

export type Row =
	| { kind: "instance"; instance: ManagedInstance }
	| { kind: "session"; instance: ManagedInstance; session: SessionSummary };

export function flattenRows(
	instances: ManagedInstance[],
	expanded: Set<string>,
	sessionsByInstance: Record<string, SessionSummary[]>,
): Row[] {
	const rows: Row[] = [];
	for (const instance of instances) {
		rows.push({ kind: "instance", instance });
		if (!expanded.has(instance.id)) continue;
		const sessions = sessionsByInstance[instance.id];
		if (!sessions) continue;
		for (const session of sessions) {
			rows.push({ kind: "session", instance, session });
		}
	}
	return rows;
}

/**
 * Filter daemon jobs to those belonging to the given Ralph session.
 *
 * Current behaviour: returns `[]`. Daemon jobs carry an OpenCode chat session id
 * (`job.sessionId`), not a Ralph session id, and no mapping is persisted yet.
 * When that mapping lands (either a file inside the session directory or a
 * `ralphSessionId` field on jobs), update this function in-place.
 */
export function filterJobsForSession(
	_jobs: DaemonJob[],
	_session: SessionSummary,
): DaemonJob[] {
	return [];
}
