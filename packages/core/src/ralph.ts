import {
	createOpencode,
	createOpencodeClient,
	type OpencodeClient,
} from "@opencode-ai/sdk/v2";
import type { RalphOptions } from "./types.js";

export class RalphCore {
	private constructor(
		private _client: OpencodeClient,
		private serverClose?: () => void,
	) {}

	get client(): OpencodeClient {
		return this._client;
	}

	static async create(options?: RalphOptions): Promise<RalphCore> {
		const mode = options?.mode ?? "spawn";

		if (mode === "connect") {
			const baseUrl = options?.baseUrl;
			if (!baseUrl) {
				throw new Error("baseUrl is required in connect mode");
			}
			const client = createOpencodeClient({ baseUrl });
			return new RalphCore(client);
		}

		const serverOpts: Record<string, unknown> = {
			port: options?.port ?? 4096,
		};
		if (options?.hostname) serverOpts.hostname = options.hostname;
		if (options?.timeout) serverOpts.timeout = options.timeout;
		if (options?.signal) serverOpts.signal = options.signal;
		if (options?.config) serverOpts.config = options.config;

		const { client, server } = await createOpencode(serverOpts);

		return new RalphCore(client, () => server.close());
	}

	async dispose(): Promise<void> {
		await this.client.instance.dispose();
		this.serverClose?.();
	}
}
