import type { OpencodeClient, Symbol as SymbolInfo } from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export type TextMatch = {
	path: { text: string };
	lines: { text: string };
	line_number: number;
	absolute_offset: number;
	submatches: Array<{
		match: { text: string };
		start: number;
		end: number;
	}>;
};

export class FindService {
	constructor(private client: OpencodeClient) {}

	async text(params: {
		pattern: string;
		directory?: string;
	}): Promise<RalphResult<TextMatch[]>> {
		return wrapSdkCall(() => this.client.find.text(params));
	}

	async files(params: {
		query: string;
		directory?: string;
		dirs?: "true" | "false";
		type?: "file" | "directory";
		limit?: number;
	}): Promise<RalphResult<string[]>> {
		return wrapSdkCall(() => this.client.find.files(params));
	}

	async symbols(params: {
		query: string;
		directory?: string;
	}): Promise<RalphResult<SymbolInfo[]>> {
		return wrapSdkCall(() => this.client.find.symbols(params));
	}
}
