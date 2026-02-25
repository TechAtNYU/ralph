import type {
	Command as CommandInfo,
	OpencodeClient,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class CommandService {
	constructor(private client: OpencodeClient) {}

	async list(params?: {
		directory?: string;
	}): Promise<RalphResult<CommandInfo[]>> {
		return wrapSdkCall(() => this.client.command.list(params));
	}
}
