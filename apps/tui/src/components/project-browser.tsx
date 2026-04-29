import { basename } from "node:path";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { DaemonSession, ManagedInstance } from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useMemo, useState } from "react";

interface ProjectBrowserProps {
	onSelect(instance: ManagedInstance, sessionId: string | null): void;
	onClose(): void;
}

interface InstanceGroup {
	instance: ManagedInstance;
	sessions: DaemonSession[];
}

type FlatEntry =
	| { kind: "instance"; instance: ManagedInstance }
	| {
			kind: "session";
			instance: ManagedInstance;
			session: DaemonSession;
	  }
	| { kind: "new-chat"; instance: ManagedInstance };

function flattenGroups(groups: InstanceGroup[]): FlatEntry[] {
	const entries: FlatEntry[] = [];
	for (const group of groups) {
		entries.push({ kind: "instance", instance: group.instance });
		for (const session of group.sessions) {
			entries.push({
				kind: "session",
				instance: group.instance,
				session,
			});
		}
		entries.push({ kind: "new-chat", instance: group.instance });
	}
	return entries;
}

function isSelectable(entry: FlatEntry): boolean {
	return entry.kind === "session" || entry.kind === "new-chat";
}

function nextSelectable(
	entries: FlatEntry[],
	current: number,
	dir: 1 | -1,
): number {
	let i = current + dir;
	while (i >= 0 && i < entries.length) {
		const entry = entries[i];
		if (entry && isSelectable(entry)) return i;
		i += dir;
	}
	return current;
}

function firstSelectable(entries: FlatEntry[]): number {
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry && isSelectable(entry)) return i;
	}
	return 0;
}

export function ProjectBrowser({ onSelect, onClose }: ProjectBrowserProps) {
	const [groups, setGroups] = useState<InstanceGroup[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const entries = useMemo(() => flattenGroups(groups), [groups]);
	const [selectedIndex, setSelectedIndex] = useState(0);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const { instances } = await daemon.listInstances();
			const results = await Promise.all(
				instances.map(async (instance) => {
					const { sessions } = await daemon.listSessions(instance.id);
					return { instance, sessions };
				}),
			);
			setGroups(results);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load projects");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Reset selection when entries change.
	useEffect(() => {
		setSelectedIndex(firstSelectable(entries));
	}, [entries]);

	useKeyboard((key) => {
		if (key.name === "escape") {
			onClose();
			return;
		}

		if (key.name === "r") {
			void refresh();
			return;
		}

		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((prev) => nextSelectable(entries, prev, 1));
			return;
		}

		if (key.name === "up" || key.name === "k") {
			setSelectedIndex((prev) => nextSelectable(entries, prev, -1));
			return;
		}

		if (key.name === "return") {
			const entry = entries[selectedIndex];
			if (!entry) return;
			if (entry.kind === "session") {
				onSelect(entry.instance, entry.session.id);
			} else if (entry.kind === "new-chat") {
				onSelect(entry.instance, null);
			}
		}
	});

	return (
		<box
			position="absolute"
			top={2}
			left="15%"
			width="70%"
			zIndex={10}
			backgroundColor="black"
			border={true}
			borderStyle="rounded"
			borderColor="cyan"
			title="Projects"
			flexDirection="column"
			padding={1}
		>
			{loading ? (
				<text attributes={TextAttributes.DIM}>Loading...</text>
			) : error ? (
				<text fg="red">{error}</text>
			) : entries.length === 0 ? (
				<text attributes={TextAttributes.DIM}>No instances registered</text>
			) : (
				entries.map((entry, index) => {
					const focused = index === selectedIndex;

					if (entry.kind === "instance") {
						const dir = basename(entry.instance.directory);
						return (
							<box
								key={entry.instance.id}
								flexDirection="row"
								marginTop={index > 0 ? 1 : 0}
							>
								<text attributes={TextAttributes.BOLD}>
									{`  ${entry.instance.name}`}
								</text>
								<text attributes={TextAttributes.DIM}>
									{` [${entry.instance.status}] ${dir}`}
								</text>
							</box>
						);
					}

					if (entry.kind === "session") {
						return (
							<box key={entry.session.id} flexDirection="row">
								<text
									fg={focused ? "cyan" : undefined}
									attributes={
										focused ? TextAttributes.BOLD : TextAttributes.DIM
									}
								>
									{`  ${focused ? ">" : " "} ${entry.session.title}`}
								</text>
							</box>
						);
					}

					// new-chat
					return (
						<box key={`new-${entry.instance.id}`} flexDirection="row">
							<text
								fg={focused ? "cyan" : undefined}
								attributes={focused ? TextAttributes.BOLD : TextAttributes.DIM}
							>
								{`  ${focused ? ">" : " "} + New Chat`}
							</text>
						</box>
					);
				})
			)}

			<text attributes={TextAttributes.DIM} marginTop={1}>
				j/k: navigate enter: open r: refresh esc: close
			</text>
		</box>
	);
}
