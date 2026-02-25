import type { Agent, OpencodeClient } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export type SkillInfo = {
	name: string;
	description: string;
	location: string;
	content: string;
};

export class AppService {
	constructor(private client: OpencodeClient) {}

	async log(params: {
		directory?: string;
		service?: string;
		level?: "debug" | "info" | "error" | "warn";
		message?: string;
		extra?: Record<string, unknown>;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.app.log(params));
	}

	async agents(params?: { directory?: string }): Promise<RalphResult<Agent[]>> {
		return wrapSdkCall(() => this.client.app.agents(params));
	}

	async skills(params?: {
		directory?: string;
	}): Promise<RalphResult<SkillInfo[]>> {
		return wrapSdkCall(() => this.client.app.skills(params));
	}
}
