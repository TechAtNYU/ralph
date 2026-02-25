import type { OpencodeClient, Project } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class ProjectService {
	constructor(private client: OpencodeClient) {}

	async list(params?: { directory?: string }): Promise<RalphResult<Project[]>> {
		return wrapSdkCall(() => this.client.project.list(params));
	}

	async current(params?: {
		directory?: string;
	}): Promise<RalphResult<Project>> {
		return wrapSdkCall(() => this.client.project.current(params));
	}

	async update(params: {
		projectID: string;
		directory?: string;
		name?: string;
		icon?: { url?: string; override?: string; color?: string };
		commands?: { start?: string };
	}): Promise<RalphResult<Project>> {
		return wrapSdkCall(() => this.client.project.update(params));
	}
}
