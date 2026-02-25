import type {
	FileContent,
	FileNode,
	File as FileStatusEntry,
	OpencodeClient,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class FileService {
	constructor(private client: OpencodeClient) {}

	async list(params: {
		path: string;
		directory?: string;
	}): Promise<RalphResult<FileNode[]>> {
		return wrapSdkCall(() => this.client.file.list(params));
	}

	async read(params: {
		path: string;
		directory?: string;
	}): Promise<RalphResult<FileContent>> {
		return wrapSdkCall(() => this.client.file.read(params));
	}

	async status(params?: {
		directory?: string;
	}): Promise<RalphResult<FileStatusEntry[]>> {
		return wrapSdkCall(() => this.client.file.status(params));
	}
}
