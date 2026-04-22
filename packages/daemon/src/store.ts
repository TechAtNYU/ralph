import type { Database, Statement } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

import { openDaemonDatabase } from "./db";
import type {
	DaemonJob,
	InstanceHealth,
	JobSession,
	JobState,
	JobTask,
	ManagedInstance,
	ResponseError,
} from "./protocol";

type ErrorCode = z.infer<typeof ResponseError>["code"];

export class StoreError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
	) {
		super(message);
		this.name = "StoreError";
	}
}

interface InstanceRow {
	id: string;
	name: string;
	directory: string;
	status: ManagedInstance["status"];
	max_concurrency: number;
	last_error: string | null;
	created_at: string;
	updated_at: string;
}

interface JobRow {
	id: string;
	instance_id: string;
	state: JobState;
	prompt: string;
	agent: string | null;
	model_provider_id: string | null;
	model_id: string | null;
	system_prompt: string | null;
	variant: string | null;
	message_id: string | null;
	error: string | null;
	output_text: string | null;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	ended_at: string | null;
	remote_session_id: string | null;
}

function rowToInstance(row: InstanceRow): ManagedInstance {
	const base: ManagedInstance = {
		id: row.id,
		name: row.name,
		directory: row.directory,
		status: row.status,
		maxConcurrency: row.max_concurrency,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	return row.last_error ? { ...base, lastError: row.last_error } : base;
}

function rowToJob(row: JobRow): DaemonJob {
	const task: JobTask = {
		type: "prompt",
		prompt: row.prompt,
		...(row.agent ? { agent: row.agent } : {}),
		...(row.model_provider_id && row.model_id
			? {
					model: {
						providerId: row.model_provider_id,
						modelId: row.model_id,
					},
				}
			: {}),
		...(row.system_prompt ? { system: row.system_prompt } : {}),
		...(row.variant ? { variant: row.variant } : {}),
	};

	return {
		id: row.id,
		instanceId: row.instance_id,
		task,
		state: row.state,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...(row.remote_session_id ? { sessionId: row.remote_session_id } : {}),
		...(row.started_at ? { startedAt: row.started_at } : {}),
		...(row.ended_at ? { endedAt: row.ended_at } : {}),
		...(row.error ? { error: row.error } : {}),
		...(row.output_text !== null ? { outputText: row.output_text } : {}),
		...(row.message_id ? { messageId: row.message_id } : {}),
	};
}

const JOB_SELECT = `
	SELECT j.id, j.instance_id, j.state, j.prompt, j.agent,
	       j.model_provider_id, j.model_id, j.system_prompt, j.variant,
	       j.message_id, j.error, j.output_text,
	       j.created_at, j.updated_at, j.started_at, j.ended_at,
	       s.remote_session_id AS remote_session_id
	FROM jobs j
	JOIN sessions s ON j.session_id = s.id
`;

/**
 * Relational repository for daemon state: instances, sessions, and jobs.
 *
 * All queries hit SQLite via `bun:sqlite` and are synchronous once the store
 * is open. Multi-statement mutations run inside a transaction so concurrent
 * readers never observe torn state.
 */
export class StateStore {
	private db: Database | undefined;
	private directoryReady: Promise<void> | undefined;

	// Prepared statements, initialized lazily on first open().
	private stmts:
		| {
				listInstances: Statement<InstanceRow>;
				getInstance: Statement<InstanceRow, [string]>;
				insertInstance: Statement;
				setInstanceStatus: Statement;
				deleteInstance: Statement;
				countInstanceActiveJobs: Statement<{ c: number }, [string]>;

				insertSession: Statement;
				findSessionByRemote: Statement<
					{ id: string; remote_session_id: string | null },
					[string, string]
				>;
				assignRemoteSessionToJob: Statement;

				listAllJobs: Statement<JobRow>;
				listJobsByInstance: Statement<JobRow, [string]>;
				listJobsByState: Statement<JobRow, [JobState]>;
				listJobsByInstanceAndState: Statement<JobRow, [string, JobState]>;
				getJob: Statement<JobRow, [string]>;
				insertJob: Statement;
				setJobState: Statement;
				setJobTerminal: Statement;
				appendJobOutput: Statement;
				setJobMessageId: Statement;
				deleteOldTerminalJobs: Statement;

				countJobsByState: Statement<{ c: number }, [JobState]>;
				countInstanceJobsByState: Statement<{ c: number }, [string, JobState]>;
				countInstanceFinishedJobs: Statement<{ c: number }, [string]>;
				resetInstancesToStopped: Statement;
				requeueRunningJobs: Statement<
					{ id: string; instance_id: string },
					[string]
				>;
		  }
		| undefined;

	constructor(private readonly databasePath: string) {}

	async open(): Promise<void> {
		if (!this.directoryReady) {
			this.directoryReady = mkdir(dirname(this.databasePath), {
				recursive: true,
			}).then(() => undefined);
		}
		await this.directoryReady;
		if (this.db) return;

		const db = openDaemonDatabase(this.databasePath);
		this.db = db;
		this.stmts = {
			listInstances: db.query<InstanceRow, []>(
				`SELECT * FROM instances ORDER BY datetime(created_at) DESC`,
			),
			getInstance: db.query<InstanceRow, [string]>(
				`SELECT * FROM instances WHERE id = ?`,
			),
			insertInstance: db.query(
				`INSERT INTO instances (id, name, directory, status, max_concurrency, last_error, created_at, updated_at)
				 VALUES ($id, $name, $directory, $status, $max_concurrency, $last_error, $created_at, $updated_at)`,
			),
			setInstanceStatus: db.query(
				`UPDATE instances
				 SET status = $status, last_error = $last_error, updated_at = $updated_at
				 WHERE id = $id`,
			),
			deleteInstance: db.query(`DELETE FROM instances WHERE id = ?`),
			countInstanceActiveJobs: db.query<{ c: number }, [string]>(
				`SELECT COUNT(*) AS c FROM jobs
				 WHERE instance_id = ? AND state IN ('queued','running')`,
			),

			insertSession: db.query(
				`INSERT INTO sessions (id, instance_id, remote_session_id, kind, title, created_at, updated_at)
				 VALUES ($id, $instance_id, $remote_session_id, $kind, $title, $created_at, $updated_at)`,
			),
			findSessionByRemote: db.query<
				{ id: string; remote_session_id: string | null },
				[string, string]
			>(
				`SELECT id, remote_session_id FROM sessions
				 WHERE instance_id = ? AND remote_session_id = ?`,
			),
			assignRemoteSessionToJob: db.query(
				`UPDATE sessions
				 SET remote_session_id = $remote_session_id, updated_at = $updated_at
				 WHERE id = (SELECT session_id FROM jobs WHERE id = $job_id)`,
			),

			listAllJobs: db.query<JobRow, []>(
				`${JOB_SELECT} ORDER BY datetime(j.created_at) DESC`,
			),
			listJobsByInstance: db.query<JobRow, [string]>(
				`${JOB_SELECT} WHERE j.instance_id = ? ORDER BY datetime(j.created_at) DESC`,
			),
			listJobsByState: db.query<JobRow, [JobState]>(
				`${JOB_SELECT} WHERE j.state = ? ORDER BY datetime(j.created_at) DESC`,
			),
			listJobsByInstanceAndState: db.query<JobRow, [string, JobState]>(
				`${JOB_SELECT} WHERE j.instance_id = ? AND j.state = ? ORDER BY datetime(j.created_at) DESC`,
			),
			getJob: db.query<JobRow, [string]>(`${JOB_SELECT} WHERE j.id = ?`),
			insertJob: db.query(
				`INSERT INTO jobs (id, instance_id, session_id, state, prompt, agent,
				  model_provider_id, model_id, system_prompt, variant,
				  message_id, error, output_text, created_at, updated_at,
				  started_at, ended_at)
				 VALUES ($id, $instance_id, $session_id, $state, $prompt, $agent,
				  $model_provider_id, $model_id, $system_prompt, $variant,
				  $message_id, $error, $output_text, $created_at, $updated_at,
				  $started_at, $ended_at)`,
			),
			setJobState: db.query(
				`UPDATE jobs SET state = $state, updated_at = $updated_at,
				   started_at = COALESCE($started_at, started_at)
				 WHERE id = $id`,
			),
			setJobTerminal: db.query(
				`UPDATE jobs SET
				   state = $state,
				   error = $error,
				   output_text = COALESCE($output_text, output_text),
				   message_id = COALESCE($message_id, message_id),
				   updated_at = $updated_at,
				   ended_at = $ended_at
				 WHERE id = $id`,
			),
			appendJobOutput: db.query(
				`UPDATE jobs SET
				   output_text = COALESCE(output_text, '') || $delta,
				   updated_at = $updated_at
				 WHERE id = $id`,
			),
			setJobMessageId: db.query(
				`UPDATE jobs SET message_id = $message_id, updated_at = $updated_at WHERE id = $id`,
			),
			deleteOldTerminalJobs: db.query(
				`DELETE FROM jobs WHERE id IN (
				   SELECT id FROM jobs
				   WHERE state IN ('succeeded','failed','cancelled')
				   ORDER BY datetime(created_at) DESC
				   LIMIT -1 OFFSET ?
				 )`,
			),

			countJobsByState: db.query<{ c: number }, [JobState]>(
				`SELECT COUNT(*) AS c FROM jobs WHERE state = ?`,
			),
			countInstanceJobsByState: db.query<{ c: number }, [string, JobState]>(
				`SELECT COUNT(*) AS c FROM jobs WHERE instance_id = ? AND state = ?`,
			),
			countInstanceFinishedJobs: db.query<{ c: number }, [string]>(
				`SELECT COUNT(*) AS c FROM jobs
				 WHERE instance_id = ? AND state IN ('succeeded','failed','cancelled')`,
			),
			resetInstancesToStopped: db.query(
				`UPDATE instances SET status = 'stopped', updated_at = $updated_at
				 WHERE status IN ('starting','running','error')`,
			),
			requeueRunningJobs: db.query<
				{ id: string; instance_id: string },
				[string]
			>(
				`UPDATE jobs SET
				   state = 'queued',
				   error = CASE
				     WHEN error IS NULL OR error = '' THEN 'Recovered after daemon restart'
				     ELSE error || ' Recovered after daemon restart'
				   END,
				   updated_at = ?
				 WHERE state = 'running'
				 RETURNING id, instance_id`,
			),
		};
	}

	close(): void {
		this.db?.close();
		this.db = undefined;
		this.stmts = undefined;
	}

	private s(): NonNullable<StateStore["stmts"]> {
		if (!this.stmts) {
			throw new Error("StateStore is not open; call open() first");
		}
		return this.stmts;
	}

	// --------------------------------------------------------------------
	// Instances
	// --------------------------------------------------------------------

	listInstances(): ManagedInstance[] {
		return this.s().listInstances.all().map(rowToInstance);
	}

	getInstance(id: string): ManagedInstance | undefined {
		const row = this.s().getInstance.get(id);
		return row ? rowToInstance(row) : undefined;
	}

	assertInstance(id: string): ManagedInstance {
		const instance = this.getInstance(id);
		if (!instance) {
			throw new StoreError("not_found", `instance ${id} not found`);
		}
		return instance;
	}

	createInstance(input: {
		name: string;
		directory: string;
		maxConcurrency: number;
	}): ManagedInstance {
		const now = new Date().toISOString();
		const instance: ManagedInstance = {
			id: randomUUID(),
			name: input.name,
			directory: input.directory,
			status: "stopped",
			maxConcurrency: input.maxConcurrency,
			createdAt: now,
			updatedAt: now,
		};
		try {
			this.s().insertInstance.run({
				$id: instance.id,
				$name: instance.name,
				$directory: instance.directory,
				$status: instance.status,
				$max_concurrency: instance.maxConcurrency,
				$last_error: null,
				$created_at: instance.createdAt,
				$updated_at: instance.updatedAt,
			});
		} catch (err) {
			if (isUniqueConstraint(err)) {
				throw new StoreError(
					"conflict",
					`instance already exists for directory ${instance.directory}`,
				);
			}
			throw err;
		}
		return instance;
	}

	setInstanceStatus(
		id: string,
		status: ManagedInstance["status"],
		lastError?: string,
	): ManagedInstance {
		this.s().setInstanceStatus.run({
			$id: id,
			$status: status,
			$last_error: lastError ?? null,
			$updated_at: new Date().toISOString(),
		});
		return this.assertInstance(id);
	}

	removeInstance(id: string): void {
		this.s().deleteInstance.run(id);
	}

	hasActiveJobs(instanceId: string): boolean {
		const row = this.s().countInstanceActiveJobs.get(instanceId);
		return (row?.c ?? 0) > 0;
	}

	// --------------------------------------------------------------------
	// Sessions (internal; jobs own the reference to a session row)
	// --------------------------------------------------------------------

	/**
	 * Find-or-create a `sessions` row for an incoming submit request.
	 *
	 * - `{type: 'new', title?}`: always inserts a fresh session row with
	 *   `remote_session_id = NULL`.
	 * - `{type: 'existing', sessionId}`: returns the existing session row for
	 *   the given remote id, or inserts one if this is the first time we see it.
	 */
	upsertSessionForSubmit(
		instanceId: string,
		session: JobSession,
	): { id: string; remoteSessionId: string | null } {
		const now = new Date().toISOString();
		if (session.type === "existing") {
			const existing = this.s().findSessionByRemote.get(
				instanceId,
				session.sessionId,
			);
			if (existing) {
				return {
					id: existing.id,
					remoteSessionId: existing.remote_session_id,
				};
			}
			const id = randomUUID();
			this.s().insertSession.run({
				$id: id,
				$instance_id: instanceId,
				$remote_session_id: session.sessionId,
				$kind: "existing",
				$title: null,
				$created_at: now,
				$updated_at: now,
			});
			return { id, remoteSessionId: session.sessionId };
		}

		const id = randomUUID();
		this.s().insertSession.run({
			$id: id,
			$instance_id: instanceId,
			$remote_session_id: null,
			$kind: "new",
			$title: session.title ?? null,
			$created_at: now,
			$updated_at: now,
		});
		return { id, remoteSessionId: null };
	}

	/**
	 * Attach a remote OpenCode session id to the session row that backs
	 * the given job. Used once a new session has been created on the
	 * remote runtime during job execution.
	 */
	assignRemoteSessionToJob(jobId: string, remoteSessionId: string): void {
		this.s().assignRemoteSessionToJob.run({
			$job_id: jobId,
			$remote_session_id: remoteSessionId,
			$updated_at: new Date().toISOString(),
		});
	}

	// --------------------------------------------------------------------
	// Jobs
	// --------------------------------------------------------------------

	listJobs(
		filter: { instanceId?: string; state?: JobState } = {},
	): DaemonJob[] {
		const { instanceId, state } = filter;
		let rows: JobRow[];
		if (instanceId && state) {
			rows = this.s().listJobsByInstanceAndState.all(instanceId, state);
		} else if (instanceId) {
			rows = this.s().listJobsByInstance.all(instanceId);
		} else if (state) {
			rows = this.s().listJobsByState.all(state);
		} else {
			rows = this.s().listAllJobs.all();
		}
		return rows.map(rowToJob);
	}

	getJob(id: string): DaemonJob | undefined {
		const row = this.s().getJob.get(id);
		return row ? rowToJob(row) : undefined;
	}

	assertJob(id: string): DaemonJob {
		const job = this.getJob(id);
		if (!job) {
			throw new StoreError("not_found", `job ${id} not found`);
		}
		return job;
	}

	/**
	 * Create a new job along with its backing session row, atomically.
	 */
	createJob(input: {
		instanceId: string;
		session: JobSession;
		task: JobTask;
	}): DaemonJob {
		const now = new Date().toISOString();
		const jobId = randomUUID();

		this.db?.transaction(() => {
			const { id: sessionRowId } = this.upsertSessionForSubmit(
				input.instanceId,
				input.session,
			);
			this.s().insertJob.run({
				$id: jobId,
				$instance_id: input.instanceId,
				$session_id: sessionRowId,
				$state: "queued",
				$prompt: input.task.prompt,
				$agent: input.task.agent ?? null,
				$model_provider_id: input.task.model?.providerId ?? null,
				$model_id: input.task.model?.modelId ?? null,
				$system_prompt: input.task.system ?? null,
				$variant: input.task.variant ?? null,
				$message_id: null,
				$error: null,
				$output_text: null,
				$created_at: now,
				$updated_at: now,
				$started_at: null,
				$ended_at: null,
			});
		})();

		return this.assertJob(jobId);
	}

	markJobRunning(id: string): DaemonJob {
		const now = new Date().toISOString();
		this.s().setJobState.run({
			$id: id,
			$state: "running",
			$updated_at: now,
			$started_at: now,
		});
		return this.assertJob(id);
	}

	markJobTerminal(
		id: string,
		state: Extract<JobState, "succeeded" | "failed" | "cancelled">,
		patch: {
			error?: string;
			outputText?: string;
			messageId?: string;
		} = {},
	): DaemonJob {
		const now = new Date().toISOString();
		this.s().setJobTerminal.run({
			$id: id,
			$state: state,
			$error: patch.error ?? null,
			$output_text: patch.outputText ?? null,
			$message_id: patch.messageId ?? null,
			$updated_at: now,
			$ended_at: now,
		});
		return this.assertJob(id);
	}

	appendJobOutput(id: string, delta: string): void {
		this.s().appendJobOutput.run({
			$id: id,
			$delta: delta,
			$updated_at: new Date().toISOString(),
		});
	}

	setJobMessageId(id: string, messageId: string): void {
		this.s().setJobMessageId.run({
			$id: id,
			$message_id: messageId,
			$updated_at: new Date().toISOString(),
		});
	}

	// --------------------------------------------------------------------
	// Recovery + aggregates
	// --------------------------------------------------------------------

	/**
	 * Reset crash-surviving instance/job state on daemon startup and return
	 * the ids of jobs that should be re-queued for scheduling.
	 */
	recoverForBootstrap(): Array<{ id: string; instanceId: string }> {
		const now = new Date().toISOString();
		let requeued: Array<{ id: string; instance_id: string }> = [];
		this.db?.transaction(() => {
			this.s().resetInstancesToStopped.run({ $updated_at: now });
			requeued = this.s().requeueRunningJobs.all(now);
		})();
		return requeued.map((r) => ({ id: r.id, instanceId: r.instance_id }));
	}

	/**
	 * Keep at most `max` terminal jobs (succeeded/failed/cancelled),
	 * deleting the oldest excess rows.
	 */
	pruneTerminalJobs(max: number): void {
		this.s().deleteOldTerminalJobs.run(max);
	}

	countJobsByState(state: JobState): number {
		return this.s().countJobsByState.get(state)?.c ?? 0;
	}

	countFinishedJobs(): number {
		return (
			this.countJobsByState("succeeded") +
			this.countJobsByState("failed") +
			this.countJobsByState("cancelled")
		);
	}

	instanceHealth(): InstanceHealth[] {
		return this.listInstances().map((instance) => ({
			instanceId: instance.id,
			name: instance.name,
			status: instance.status,
			running:
				this.s().countInstanceJobsByState.get(instance.id, "running")?.c ?? 0,
			queued:
				this.s().countInstanceJobsByState.get(instance.id, "queued")?.c ?? 0,
			finished: this.s().countInstanceFinishedJobs.get(instance.id)?.c ?? 0,
			...(instance.lastError ? { lastError: instance.lastError } : {}),
		}));
	}
}

function isUniqueConstraint(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const code = (err as { code?: string }).code;
	return (
		code === "SQLITE_CONSTRAINT_UNIQUE" ||
		/UNIQUE constraint failed/i.test(err.message)
	);
}
