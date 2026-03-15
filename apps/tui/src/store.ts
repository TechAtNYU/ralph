import { configDir, createStore } from "@crustjs/store";

export const ralphStore = createStore({
	dirPath: configDir("ralph"),
	fields: {
		model: { type: "string", default: "" },
	},
});

/**
 * Parse a "provider/model" string into { providerId, modelId }.
 * Handles models with slashes (e.g. "openrouter/openai/gpt-5").
 */
export function parseModelRef(
	model: string,
): { providerId: string; modelId: string } | undefined {
	if (!model) return undefined;
	const [providerId, ...rest] = model.split("/");
	const modelId = rest.join("/");
	if (!providerId || !modelId) return undefined;
	return { providerId, modelId };
}
