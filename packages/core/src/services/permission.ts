import type { OpencodeClient, PermissionRequest } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class PermissionService {
	constructor(private client: OpencodeClient) {}

	async list(params?: {
		directory?: string;
	}): Promise<RalphResult<Array<PermissionRequest>>> {
		return wrapSdkCall(() => this.client.permission.list(params));
	}

	async reply(params: {
		requestID: string;
		directory?: string;
		reply?: "once" | "always" | "reject";
		message?: string;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.permission.reply(params));
	}
}
