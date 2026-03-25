import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";

const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	".ralph",
	".ralph-dev",
	"dist",
	"build",
	".turbo",
	".next",
]);

async function listFiles(dir: string): Promise<string[]> {
	const results: string[] = [];
	try {
		const entries = await readdir(dir, {
			withFileTypes: true,
			recursive: true,
		});
		for (const entry of entries) {
			if (entry.isFile()) {
				const parent =
					"parentPath" in entry
						? (entry.parentPath as string)
						: (entry as unknown as { path: string }).path;
				const fullPath = `${parent}/${entry.name}`;
				const rel = relative(dir, fullPath);
				const shouldIgnore = rel
					.split("/")
					.some((segment) => IGNORE_DIRS.has(segment));
				if (!shouldIgnore) {
					results.push(rel);
				}
			}
		}
	} catch {
		// directory may not exist
	}
	return results;
}

function scoreMatch(file: string, query: string): number {
	const lower = file.toLowerCase();
	const q = query.toLowerCase();
	const basename = lower.split("/").pop() ?? lower;
	if (basename.startsWith(q)) return 3;
	if (basename.includes(q)) return 2;
	if (lower.includes(q)) return 1;
	return 0;
}

interface UseFileSearchReturn {
	results: string[];
	loading: boolean;
}

export function useFileSearch(query: string): UseFileSearchReturn {
	const [allFiles, setAllFiles] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const loadedRef = useRef(false);

	const scan = useCallback(async () => {
		if (loadedRef.current) return;
		setLoading(true);
		const files = await listFiles(process.cwd());
		setAllFiles(files);
		loadedRef.current = true;
		setLoading(false);
	}, []);

	useEffect(() => {
		void scan();
	}, [scan]);

	if (!query) {
		return { results: allFiles.slice(0, 20), loading };
	}

	const scored = allFiles
		.map((file) => ({ file, score: scoreMatch(file, query) }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 20)
		.map(({ file }) => file);

	return { results: scored, loading };
}
