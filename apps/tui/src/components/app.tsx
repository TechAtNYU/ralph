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
import { ralphStore, setModelAndRecent } from "../lib/store";
import { Chat } from "./chat";

type View =
	| { type: "dashboard" }
	| { type: "chat"; instanceId: string; instanceName: string };

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
	onSelectInstance(instance: ManagedInstance): void;
}) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [data, setData] = useState<DashboardData>();
	const [selectedIndex, setSelectedIndex] = useState(0);
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
				const selected = instanceList.instances[safeIndex];
				const jobs = await daemon.listJobs(
					selected ? { instanceId: selected.id } : {},
				);
				setSelectedIndex(safeIndex);
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
			const selected = data.instances[selectedIndex];
			if (selected) {
				onSelectInstance(selected);
			}
			return;
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
						{selected ? `Jobs for ${selected.name}` : "Jobs"}
					</text>
					{selected ? (
						data?.jobs.length ? (
							data.jobs.map((job: DaemonJob) => (
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
						"j/k or arrows: select  enter: chat  m: model  r: refresh  q: quit"}
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
				onBack={() => setView({ type: "dashboard" })}
				onQuit={onQuit}
			/>
		);
	}

	return (
		<Dashboard
			onQuit={onQuit}
			onSelectInstance={(instance) =>
				setView({
					type: "chat",
					instanceId: instance.id,
					instanceName: instance.name,
				})
			}
		/>
	);
}
