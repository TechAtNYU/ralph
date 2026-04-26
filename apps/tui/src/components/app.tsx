import { basename } from "node:path";
import { type SelectOption, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type {
	DaemonJob,
	DaemonSession,
	HealthResult,
	ManagedInstance,
} from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useState } from "react";
import { ralphStore, setModelAndRecent } from "../lib/store";
import { Chat } from "./chat";

type View =
	| { type: "dashboard" }
	| {
			type: "chat";
			instanceId: string;
			instanceName: string;
			sessionId: string | null;
	  };

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

function clampIndex(index: number, length: number): number {
	if (length <= 0) {
		return 0;
	}
	return Math.min(Math.max(index, 0), length - 1);
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

function Dashboard({
	onQuit,
	onSelectInstance,
}: {
	onQuit(): void;
	onSelectInstance(
		instance: ManagedInstance,
		session: DaemonSession | null,
	): void;
}) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [data, setData] = useState<DashboardData>();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [sessions, setSessions] = useState<DaemonSession[]>([]);
	const [selectedSessionIndex, setSelectedSessionIndex] = useState(0);
	const [focusPanel, setFocusPanel] = useState<"instances" | "sessions">(
		"instances",
	);
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
		async (nextIndex = selectedIndex) => {
			setLoading(true);
			setError(undefined);
			try {
				const [health, instanceList, storeState] = await Promise.all([
					daemon.health(),
					daemon.listInstances(),
					ralphStore.read(),
				]);
				setCurrentModel(storeState.model);
				const safeIndex = clampIndex(nextIndex, instanceList.instances.length);
				const selectedInst = instanceList.instances[safeIndex];
				const [jobs, sessionResult] = await Promise.all([
					daemon.listJobs(selectedInst ? { instanceId: selectedInst.id } : {}),
					// If the selected instance was removed between `listInstances`
					// and this call, the daemon now throws `not_found` instead of
					// returning an empty list. Swallow that narrow race so the
					// whole refresh doesn't fail.
					selectedInst
						? daemon
								.listSessions(selectedInst.id)
								.catch(() => ({ sessions: [] }))
						: Promise.resolve({ sessions: [] }),
				]);
				setSelectedIndex(safeIndex);
				setSessions(sessionResult.sessions);
				setSelectedSessionIndex(0);
				setData({
					health,
					instances: instanceList.instances,
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
		[selectedIndex],
	);

	useEffect(() => {
		void refresh();
	}, [refresh]);

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

		if (!data) {
			return;
		}

		if (key.name === "tab" || key.name === "l" || key.name === "right") {
			if (focusPanel === "instances" && sessions.length > 0) {
				setFocusPanel("sessions");
			}
			return;
		}

		if (key.name === "h" || key.name === "left") {
			if (focusPanel === "sessions") {
				setFocusPanel("instances");
			}
			return;
		}

		if (focusPanel === "instances") {
			if (key.name === "down" || key.name === "j") {
				const next = clampIndex(selectedIndex + 1, data.instances.length);
				void refresh(next);
				return;
			}

			if (key.name === "up" || key.name === "k") {
				const next = clampIndex(selectedIndex - 1, data.instances.length);
				void refresh(next);
				return;
			}

			if (key.name === "return") {
				const inst = data.instances[selectedIndex];
				if (inst) {
					onSelectInstance(inst, null);
				}
				return;
			}
		}

		if (focusPanel === "sessions") {
			if (key.name === "down" || key.name === "j") {
				setSelectedSessionIndex((prev) =>
					clampIndex(prev + 1, sessions.length + 1),
				);
				return;
			}

			if (key.name === "up" || key.name === "k") {
				setSelectedSessionIndex((prev) =>
					clampIndex(prev - 1, sessions.length + 1),
				);
				return;
			}

			if (key.name === "return") {
				const inst = data.instances[selectedIndex];
				if (!inst) return;

				// Index 0 is "New Chat", rest are sessions
				if (selectedSessionIndex === 0) {
					onSelectInstance(inst, null);
				} else {
					const session = sessions[selectedSessionIndex - 1];
					if (session) {
						onSelectInstance(inst, session);
					}
				}
				return;
			}

			if (key.name === "escape") {
				setFocusPanel("instances");
				return;
			}
		}
	});

	const selected = data?.instances[selectedIndex];

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
					{data?.instances.length ? (
						data.instances.map((instance: ManagedInstance, index: number) => {
							const focused = index === selectedIndex;
							const counts = countJobsByState(data.jobs, instance.id);
							return (
								<text
									key={instance.id}
									attributes={
										focused ? TextAttributes.BOLD : TextAttributes.DIM
									}
								>
									{`${focused ? ">" : " "} ${instance.name} [${instance.status}] ${basename(instance.directory)} (${counts.running}r/${counts.queued}q)`}
								</text>
							);
						})
					) : (
						<text attributes={TextAttributes.DIM}>No instances registered</text>
					)}
				</box>

				<box flexDirection="column" width="45%">
					<text attributes={TextAttributes.BOLD}>
						{selected ? `Sessions for ${selected.name}` : "Sessions"}
					</text>
					{selected ? (
						<>
							<text
								attributes={
									focusPanel === "sessions" && selectedSessionIndex === 0
										? TextAttributes.BOLD
										: TextAttributes.DIM
								}
							>
								{`${focusPanel === "sessions" && selectedSessionIndex === 0 ? ">" : " "} + New Chat`}
							</text>
							{sessions.length > 0 ? (
								sessions.map((session: DaemonSession, index: number) => {
									const focused =
										focusPanel === "sessions" &&
										index === selectedSessionIndex - 1;
									return (
										<text
											key={session.id}
											attributes={
												focused ? TextAttributes.BOLD : TextAttributes.DIM
											}
										>
											{`${focused ? ">" : " "} ${session.title}`}
										</text>
									);
								})
							) : (
								<text attributes={TextAttributes.DIM}>
									No sessions yet — press enter to start
								</text>
							)}
						</>
					) : (
						<text attributes={TextAttributes.DIM}>
							Select an instance to see sessions
						</text>
					)}
				</box>
			</box>

			<box flexDirection="column" marginTop={1}>
				<text attributes={TextAttributes.DIM}>
					{error ??
						"j/k: select  tab/h/l: switch panel  enter: open  m: model  r: refresh  q: quit"}
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
				sessionId={view.sessionId}
				onBack={() => setView({ type: "dashboard" })}
				onQuit={onQuit}
			/>
		);
	}

	return (
		<Dashboard
			onQuit={onQuit}
			onSelectInstance={(instance, session) =>
				setView({
					type: "chat",
					instanceId: instance.id,
					instanceName: instance.name,
					sessionId: session?.id ?? null,
				})
			}
		/>
	);
}
