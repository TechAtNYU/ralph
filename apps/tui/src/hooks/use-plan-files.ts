import { readFile, watch } from "node:fs";
import { join } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";

export interface PrdTask {
	description: string;
	subtasks: string[];
	notes: string;
	passed: boolean;
}

interface PrdData {
	tasks: PrdTask[];
}

export interface PlanFilesData {
	tasks: PrdTask[];
	progress: string;
	hasSpec: boolean;
	hasPrd: boolean;
	hasPrompt: boolean;
}

interface UsePlanFilesReturn {
	data: PlanFilesData;
	loading: boolean;
	error: string | undefined;
	refresh: () => void;
}

const RALPH_DIR = join(process.cwd(), ".ralph");
const PRD_PATH = join(RALPH_DIR, "prd.json");
const PROGRESS_PATH = join(RALPH_DIR, "progress.md");
const SPEC_PATH = join(RALPH_DIR, "SPEC.md");
const PROMPT_PATH = join(RALPH_DIR, "PROMPT.md");

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

function parsePrd(content: string | null): PrdTask[] {
	if (!content) return [];
	try {
		const parsed = JSON.parse(content) as PrdData;
		if (Array.isArray(parsed.tasks)) {
			return parsed.tasks;
		}
	} catch {
		// invalid JSON
	}
	return [];
}

export function usePlanFiles(): UsePlanFilesReturn {
	const [data, setData] = useState<PlanFilesData>({
		tasks: [],
		progress: "",
		hasSpec: false,
		hasPrd: false,
		hasPrompt: false,
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadFiles = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const [prdContent, progressContent, specContent, promptContent] =
				await Promise.all([
					readFileAsync(PRD_PATH),
					readFileAsync(PROGRESS_PATH),
					readFileAsync(SPEC_PATH),
					readFileAsync(PROMPT_PATH),
				]);
			setData({
				tasks: parsePrd(prdContent),
				progress: progressContent ?? "",
				hasSpec: specContent !== null,
				hasPrd: prdContent !== null,
				hasPrompt: promptContent !== null,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to read plan files");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadFiles();

		let watcher: ReturnType<typeof watch> | null = null;
		try {
			watcher = watch(RALPH_DIR, { recursive: true }, () => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => {
					void loadFiles();
				}, 500);
			});
		} catch {
			// .ralph/ directory may not exist yet
		}

		return () => {
			watcher?.close();
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [loadFiles]);

	return { data, loading, error, refresh: loadFiles };
}
