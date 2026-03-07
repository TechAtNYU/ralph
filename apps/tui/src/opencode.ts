import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk/v2";

let client: OpencodeClient;
let close: () => void;

export const opencode = {
	async init() {
		const result = await createOpencode();
		client = result.client;
		close = () => result.server.close();
		return client;
	},

	get() {
		if (!client) {
			throw new Error("opencode not initialized — call init() first");
		}
		return client;
	},

	async dispose() {
		await client?.instance.dispose();
		close?.();
	},
};
