import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type {
	DaemonJob,
	HealthResult,
	ManagedInstance,
} from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useState } from "react";
import type { PlanFilesData } from "../hooks/use-plan-files";

interface DashboardData {
	health: HealthResult;
	instances: ManagedInstance[];
	jobs: DaemonJob[];
}

interface ExecuteViewProps {
	focused: boolean;
	planData: PlanFilesData;
	onOpenChat: (instanceId: string, instanceName: string) => void;
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

function statusColor(status: string): string {
	if (status === "running") return "green";
	if (status === "error") return "red";
	return "#666666";
}

function jobStateColor(state: string): string {
	if (state === "running") return "cyan";
	if (state === "succeeded") return "green";
	if (state === "failed") return "red";
	return "#888888";
}

export function ExecuteView({
	focused,
	planData,
	onOpenChat,
}: ExecuteViewProps) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [data, setData] = useState<DashboardData>();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [starting, setStarting] = useState(false);
	const [startMessage, setStartMessage] = useState<string>();

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

	const handleStart = useCallback(async () => {
		if (starting) return;
		setStarting(true);
		setStartMessage(undefined);
		setError(undefined);
		try {
			const cwd = process.cwd();
			const promptPath = join(cwd, ".ralph", "PROMPT.md");
			const promptContent = (await readFile(promptPath, "utf-8")).trim();
			if (!promptContent) {
				throw new Error("PROMPT.md is empty");
			}

			const { instances } = await daemon.listInstances();
			let instance = instances.find((i) => i.directory === cwd);
			if (!instance) {
				const created = await daemon.createInstance({
					name: "execute",
					directory: cwd,
				});
				instance = created.instance;
			}

			await daemon.submitJob({
				instanceId: instance.id,
				session: { type: "new" },
				task: {
					type: "prompt",
					prompt: promptContent,
				},
			});

			setStartMessage("Job submitted");
			await refresh();
		} catch (startError) {
			setError(
				startError instanceof Error
					? startError.message
					: "Failed to start execution",
			);
		} finally {
			setStarting(false);
		}
	}, [refresh, starting]);

	useKeyboard((key) => {
		if (!focused) return;

		if (key.name === "r") {
			void refresh();
			return;
		}

		if (key.name === "s" && planData.hasPrompt && !starting) {
			void handleStart();
			return;
		}

		if (!data) return;

		if (key.name === "return") {
			const instance = data.instances[selectedIndex];
			if (instance) {
				onOpenChat(instance.id, instance.name);
			}
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
	const planReady = planData.hasPrompt;

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="column" marginBottom={1}>
				<text attributes={TextAttributes.BOLD}>
					{loading
						? "Refreshing..."
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

			<box flexDirection="row" height={1} marginBottom={1}>
				{starting ? (
					<text fg="cyan">Starting execution...</text>
				) : planReady ? (
					<>
						<text fg="green">Plan ready</text>
						<text attributes={TextAttributes.DIM}>
							{"  Press [s] to start execution"}
						</text>
					</>
				) : (
					<text attributes={TextAttributes.DIM}>
						Complete spec, prd, and prompt in Plan view to enable execution
					</text>
				)}
				<box flexGrow={1} />
				{startMessage && !error && <text fg="green">{startMessage}</text>}
				{error && <text fg="red">{error}</text>}
			</box>

			<box flexDirection="row" flexGrow={1} gap={3}>
				<box flexDirection="column" width="45%">
					<text attributes={TextAttributes.BOLD}>Instances</text>
					<text fg="#555555">{"─".repeat(20)}</text>
					{data?.instances.length ? (
						data.instances.map((instance: ManagedInstance, index: number) => {
							const isSelected = index === selectedIndex;
							const counts = countJobsByState(data.jobs, instance.id);
							return (
								<box key={instance.id} flexDirection="row" height={1}>
									<text fg={statusColor(instance.status)}>{"● "}</text>
									<text
										fg={isSelected ? "white" : "#aaaaaa"}
										attributes={isSelected ? TextAttributes.BOLD : undefined}
									>
										{instance.name}
									</text>
									<box flexGrow={1} />
									<text attributes={TextAttributes.DIM}>
										{`${instance.status}  ${counts.running}r/${counts.queued}q`}
									</text>
								</box>
							);
						})
					) : (
						<text attributes={TextAttributes.DIM}>No instances registered</text>
					)}
				</box>

				<box flexDirection="column" width="55%">
					<text attributes={TextAttributes.BOLD}>
						{selected ? `Jobs for "${selected.name}"` : "Jobs"}
					</text>
					<text fg="#555555">{"─".repeat(30)}</text>
					{selected ? (
						data?.jobs.length ? (
							<scrollbox flexGrow={1} minHeight={0}>
								{data.jobs.map((job: DaemonJob) => (
									<box key={job.id} flexDirection="row" height={1}>
										<text fg={jobStateColor(job.state)}>
											{job.id.slice(0, 8)}
										</text>
										<text attributes={TextAttributes.DIM}>
											{`  ${job.state}  `}
										</text>
										<text fg="#aaaaaa">
											{job.task.type === "prompt"
												? job.task.prompt.slice(0, 40)
												: ""}
										</text>
									</box>
								))}
							</scrollbox>
						) : (
							<text attributes={TextAttributes.DIM}>
								No jobs for this instance
							</text>
						)
					) : (
						<text attributes={TextAttributes.DIM}>
							Select an instance to see jobs
						</text>
					)}
				</box>
			</box>
		</box>
	);
}
