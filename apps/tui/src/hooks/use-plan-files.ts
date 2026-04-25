import { readFile, watch } from "node:fs";
import { join } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const PrdTaskSchema = z.object({
	description: z.string().min(1),
	subtasks: z.array(z.string().min(1)).min(1),
	notes: z.string().optional().default(""),
	passed: z.boolean().optional().default(false),
});

const PrdFileSchema = z.object({
	tasks: z.array(PrdTaskSchema).min(1),
});

export type PrdTask = z.infer<typeof PrdTaskSchema>;

export interface PlanFilesData {
	tasks: PrdTask[];
	progress: string;
	hasSpec: boolean;
	hasPrd: boolean;
	specError?: string;
	prdError?: string;
}

interface UsePlanFilesReturn {
	data: PlanFilesData;
	loading: boolean;
	error: string | undefined;
	refresh: () => void;
}

function readFileAsync(path: string): Promise<string | null> {
	return new Promise((resolve) => {
		readFile(path, "utf-8", (err, data) => {
			if (err) {
				resolve(null);
			} else {
				resolve(data);
			}
		});
	});
}

interface PrdParseResult {
	tasks: PrdTask[];
	error?: string;
}

function parsePrd(content: string | null): PrdParseResult {
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

interface SpecValidation {
	valid: boolean;
	error?: string;
}

function validateSpec(content: string | null): SpecValidation {
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

export function usePlanFiles(scaffoldPath: string | null): UsePlanFilesReturn {
	const [data, setData] = useState<PlanFilesData>({
		tasks: [],
		progress: "",
		hasSpec: false,
		hasPrd: false,
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadFiles = useCallback(async () => {
		if (!scaffoldPath) {
			setData({
				tasks: [],
				progress: "",
				hasSpec: false,
				hasPrd: false,
			});
			return;
		}
		setLoading(true);
		setError(undefined);
		try {
			const [prdContent, progressContent, specContent] = await Promise.all([
				readFileAsync(join(scaffoldPath, "prd.json")),
				readFileAsync(join(scaffoldPath, "progress.md")),
				readFileAsync(join(scaffoldPath, "SPEC.md")),
			]);
			const prdResult = parsePrd(prdContent);
			const specResult = validateSpec(specContent);
			setData({
				tasks: prdResult.tasks,
				progress: progressContent ?? "",
				hasSpec: specContent !== null && specResult.valid,
				hasPrd: prdContent !== null && !prdResult.error,
				specError:
					specContent !== null && !specResult.valid
						? specResult.error
						: undefined,
				prdError:
					prdContent !== null && prdResult.error ? prdResult.error : undefined,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to read plan files");
		} finally {
			setLoading(false);
		}
	}, [scaffoldPath]);

	useEffect(() => {
		void loadFiles();

		if (!scaffoldPath) return;

		let watcher: ReturnType<typeof watch> | null = null;
		try {
			watcher = watch(scaffoldPath, { recursive: true }, () => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => {
					void loadFiles();
				}, 500);
			});
		} catch {
			// scaffoldPath may not exist yet — load will create it implicitly
		}

		return () => {
			watcher?.close();
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [loadFiles, scaffoldPath]);

	return { data, loading, error, refresh: loadFiles };
}
