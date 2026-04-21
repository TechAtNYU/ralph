import type { SelectOption } from "@opentui/core";
import type { ProviderListResult } from "@techatnyu/ralphd";

/** Provider IDs sorted by popularity to keep common choices near the top. */
const PROVIDER_PRIORITY: Record<string, number> = {
	anthropic: 0,
	openai: 1,
	google: 2,
	openrouter: 3,
};

export const MODEL_SELECT_SEPARATOR_VALUE = "__separator__";

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

export function buildModelSelectOptions(
	result: ProviderListResult,
	recentModels: string[],
): SelectOption[] {
	const allModels: SelectOption[] = listConnectedModels(result).map(
		(choice) => ({
			name: choice.label,
			description: choice.ref,
			value: choice.ref,
		}),
	);

	const allByRef = new Map(allModels.map((model) => [model.value, model]));
	const recentOptions: SelectOption[] = recentModels
		.filter((ref) => allByRef.has(ref))
		.map((ref) => allByRef.get(ref) as SelectOption);

	if (recentOptions.length === 0) {
		return allModels;
	}

	const recentRefs = new Set(recentModels);
	const remainingModels = allModels.filter(
		(model) => !recentRefs.has(model.value as string),
	);

	return [
		{
			name: "-- Recent --",
			description: "",
			value: MODEL_SELECT_SEPARATOR_VALUE,
		},
		...recentOptions,
		{
			name: "-- All Models --",
			description: "",
			value: MODEL_SELECT_SEPARATOR_VALUE,
		},
		...remainingModels,
	];
}
