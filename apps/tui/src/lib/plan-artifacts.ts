import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parsePrd, validateSpec } from "./plan-validation";

function normalizeModelOutput(content: string): string {
	const trimmed = content.trim();
	if (!trimmed) {
		throw new Error("empty response");
	}
	if (/<tool_call/i.test(trimmed)) {
		throw new Error("printed a tool call instead of artifact content");
	}
	return trimmed;
}

function extractPrdJson(content: string): string {
	const trimmed = normalizeModelOutput(content);
	if (trimmed.startsWith("{")) {
		return trimmed;
	}
	const fenced = trimmed.match(/^```json\s*\n([\s\S]*?)\n```$/i);
	if (fenced?.[1]) {
		return fenced[1].trim();
	}
	throw new Error("response must be raw JSON or a single fenced json block");
}

function extractSpecMarkdown(content: string): string {
	const trimmed = normalizeModelOutput(content);
	const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
	if (fenced?.[1]) {
		return fenced[1].trim();
	}
	return trimmed;
}

async function writeArtifact(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

export async function writeSpecArtifact(
	scaffoldPath: string,
	content: string,
): Promise<void> {
	const spec = extractSpecMarkdown(content);
	const validation = validateSpec(spec);
	if (!validation.valid) {
		throw new Error(validation.error ?? "invalid SPEC.md");
	}
	await writeArtifact(join(scaffoldPath, "SPEC.md"), `${spec}\n`);
}

export async function writePrdArtifact(
	scaffoldPath: string,
	content: string,
): Promise<void> {
	const jsonText = extractPrdJson(content);
	const parsed = parsePrd(jsonText);
	if (parsed.error) {
		throw new Error(parsed.error);
	}
	await writeArtifact(
		join(scaffoldPath, "prd.json"),
		`${JSON.stringify({ tasks: parsed.tasks }, null, "\t")}\n`,
	);
}
