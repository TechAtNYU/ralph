import type { OpencodeClient, Path as PathInfo } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class PathService {
	constructor(private client: OpencodeClient) {}

	async get(params?: { directory?: string }): Promise<RalphResult<PathInfo>> {
		return wrapSdkCall(() => this.client.path.get(params));
	}
}
