import { bold, cyan, dim, green, red, table } from "@crustjs/style";
import type { ProviderListResult } from "@techatnyu/ralphd";
import type { OnboardingResult } from "./onboarding";
import { countProviderModels, sortProviders } from "./providers";

export function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

export function printOnboardingSummary(
	result: OnboardingResult,
	title: string,
): void {
	console.log(bold(title));
	for (const check of result.checks) {
		const status = check.ok ? green("OK  ") : red("FAIL");
		const message = check.message ? ` ${dim(`(${check.message})`)}` : "";
		console.log(`${status} ${check.label}${message}`);
	}
	console.log(
		result.ok
			? green("Ralph is ready.")
			: red("Ralph setup is incomplete. Fix the failed checks above."),
	);
}

export function printProviderList(result: ProviderListResult): void {
	const connected = new Set(result.connected);
	const providers = sortProviders(result.providers);

	if (providers.length === 0) {
		console.log(dim("No providers available."));
		return;
	}

	console.log(bold("Providers"));
	console.log(
		table(
			["Provider", "Status", "Models"],
			providers.map((provider) => [
				`${provider.name} ${dim(`(${provider.id})`)}`,
				connected.has(provider.id) ? green("connected") : red("disconnected"),
				String(countProviderModels(provider)),
			]),
		),
	);
	if (result.connected.length > 0) {
		console.log(cyan(`Connected: ${result.connected.join(", ")}`));
	}
}

export function printSetupSummary(options: {
	currentModel?: string;
	providerSummary?: {
		connected: number;
		total: number;
	};
	providerError?: string;
}): void {
	if (options.currentModel) {
		console.log(`Active model: ${cyan(options.currentModel)}`);
	} else {
		console.log(dim("No active model selected yet."));
	}

	if (options.providerSummary) {
		console.log(
			dim(
				`${options.providerSummary.connected} connected provider(s), ${options.providerSummary.total} total provider(s) detected.`,
			),
		);
	}

	if (options.providerError) {
		console.log(red(`Provider refresh failed: ${options.providerError}`));
	}
}
