import type {
	OpencodeClient,
	QuestionAnswer,
	QuestionRequest,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class QuestionService {
	constructor(private client: OpencodeClient) {}

	async list(params?: {
		directory?: string;
	}): Promise<RalphResult<Array<QuestionRequest>>> {
		return wrapSdkCall(() => this.client.question.list(params));
	}

	async reply(params: {
		requestID: string;
		directory?: string;
		answers?: Array<QuestionAnswer>;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.question.reply(params));
	}

	async reject(params: {
		requestID: string;
		directory?: string;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() => this.client.question.reject(params));
	}
}
