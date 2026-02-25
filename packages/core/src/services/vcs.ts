import type { OpencodeClient, VcsInfo } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class VcsService {
	constructor(private client: OpencodeClient) {}

	async get(params?: { directory?: string }): Promise<RalphResult<VcsInfo>> {
		return wrapSdkCall(() => this.client.vcs.get(params));
	}
}
