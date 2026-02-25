import type {
	Auth as AuthCredential,
	OpencodeClient,
} from "@opencode-ai/sdk/v2";
import { wrapSdkCall } from "../errors.js";
import type { RalphResult } from "../types.js";

export class AuthService {
	constructor(private client: OpencodeClient) {}

	async set(params: {
		providerID: string;
		auth: AuthCredential;
	}): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() =>
			this.client.auth.set({
				providerID: params.providerID,
				auth: params.auth,
			}),
		);
	}

	async remove(params: { providerID: string }): Promise<RalphResult<boolean>> {
		return wrapSdkCall(() =>
			this.client.auth.remove({ providerID: params.providerID }),
		);
	}
}
