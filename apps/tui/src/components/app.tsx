import { basename } from "node:path";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type {
	DaemonJob,
	HealthResult,
	ManagedInstance,
} from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useState } from "react";

interface DashboardData {
	health: HealthResult;
	instances: ManagedInstance[];
	jobs: DaemonJob[];
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

	const refresh = useCallback(
		async (nextIndex = selectedIndex) => {
			setLoading(true);
			setError(undefined);
			try {
				const [health, instanceList] = await Promise.all([
					daemon.health(),
					daemon.listInstances(),
				]);
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
		if (key.name === "q") {
			onQuit();
			return;
		}

		if (key.name === "r") {
			void refresh();
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
						? `${data.health.running} running, ${data.health.queued} queued`
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
					{error ?? "j/k or arrows: select  r: refresh  q: quit"}
				</text>
			</box>
		</box>
	);
}
