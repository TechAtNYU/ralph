export type RalphOptions = {
	mode?: "spawn" | "connect";
	baseUrl?: string;
	hostname?: string;
	port?: number;
	timeout?: number;
	config?: Record<string, unknown>;
	signal?: AbortSignal;
};
