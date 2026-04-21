import type { ProviderListResult } from "@techatnyu/ralphd";

/** Provider IDs sorted by popularity to keep common choices near the top. */
const PROVIDER_PRIORITY: Record<string, number> = {
	anthropic: 0,
	openai: 1,
	google: 2,
	openrouter: 3,
};

type ProviderEntry = ProviderListResult["providers"][number];

export interface ModelChoice {
	ref: string;
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	label: string;
}

export function sortProviders(providers: ProviderEntry[]): ProviderEntry[] {
	return [...providers].sort(
		(a, b) =>
			(PROVIDER_PRIORITY[a.id] ?? 99) - (PROVIDER_PRIORITY[b.id] ?? 99) ||
			a.name.localeCompare(b.name),
	);
}

export function countProviderModels(provider: ProviderEntry): number {
	return Object.keys(provider.models).length;
}

export function listConnectedModels(result: ProviderListResult): ModelChoice[] {
	const connected = new Set(result.connected);

	return sortProviders(result.providers)
		.filter((provider) => connected.has(provider.id))
		.flatMap((provider) =>
			Object.values(provider.models)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((model) => ({
					ref: `${provider.id}/${model.id}`,
					providerId: provider.id,
					providerName: provider.name,
					modelId: model.id,
					modelName: model.name,
					label: `${provider.name}/${model.name}`,
				})),
		);
}
