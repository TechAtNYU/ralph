import { describe, expect, it } from "bun:test";
import { createPromptTask } from "./prompt-task";

describe("createPromptTask", () => {
	it("includes the parsed model from the global config", () => {
		expect(
			createPromptTask({
				prompt: "hello",
				storedModel: "anthropic/claude-sonnet-4-5",
			}),
		).toEqual({
			type: "prompt",
			prompt: "hello",
			model: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
			},
		});
	});

	it("omits model when the global config is unset", () => {
		expect(
			createPromptTask({
				prompt: "hello",
				storedModel: "",
			}),
		).toEqual({
			type: "prompt",
			prompt: "hello",
			model: undefined,
		});
	});
});
