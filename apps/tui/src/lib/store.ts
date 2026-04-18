import { configDir, createStore } from "@crustjs/store";

export const ralphStore = createStore({
	dirPath: configDir("ralph"),
	fields: {
		model: { type: "string", default: "" },
		recentModels: { type: "string", array: true, default: [] as string[] },
	},
});

const RECENT_MODELS_LIMIT = 5;

/**
 * Set the active model and push it to the front of recentModels in a single atomic write.
 */
export async function setModelAndRecent(modelRef: string): Promise<void> {
	await ralphStore.update((current) => ({
		...current,
		model: modelRef,
		recentModels: [
			modelRef,
			...(current.recentModels ?? []).filter((m) => m !== modelRef),
		].slice(0, RECENT_MODELS_LIMIT),
	}));
}

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
