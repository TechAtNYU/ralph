import { basename } from "node:path";
import { type SelectOption, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type {
	DaemonJob,
	HealthResult,
	ManagedInstance,
} from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useState } from "react";
import {
	filterJobsForSession,
	flattenRows,
	listSessions,
	type Row,
	type SessionSummary,
} from "../lib/sessions";
import { ralphStore, setModelAndRecent } from "../lib/store";
import { Chat } from "./chat";

type View =
	| { type: "dashboard" }
	| {
			type: "chat";
			instanceId: string;
			instanceName: string;
			ralphSessionId?: string;
	  };

type Focus =
	| { kind: "instance"; instanceId: string }
	| { kind: "session"; instanceId: string; sessionId: string };

interface DashboardData {
	health: HealthResult;
	instances: ManagedInstance[];
	jobs: DaemonJob[];
}

/** Provider IDs sorted by popularity — used to push well-known providers to the top. */
const PROVIDER_PRIORITY: Record<string, number> = {
	anthropic: 0,
	openai: 1,
	google: 2,
	openrouter: 3,
};

const SEPARATOR_VALUE = "__separator__";

async function fetchModelOptions(): Promise<SelectOption[]> {
	const [result, store] = await Promise.all([
		daemon.providerList({ refresh: true }),
		ralphStore.read(),
	]);
	const connected = new Set(result.connected);
	const recentRefs = new Set(store.recentModels ?? []);

	// Build flat list of all connected models
	const allModels: SelectOption[] = result.providers
		.filter((provider) => connected.has(provider.id))
		.sort(
			(a, b) =>
				(PROVIDER_PRIORITY[a.id] ?? 99) - (PROVIDER_PRIORITY[b.id] ?? 99) ||
				a.name.localeCompare(b.name),
		)
		.flatMap((provider) =>
			Object.values(provider.models)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((model) => ({
					name: `${provider.name}/${model.name}`,
					description: `${provider.id}/${model.id}`,
					value: `${provider.id}/${model.id}`,
				})),
		);

	// Build recent section from stored order, only including models that still exist
	const allByRef = new Map(allModels.map((m) => [m.value, m]));
	const recentOptions: SelectOption[] = (store.recentModels ?? [])
		.filter((ref) => allByRef.has(ref))
		.map((ref) => allByRef.get(ref) as SelectOption);

	if (recentOptions.length === 0) return allModels;

	// Filter recents out of the "all" section to avoid duplicates
	const restModels = allModels.filter(
		(m) => !recentRefs.has(m.value as string),
	);

	return [
		{ name: "── Recent ──", description: "", value: SEPARATOR_VALUE },
		...recentOptions,
		{ name: "── All Models ──", description: "", value: SEPARATOR_VALUE },
		...restModels,
	];
}

interface AppProps {
	onQuit(): void;
}

function countJobsByState(
	jobs: DaemonJob[],
	instanceId: string,
): { running: number; queued: number } {
	let running = 0;
	let queued = 0;
	for (const job of jobs) {
		if (job.instanceId !== instanceId) continue;
		if (job.state === "running") running++;
		else if (job.state === "queued") queued++;
	}
	return { running, queued };
}

function rowKey(row: Row): string {
	return row.kind === "instance"
		? `i:${row.instance.id}`
		: `s:${row.instance.id}:${row.session.sessionId}`;
}

function findFocusIndex(rows: Row[], focus: Focus | undefined): number {
	if (!focus) return -1;
	return rows.findIndex((row) => {
		if (focus.kind === "instance") {
			return row.kind === "instance" && row.instance.id === focus.instanceId;
		}
		return (
			row.kind === "session" &&
			row.instance.id === focus.instanceId &&
			row.session.sessionId === focus.sessionId
		);
	});
}

function focusFromRow(row: Row): Focus {
	if (row.kind === "instance") {
		return { kind: "instance", instanceId: row.instance.id };
	}
	return {
		kind: "session",
		instanceId: row.instance.id,
		sessionId: row.session.sessionId,
	};
}

