import { Database } from "bun:sqlite";

export const CURRENT_SCHEMA_VERSION = 1;

function getUserVersion(db: Database): number {
	const row = db.query("PRAGMA user_version").get() as {
		user_version: number;
	};
	return row?.user_version ?? 0;
}

function setUserVersion(db: Database, version: number): void {
	db.run(`PRAGMA user_version = ${version}`);
}

/**
 * Opens the daemon SQLite database, applies PRAGMAs, and runs migrations.
 */
export function openDaemonDatabase(databasePath: string): Database {
	const db = new Database(databasePath, { create: true });
	db.run("PRAGMA foreign_keys = ON;");
	db.run("PRAGMA journal_mode = WAL;");

	const from = getUserVersion(db);
	if (from === CURRENT_SCHEMA_VERSION) {
		return db;
	}

	if (from > CURRENT_SCHEMA_VERSION) {
		db.close();
		throw new Error(
			`daemon database schema v${from} is newer than supported v${CURRENT_SCHEMA_VERSION}`,
		);
	}

	db.transaction(() => {
		if (from < 1) {
			db.run(`
				CREATE TABLE instances (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					directory TEXT NOT NULL UNIQUE,
					status TEXT NOT NULL CHECK(status IN ('stopped','starting','running','error')),
					max_concurrency INTEGER NOT NULL CHECK(max_concurrency > 0),
					last_error TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);
			`);

			db.run(`
				CREATE TABLE sessions (
					id TEXT PRIMARY KEY,
					instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
					remote_session_id TEXT,
					kind TEXT NOT NULL CHECK(kind IN ('new','existing')),
					title TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);
			`);

			db.run(`
				CREATE UNIQUE INDEX idx_sessions_instance_remote
				ON sessions(instance_id, remote_session_id)
				WHERE remote_session_id IS NOT NULL;
			`);

			db.run(`
				CREATE TABLE jobs (
					id TEXT PRIMARY KEY,
					instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
					session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
					state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
					prompt TEXT NOT NULL,
					agent TEXT,
					model_provider_id TEXT,
					model_id TEXT,
					system_prompt TEXT,
					variant TEXT,
					message_id TEXT,
					error TEXT,
					output_text TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					started_at TEXT,
					ended_at TEXT
				);
			`);

			db.run(
				`CREATE INDEX idx_jobs_instance_created ON jobs(instance_id, created_at DESC);`,
			);
			db.run(`CREATE INDEX idx_jobs_state ON jobs(state, created_at DESC);`);
			db.run(
				`CREATE INDEX idx_sessions_instance ON sessions(instance_id, updated_at DESC);`,
			);

			setUserVersion(db, 1);
		}
	})();

	return db;
}
