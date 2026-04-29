import { readFile, watch } from "node:fs";
import { join } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import { type PrdTask, parsePrd, validateSpec } from "../lib/plan-validation";

export type { PrdTask } from "../lib/plan-validation";

export interface PlanFilesData {
	tasks: PrdTask[];
	progress: string;
	specContent: string;
	hasSpec: boolean;
	hasPrd: boolean;
	specError?: string;
	prdError?: string;
}

interface UsePlanFilesReturn {
	data: PlanFilesData;
	loading: boolean;
	error: string | undefined;
	refresh: () => Promise<void>;
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

export function usePlanFiles(scaffoldPath: string | null): UsePlanFilesReturn {
	const [data, setData] = useState<PlanFilesData>({
		tasks: [],
		progress: "",
		specContent: "",
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
				specContent: "",
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
				specContent: specContent ?? "",
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
