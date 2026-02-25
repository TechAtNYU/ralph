import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class HealthService {
	constructor(private client: OpencodeClient) {}

	async health(): Promise<RalphResult<{ healthy: true; version: string }>> {
		return wrapSdkCall(() => this.client.global.health());
	}

	async dispose(): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.instance.dispose());
	}
}
