import type {
	OpencodeClient,
	ProviderAuthAuthorization,
	ProviderAuthMethod,
	ProviderListResponse,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class ProviderService {
	constructor(private client: OpencodeClient) {}

	async list(params?: {
		directory?: string;
	}): Promise<RalphResult<ProviderListResponse>> {
		return wrapSdkCall(() => this.client.provider.list(params));
	}

	async auth(params?: {
		directory?: string;
	}): Promise<RalphResult<Record<string, Array<ProviderAuthMethod>>>> {
		return wrapSdkCall(() => this.client.provider.auth(params));
	}

	async oauthAuthorize(params: {
		providerID: string;
		directory?: string;
		method?: number;
	}): Promise<RalphResult<ProviderAuthAuthorization>> {
		return wrapSdkCall(() =>
			this.client.provider.oauth.authorize({
				providerID: params.providerID,
				directory: params.directory,
				method: params.method,
			}),
		);
	}

	async oauthCallback(params: {
		providerID: string;
		directory?: string;
		method?: number;
		code?: string;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() =>
			this.client.provider.oauth.callback({
				providerID: params.providerID,
				directory: params.directory,
				method: params.method,
				code: params.code,
			}),
		);
	}
}
