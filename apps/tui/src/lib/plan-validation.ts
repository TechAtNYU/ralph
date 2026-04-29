import { z } from "zod";

export const PrdTaskSchema = z.object({
	description: z.string().min(1),
	subtasks: z.array(z.string().min(1)).min(1),
	notes: z.string().optional().default(""),
	passed: z.boolean().optional().default(false),
});

export const PrdFileSchema = z.object({
	tasks: z.array(PrdTaskSchema).min(1),
});

export type PrdTask = z.infer<typeof PrdTaskSchema>;
export type PrdFile = z.infer<typeof PrdFileSchema>;

export interface PrdParseResult {
	tasks: PrdTask[];
	error?: string;
}

export function parsePrd(content: string | null): PrdParseResult {
	if (content === null) return { tasks: [] };
	let json: unknown;
	try {
		json = JSON.parse(content);
	} catch {
		return { tasks: [], error: "invalid JSON" };
	}
	const parsed = PrdFileSchema.safeParse(json);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const path = first?.path.join(".") || "root";
		const message = first?.message ?? "validation failed";
		return { tasks: [], error: `${path}: ${message}` };
	}
	return { tasks: parsed.data.tasks };
}

export interface SpecValidation {
	valid: boolean;
	error?: string;
}

export function validateSpec(content: string | null): SpecValidation {
	if (content === null) return { valid: false };
	const trimmed = content.trim();
	if (trimmed.length < 100) {
		return { valid: false, error: "too short (<100 chars)" };
	}
	if (!/^#\s+\S/m.test(trimmed)) {
		return { valid: false, error: "missing markdown heading" };
	}
	return { valid: true };
}
