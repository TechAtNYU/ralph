import { describe, expect, it } from "bun:test";
import {
	addTranscriptToPrompt,
	buildConversationTranscript,
} from "./plan-view";

describe("plan view prompt helpers", () => {
	it("builds artifact prompts from visible conversation only", () => {
		const transcript = buildConversationTranscript([
			{ role: "system", content: "SPEC.md generated." },
			{ role: "user", content: "i want a basic todo app" },
			{ role: "assistant", content: "Any tech preferences?" },
			{ role: "user", content: "actually can we use react" },
		]);

		expect(transcript).toContain("User: i want a basic todo app");
		expect(transcript).toContain("Ralph: Any tech preferences?");
		expect(transcript).toContain("User: actually can we use react");
		expect(transcript).not.toContain("SPEC.md generated");
	});

	it("adds the transcript to auto artifact prompts", () => {
		const prompt = addTranscriptToPrompt("Generate SPEC.md.", [
			{ role: "user", content: "basic todo app" },
		]);

		expect(prompt).toContain("Generate SPEC.md.");
		expect(prompt).toContain("Conversation transcript:");
		expect(prompt).toContain("User: basic todo app");
	});
});
