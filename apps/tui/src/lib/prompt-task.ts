import { parseModelRef } from "./store";

export function createPromptTask({
	prompt,
	storedModel,
}: {
	prompt: string;
	storedModel: string;
}) {
	return {
		type: "prompt" as const,
		prompt,
		model: parseModelRef(storedModel),
	};
}
