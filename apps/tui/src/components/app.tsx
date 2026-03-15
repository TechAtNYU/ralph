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
import { ralphStore } from "../store";

interface DashboardData {
	health: HealthResult;
	instances: ManagedInstance[];
	jobs: DaemonJob[];
}

const MODELS_DEV_URL = "https://models.dev/api.json";

async function fetchModelOptions(): Promise<SelectOption[]> {
	const response = await fetch(MODELS_DEV_URL);
	if (!response.ok) return [];
	const catalog = (await response.json()) as Record<
		string,
		{
			id: string;
			name: string;
			models: Record<string, { id: string; name: string }>;
		}
	>;
	return Object.values(catalog).flatMap((provider) =>
		Object.values(provider.models).map((model) => ({
			name: `${provider.name}/${model.name}`,
			description: `${provider.id}/${model.id}`,
			value: `${provider.id}/${model.id}`,
		})),
	);
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

export function App({ onQuit }: AppProps) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [data, setData] = useState<DashboardData>();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [currentModel, setCurrentModel] = useState("");
	const [modelPicker, setModelPicker] = useState(false);
	const [modelOptions, setModelOptions] = useState<SelectOption[]>([]);

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
			if (key.name === "escape" || key.name === "q") {
				setModelPicker(false);
			}
			return;
		}

		if (key.name === "q") {
			onQuit();
			return;
		}

		if (key.name === "r") {
			void refresh();
			return;
		}

		if (key.name === "m") {
			void fetchModelOptions().then((options) => {
				setModelOptions(options);
				setModelPicker(true);
			});
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
	});

	const selected = data?.instances[selectedIndex];

	if (modelPicker) {
		return (
			<box flexDirection="column" flexGrow={1} padding={1}>
				<box flexDirection="column" marginBottom={1}>
					<text attributes={TextAttributes.BOLD}>Select Model</text>
					<text attributes={TextAttributes.DIM}>
						{`${modelOptions.length} models available — esc: cancel`}
					</text>
				</box>
				<select
					focused
					flexGrow={1}
					options={modelOptions}
					showDescription
					showScrollIndicator
					wrapSelection
					onSelect={(_index, option) => {
						if (option?.value) {
							const modelRef = option.value as string;
							void ralphStore.patch({ model: modelRef }).then(() => {
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
					{error ?? "j/k or arrows: select  m: model  r: refresh  q: quit"}
				</text>
			</box>
		</box>
	);
}
