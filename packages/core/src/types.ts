export type RalphResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: RalphError };

export type RalphError = {
	code: string;
	message: string;
	status: number;
	details?: unknown;
};

export type RalphOptions = {
	/** Mode: "spawn" starts a new OpenCode server, "connect" connects to existing */
	mode?: "spawn" | "connect";
	/** Base URL when connecting to an existing OpenCode server */
	baseUrl?: string;
	/** Hostname for spawned OpenCode server */
	hostname?: string;
	/** Port for spawned OpenCode server */
	port?: number;
	/** Startup timeout in ms for spawned server */
	timeout?: number;
	/** OpenCode config overrides (passed via OPENCODE_CONFIG_CONTENT) */
	config?: Record<string, unknown>;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
};

export type ServerOptions = RalphOptions & {
	/** Port for the Ralph HTTP server (default: 3000) */
	httpPort?: number;
};
