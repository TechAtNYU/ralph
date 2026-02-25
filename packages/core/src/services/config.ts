import type {
	Config as ConfigInfo,
	OpencodeClient,
	Provider as ProviderInfo,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class ConfigService {
	constructor(private client: OpencodeClient) {}

	async get(params?: { directory?: string }): Promise<RalphResult<ConfigInfo>> {
		return wrapSdkCall(() => this.client.config.get(params));
	}

	async update(params: {
		directory?: string;
		config: ConfigInfo;
	}): Promise<RalphResult<ConfigInfo>> {
		return wrapSdkCall(() =>
			this.client.config.update({
				directory: params.directory,
				config: params.config,
			}),
		);
	}

	async providers(params?: { directory?: string }): Promise<
		RalphResult<{
			providers: Array<ProviderInfo>;
			default: Record<string, string>;
		}>
	> {
		return wrapSdkCall(() => this.client.config.providers(params));
	}

	async globalGet(): Promise<RalphResult<ConfigInfo>> {
		return wrapSdkCall(() => this.client.global.config.get());
	}

	async globalUpdate(params: {
		config: ConfigInfo;
	}): Promise<RalphResult<ConfigInfo>> {
		return wrapSdkCall(() =>
			this.client.global.config.update({ config: params.config }),
		);
	}
}
