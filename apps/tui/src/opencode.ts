import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk/v2";

export class Opencode {
	private client: OpencodeClient | undefined;
	private server: { url: string; close(): void } | undefined;

	async get(): Promise<OpencodeClient> {
		if (!this.client) {
			const result = await createOpencode();
			this.client = result.client;
			this.server = result.server;
		}
		return this.client;
	}

	async dispose(): Promise<void> {
		await this.client?.instance.dispose();
		this.server?.close();
		this.client = undefined;
		this.server = undefined;
	}
}