function Dashboard({
	onQuit,
	onSelectInstance,
}: {
	onQuit(): void;
	onSelectInstance(instance: ManagedInstance, ralphSessionId?: string): void;
}) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [data, setData] = useState<DashboardData>();
	const [focused, setFocused] = useState<Focus>();
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [sessionsByInstance, setSessionsByInstance] = useState<
		Record<string, SessionSummary[]>
	>({});
	const [currentModel, setCurrentModel] = useState("");
	const [modelPicker, setModelPicker] = useState(false);
	const [modelOptions, setModelOptions] = useState<SelectOption[]>([]);
	const [fetchingModels, setFetchingModels] = useState(false);
	const [query, setQuery] = useState("");
	const [cursorOn, setCursorOn] = useState(true);

	useEffect(() => {
		if (!modelPicker) return;
		const id = setInterval(() => setCursorOn((v) => !v), 500);
		return () => clearInterval(id);
	}, [modelPicker]);

	const q = query.toLowerCase();
	const visibleOptions = q
		? modelOptions.filter(
				(o) =>
					o.value !== SEPARATOR_VALUE &&
					(o.name.toLowerCase().includes(q) ||
						(typeof o.description === "string" &&
							o.description.toLowerCase().includes(q))),
			)
		: modelOptions;

	const refresh = useCallback(
		async (nextFocus?: Focus) => {
			setLoading(true);
			setError(undefined);
			try {
				const [health, instanceList, storeState] = await Promise.all([
					daemon.health(),
					daemon.listInstances(),
					ralphStore.read(),
				]);
				setCurrentModel(storeState.model);
				const instances = instanceList.instances;

				// Fetch sessions for every currently-expanded instance that still exists.
				const expandedIds = [...expanded].filter((id) =>
					instances.some((inst) => inst.id === id),
				);
				const sessionEntries = await Promise.all(
					expandedIds.map(async (id) => {
						try {
							return [id, await listSessions(id)] as const;
						} catch {
							return [id, [] as SessionSummary[]] as const;
						}
					}),
				);
				const nextSessions: Record<string, SessionSummary[]> = {};
				for (const [id, list] of sessionEntries) {
					nextSessions[id] = list;
				}

				// Resolve next focus against the fresh row list.
				const candidate = nextFocus ?? focused;
				const rows = flattenRows(instances, new Set(expandedIds), nextSessions);
				let resolvedFocus: Focus | undefined;
				if (candidate) {
					const idx = findFocusIndex(rows, candidate);
					if (idx >= 0) {
						resolvedFocus = candidate;
					} else if (
						candidate.kind === "session" &&
						instances.some((inst) => inst.id === candidate.instanceId)
					) {
						// Session disappeared — fall back to parent instance.
						resolvedFocus = {
							kind: "instance",
							instanceId: candidate.instanceId,
						};
					}
				}
				if (!resolvedFocus) {
					const firstRow = rows[0];
					if (firstRow) {
						resolvedFocus = focusFromRow(firstRow);
					}
				}

				const focusedInstanceId = resolvedFocus?.instanceId;
				const jobs = focusedInstanceId
					? await daemon.listJobs({ instanceId: focusedInstanceId })
					: { jobs: [] as DaemonJob[] };

				setFocused(resolvedFocus);
				setExpanded(new Set(expandedIds));
				setSessionsByInstance(nextSessions);
				setData({
					health,
					instances,
					jobs: jobs.jobs,
				});
			} catch (refreshError) {
				setError(
					refreshError instanceof Error
						? refreshError.message
						: "Failed to load daemon status",
				);
			} finally {
				setLoading(false);
			}
		},
		[expanded, focused],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: initial load only; subsequent refreshes are user-driven
	useEffect(() => {
		void refresh();
	}, []);

	const rows: Row[] = data
		? flattenRows(data.instances, expanded, sessionsByInstance)
		: [];
	const focusIndex = findFocusIndex(rows, focused);

	const toggleExpand = useCallback(
		async (instanceId: string, expand: boolean) => {
			setExpanded((prev) => {
				const next = new Set(prev);
				if (expand) next.add(instanceId);
				else next.delete(instanceId);
				return next;
			});
			if (expand && !sessionsByInstance[instanceId]) {
				try {
					const sessions = await listSessions(instanceId);
					setSessionsByInstance((prev) => ({
						...prev,
						[instanceId]: sessions,
					}));
				} catch (err) {
					setError(
						err instanceof Error ? err.message : "Failed to list sessions",
					);
				}
			}
		},
		[sessionsByInstance],
	);

	const moveFocus = useCallback(
		(delta: number) => {
			if (rows.length === 0) return;
			const current = focusIndex < 0 ? 0 : focusIndex;
			const nextIdx = Math.min(Math.max(current + delta, 0), rows.length - 1);
			if (nextIdx === current) return;
			const nextRow = rows[nextIdx];
			if (!nextRow) return;
			const nextFocus = focusFromRow(nextRow);
			// Only refetch jobs when the focused instance changes.
			const prevInstanceId = focused?.instanceId;
			if (prevInstanceId !== nextFocus.instanceId) {
				void refresh(nextFocus);
			} else {
				setFocused(nextFocus);
			}
		},
		[focused, focusIndex, refresh, rows],
	);

	useKeyboard((key) => {
		if (modelPicker) {
			if (key.name === "escape") {
				setModelPicker(false);
				setQuery("");
				return;
			}
			if (key.name === "backspace") {
				setQuery((prev) => prev.slice(0, -1));
				return;
			}
			if (
				!key.ctrl &&
				!key.meta &&
				typeof key.sequence === "string" &&
				key.sequence.length === 1 &&
				key.sequence >= " " &&
				key.sequence <= "~"
			) {
				setQuery((prev) => prev + key.sequence);
			}
			return;
		}

		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			onQuit();
			return;
		}

		if (key.name === "r") {
			void refresh();
			return;
		}

		if (key.name === "m" && !fetchingModels) {
			setQuery("");
			setFetchingModels(true);
			void fetchModelOptions()
				.then((options) => {
					setModelOptions(options);
					setModelPicker(true);
				})
				.catch((err) => {
					setError(
						err instanceof Error ? err.message : "Failed to fetch models",
					);
				})
				.finally(() => setFetchingModels(false));
			return;
		}

		if (!data || !focused) {
			return;
		}

		if (key.name === "down" || key.name === "j") {
			moveFocus(1);
			return;
		}

		if (key.name === "up" || key.name === "k") {
			moveFocus(-1);
			return;
		}

		if (key.name === "space") {
			if (focused.kind === "session") {
				setFocused({ kind: "instance", instanceId: focused.instanceId });
				void toggleExpand(focused.instanceId, false);
				return;
			}
			void toggleExpand(focused.instanceId, !expanded.has(focused.instanceId));
			return;
		}

		if (key.name === "return") {
			const focusedInstance = data.instances.find(
				(inst) => inst.id === focused.instanceId,
			);
			if (!focusedInstance) return;
			if (focused.kind === "session") {
				onSelectInstance(focusedInstance, focused.sessionId);
			} else {
				onSelectInstance(focusedInstance);
			}
			return;
		}
	});

	const focusedInstance = focused
		? data?.instances.find((inst) => inst.id === focused.instanceId)
		: undefined;
	const focusedSession =
		focused?.kind === "session" && focused
			? sessionsByInstance[focused.instanceId]?.find(
					(s) => s.sessionId === focused.sessionId,
				)
			: undefined;

	const jobsToDisplay: DaemonJob[] =
		data && focused && focusedSession
			? filterJobsForSession(data.jobs, focusedSession)
			: (data?.jobs ?? []);

	if (modelPicker) {
		return (
			<box flexDirection="column" flexGrow={1} padding={1}>
				<box
					flexDirection="row"
					justifyContent="space-between"
					marginBottom={1}
				>
					<text attributes={TextAttributes.BOLD}>Select Model</text>
					<text attributes={TextAttributes.DIM}>esc</text>
				</box>
				<box
					border
					borderStyle="single"
					borderColor="#666"
					paddingLeft={1}
					paddingRight={1}
					marginBottom={1}
					height={3}
				>
					{query ? (
						<text>{`${query}${cursorOn ? "\u2588" : " "}`}</text>
					) : (
						<text attributes={TextAttributes.DIM}>
							{`${cursorOn ? "\u2588" : "S"}earch`}
						</text>
					)}
				</box>
				<select
					key={query}
					focused
					flexGrow={1}
					options={visibleOptions}
					showDescription
					showScrollIndicator
					wrapSelection
					onSelect={(_index, option) => {
						if (option?.value && option.value !== SEPARATOR_VALUE) {
							const modelRef = option.value as string;
							void setModelAndRecent(modelRef).then(() => {
								setCurrentModel(modelRef);
								setModelPicker(false);
							});
						}
					}}
				/>
			</box>
		);
	}

	return (
		<box flexDirection="column" flexGrow={1} padding={1}>
			<box flexDirection="column" marginBottom={1}>
				<ascii-font font="tiny" text="Ralph" />
				<text attributes={TextAttributes.BOLD}>
					{loading
						? "Refreshing daemon status..."
						: data
							? `Daemon online (pid ${data.health.pid})`
							: "Daemon status unavailable"}
				</text>
				<text attributes={TextAttributes.DIM}>
					{data
						? `${data.health.running} running, ${data.health.queued} queued | Model: ${currentModel || "default"}`
						: (error ?? "No data available")}
				</text>
			</box>

			<box flexDirection="row" flexGrow={1} gap={2}>
				<box flexDirection="column" width="55%">
					<text attributes={TextAttributes.BOLD}>Instances</text>
					{rows.length === 0 ? (
						<text attributes={TextAttributes.DIM}>No instances registered</text>
					) : (
						rows.map((row) => {
							const isFocused =
								focused !== undefined &&
								((focused.kind === "instance" &&
									row.kind === "instance" &&
									row.instance.id === focused.instanceId) ||
									(focused.kind === "session" &&
										row.kind === "session" &&
										row.instance.id === focused.instanceId &&
										row.session.sessionId === focused.sessionId));
							const attrs = isFocused
								? TextAttributes.BOLD
								: TextAttributes.DIM;
							const chevron = isFocused ? ">" : " ";

							if (row.kind === "instance") {
								const counts = countJobsByState(
									data?.jobs ?? [],
									row.instance.id,
								);
								const isExpanded = expanded.has(row.instance.id);
								const hasKnownSessions =
									sessionsByInstance[row.instance.id] !== undefined;
								const marker = isExpanded ? "▾" : hasKnownSessions ? "▸" : "▸";
								return (
									<text key={rowKey(row)} attributes={attrs}>
										{`${chevron} ${marker} ${row.instance.name} [${row.instance.status}] ${basename(row.instance.directory)} (${counts.running}r/${counts.queued}q)`}
									</text>
								);
							}

							const { total, completed } = row.session.progress;
							return (
								<text key={rowKey(row)} attributes={attrs}>
									{`    ${chevron} ${row.session.sessionId}  ${row.session.title}  (${completed}/${total} tasks)`}
								</text>
							);
						})
					)}
				</box>

				<box flexDirection="column" width="45%">
					<text attributes={TextAttributes.BOLD}>
						{focusedInstance
							? focusedSession
								? `Jobs for ${focusedInstance.name} / ${focusedSession.sessionId}`
								: `Jobs for ${focusedInstance.name}`
							: "Jobs"}
					</text>
					{focusedInstance ? (
						focusedSession ? (
							<text attributes={TextAttributes.DIM}>
								No jobs recorded for this session yet.
							</text>
						) : jobsToDisplay.length ? (
							jobsToDisplay.map((job: DaemonJob) => (
								<text key={job.id} attributes={TextAttributes.DIM}>
									{`${job.id.slice(0, 8)} ${job.state} ${job.task.type === "prompt" ? job.task.prompt : ""}`}
								</text>
							))
						) : (
							<text attributes={TextAttributes.DIM}>
								No jobs for the selected instance
							</text>
						)
					) : (
						<text attributes={TextAttributes.DIM}>
							Select an instance to inspect jobs
						</text>
					)}
				</box>
			</box>

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>
					{error ??
						"space: expand/collapse  j/k: move  enter: open  m: model  r: refresh  q: quit"}
				</text>
			</box>
		</box>
	);
}

export function App({ onQuit }: AppProps) {
	const [view, setView] = useState<View>({ type: "dashboard" });

	if (view.type === "chat") {
		return (
			<Chat
				instanceId={view.instanceId}
				instanceName={view.instanceName}
				ralphSessionId={view.ralphSessionId}
				onBack={() => setView({ type: "dashboard" })}
				onQuit={onQuit}
			/>
		);
	}

	return (
		<Dashboard
			onQuit={onQuit}
			onSelectInstance={(instance, ralphSessionId) =>
				setView({
					type: "chat",
					instanceId: instance.id,
					instanceName: instance.name,
					ralphSessionId,
				})
			}
		/>
	);
}
