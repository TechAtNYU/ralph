import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { FileDiff } from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useEffect, useRef, useState } from "react";

const DIFFS_POLL_INTERVAL_MS = 500;

interface DiffViewerProps {
	instanceId: string;
	sessionId: string;
	onBack(): void;
	onQuit(): void;
}

function statusGlyph(status: FileDiff["status"]): string {
	switch (status) {
		case "added":
			return "A";
		case "deleted":
			return "D";
		case "modified":
			return "M";
		default:
			return " ";
	}
}

function extensionOf(file: string): string {
	const dot = file.lastIndexOf(".");
	if (dot < 0 || dot === file.length - 1) {
		return "";
	}
	return file.slice(dot + 1);
}

interface FileRowProps {
	diff: FileDiff;
	focused: boolean;
	expanded: boolean;
}

function FileRow({ diff, focused, expanded }: FileRowProps) {
	return (
		<box flexDirection="column" marginBottom={1}>
			<box flexDirection="row">
				<text attributes={focused ? TextAttributes.BOLD : TextAttributes.NONE}>
					{`${focused ? "> " : "  "}${statusGlyph(diff.status)}  ${diff.file}  `}
				</text>
				<text fg="#5fff87">{`+${diff.additions}`}</text>
				<text>{"  "}</text>
				<text fg="#ff5f5f">{`-${diff.deletions}`}</text>
			</box>
			{expanded ? (
				<box marginLeft={2} marginTop={1}>
					<diff
						diff={diff.patch}
						view="unified"
						filetype={extensionOf(diff.file)}
						showLineNumbers={true}
						wrapMode="none"
					/>
				</box>
			) : null}
		</box>
	);
}

export function DiffViewer({
	instanceId,
	sessionId,
	onBack,
	onQuit,
}: DiffViewerProps) {
	const [diffs, setDiffs] = useState<FileDiff[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const scrollRef = useRef<ScrollBoxRenderable | null>(null);

	useEffect(() => {
		let cancelled = false;
		let inFlight = false;

		const fetchDiffs = async () => {
			if (inFlight || cancelled) {
				return;
			}
			inFlight = true;
			try {
				const result = await daemon.sessionDiffs({ instanceId, sessionId });
				if (!cancelled) {
					setDiffs(result.diffs);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				inFlight = false;
			}
		};

		void fetchDiffs();
		const handle = setInterval(() => {
			void fetchDiffs();
		}, DIFFS_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(handle);
		};
	}, [instanceId, sessionId]);

	useKeyboard((event) => {
		if (event.ctrl && event.name === "c") {
			onQuit();
			return;
		}

		if (event.name === "escape") {
			onBack();
			return;
		}

		if (event.name === "pageup") {
			scrollRef.current?.scrollBy(-1, "viewport");
			return;
		}

		if (event.name === "pagedown") {
			scrollRef.current?.scrollBy(1, "viewport");
			return;
		}

		if (event.ctrl && event.name === "u") {
			scrollRef.current?.scrollBy(-0.5, "viewport");
			return;
		}

		if (event.ctrl && event.name === "d") {
			scrollRef.current?.scrollBy(0.5, "viewport");
			return;
		}

		if (event.name === "down" || event.name === "j") {
			setSelectedIndex((prev) =>
				Math.max(0, Math.min(prev + 1, diffs.length - 1)),
			);
			return;
		}

		if (event.name === "up" || event.name === "k") {
			setSelectedIndex((prev) =>
				Math.max(0, Math.min(prev - 1, diffs.length - 1)),
			);
			return;
		}

		if (event.name === "return" || event.name === "space") {
			const current = diffs[selectedIndex];
			if (!current) {
				return;
			}
			setExpanded((prev) => {
				const next = new Set(prev);
				if (next.has(current.file)) {
					next.delete(current.file);
				} else {
					next.add(current.file);
				}
				return next;
			});
			return;
		}

		if (event.name === "e") {
			setExpanded((prev) => {
				if (prev.size < diffs.length) {
					return new Set(diffs.map((d) => d.file));
				}
				return new Set();
			});
			return;
		}
	});

	let additions = 0;
	let deletions = 0;
	for (const d of diffs) {
		additions += d.additions;
		deletions += d.deletions;
	}

	return (
		<box flexDirection="column" flexGrow={1} width="100%">
			<box flexShrink={0} height={1} width="100%">
				<text attributes={TextAttributes.DIM}>
					{`Diffs · ${diffs.length} file${diffs.length === 1 ? "" : "s"} · +${additions}/-${deletions} · j/k nav · enter expand · e all · esc back · ctrl+c quit`}
				</text>
			</box>

			<scrollbox
				ref={scrollRef}
				flexGrow={1}
				flexShrink={1}
				minHeight={0}
				width="100%"
				border={true}
				padding={0}
				stickyScroll={false}
			>
				{diffs.length === 0 ? (
					<text attributes={TextAttributes.DIM}>No changes yet.</text>
				) : (
					diffs.map((d, i) => (
						<FileRow
							key={d.file}
							diff={d}
							focused={i === selectedIndex}
							expanded={expanded.has(d.file)}
						/>
					))
				)}
			</scrollbox>

			{error ? (
				<box flexShrink={0} height={1} width="100%">
					<text fg="#ff5f5f">{`Error: ${error}`}</text>
				</box>
			) : null}
		</box>
	);
}
