import { basename } from "node:path";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type {
	DaemonJob,
	HealthResult,
	ManagedInstance,
} from "@techatnyu/ralphd";
import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanFilesData } from "../hooks/use-plan-files";
import type { usePlanInstance } from "../hooks/use-plan-instance";
import {
	buildExecuteViewModel,
	type ExecuteTaskRow,
	type ExecuteTaskStatus,
} from "../lib/execute-view-model";
import {
	advanceExecutionLoop,
	getActiveAttempt,
	type LoopState,
	loadLoopState,
	markActiveAttemptCancelled,
	markLoopPaused,
} from "../lib/execution-loop";
import { buildProjectStorePaths } from "../lib/project-store";

interface DashboardData {
	health: HealthResult;
	instances: ManagedInstance[];
	jobs: DaemonJob[];
	projectRoot: string;
}

interface ExecuteViewProps {
	focused: boolean;
	planData: PlanFilesData;
	planInstance: ReturnType<typeof usePlanInstance>;
	onPlanRefresh: () => Promise<void>;
	onOpenChat: (
		instanceId: string,
		instanceName: string,
		sessionId?: string | null,
	) => void;
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

function instanceStatusColor(status: string): string {
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

function loopStatusColor(status?: string): string {
	if (status === "running") return "cyan";
	if (status === "completed") return "green";
	if (status === "needs_attention") return "yellow";
	if (status === "paused") return "#aaaaaa";
	return "#888888";
}

function taskStatusColor(status: ExecuteTaskStatus): string {
	if (status === "running" || status === "queued") return "cyan";
	if (status === "verified") return "green";
	if (status === "warning" || status === "needs_attention") return "yellow";
	if (status === "failed" || status === "cancelled") return "red";
	return "#777777";
}

function taskMarker(status: ExecuteTaskStatus): string {
	if (status === "verified") return "ok";
	if (status === "warning") return "warn";
	if (status === "running") return "run";
	if (status === "queued") return "queue";
	if (status === "needs_attention") return "need";
	if (status === "failed") return "fail";
	if (status === "cancelled") return "cancel";
	return "todo";
}

function truncateText(text: string, maxLength: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	if (maxLength <= 3) return normalized.slice(0, maxLength);
	return `${normalized.slice(0, maxLength - 3)}...`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ExecuteView({
	focused,
	planData,
	planInstance,
	onPlanRefresh,
	onOpenChat,
}: ExecuteViewProps) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [data, setData] = useState<DashboardData>();
	const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
	const [showDebug, setShowDebug] = useState(false);
	const [starting, setStarting] = useState(false);
	const [startMessage, setStartMessage] = useState<string>();
	const [loopState, setLoopState] = useState<LoopState>();
	const loopRunningRef = useRef(false);
	const { ensure } = planInstance;

	const refresh = useCallback(
		async (nextTaskIndex = selectedTaskIndex) => {
			setLoading(true);
			setError(undefined);
			try {
				const handle = await ensure();
				const [health, instanceList] = await Promise.all([
					daemon.health(),
					daemon.listInstances(),
				]);
				const [jobs, state] = await Promise.all([
					daemon.listJobs({}),
					loadLoopState(buildProjectStorePaths(handle.projectRoot)),
				]);
				setSelectedTaskIndex(clampIndex(nextTaskIndex, planData.tasks.length));
				setLoopState(state);
				setData({
					health,
					instances: instanceList.instances,
					jobs: jobs.jobs,
					projectRoot: handle.projectRoot,
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
		[selectedTaskIndex, ensure, planData.tasks.length],
	);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const handleStart = useCallback(async () => {
		if (loopRunningRef.current) {
			setStartMessage("Loop already running");
			return;
		}
		if (starting || !planData.hasPrd || planData.tasks.length === 0) return;
		setStarting(true);
		loopRunningRef.current = true;
		setStartMessage(undefined);
		setError(undefined);
		try {
			const handle = await ensure();
			const paths = buildProjectStorePaths(handle.projectRoot);

			while (loopRunningRef.current) {
				const result = await advanceExecutionLoop({
					paths,
					daemonClient: daemon,
				});
				setLoopState(result.state);
				setStartMessage(result.message);
				await onPlanRefresh();
				await refresh();

				if (result.action === "completed" || result.action === "paused") {
					break;
				}

				if (result.action === "verified") {
					continue;
				}

				await sleep(result.action === "monitoring" ? 2000 : 1000);
			}
		} catch (startError) {
			setError(
				startError instanceof Error
					? startError.message
					: "Failed to start execution",
			);
		} finally {
			loopRunningRef.current = false;
			setStarting(false);
		}
	}, [
		ensure,
		onPlanRefresh,
		refresh,
		starting,
		planData.hasPrd,
		planData.tasks.length,
	]);

	const handleCancel = useCallback(async () => {
		setError(undefined);
		try {
			loopRunningRef.current = false;
			const handle = await ensure();
			const paths = buildProjectStorePaths(handle.projectRoot);
			const state = await loadLoopState(paths);
			const active = getActiveAttempt(state);
			if (active?.jobId) {
				await daemon.cancelJob(active.jobId);
			}
			const next = await markActiveAttemptCancelled(paths);
			setLoopState(next);
			setStartMessage("Loop cancelled");
			await onPlanRefresh();
			await refresh();
		} catch (cancelError) {
			setError(
				cancelError instanceof Error
					? cancelError.message
					: "Failed to cancel execution",
			);
		} finally {
			setStarting(false);
		}
	}, [ensure, onPlanRefresh, refresh]);

	const handlePause = useCallback(async () => {
		setError(undefined);
		try {
			loopRunningRef.current = false;
			const handle = await ensure();
			const paths = buildProjectStorePaths(handle.projectRoot);
			const next = await markLoopPaused(paths);
			setLoopState(next);
			setStartMessage("Loop paused");
			await onPlanRefresh();
			await refresh();
		} catch (pauseError) {
			setError(
				pauseError instanceof Error
					? pauseError.message
					: "Failed to pause execution",
			);
		} finally {
			setStarting(false);
		}
	}, [ensure, onPlanRefresh, refresh]);

	useKeyboard((key) => {
		if (!focused) return;

		if (key.name === "r") {
			void Promise.all([refresh(), onPlanRefresh()]);
			return;
		}

		if (key.name === "s" && planData.hasPrd) {
			void handleStart();
			return;
		}

		if (key.name === "c") {
			void handleCancel();
			return;
		}

		if (key.name === "p") {
			void handlePause();
			return;
		}

		if (key.name === "d") {
			setShowDebug((current) => !current);
			return;
		}

		const taskRows = buildExecuteViewModel({
			tasks: planData.tasks,
			progress: planData.progress,
			loopState,
			jobs: data?.jobs,
		}).rows;

		if (key.name === "return") {
			const selectedRow = taskRows[selectedTaskIndex];
			if (!selectedRow?.sessionId) {
				setStartMessage("Selected task has no session");
				return;
			}
			const instance =
				data?.instances.find(
					(candidate) => candidate.id === selectedRow.job?.instanceId,
				) ??
				data?.instances.find(
					(candidate) => candidate.directory === data.projectRoot,
				);
			if (!instance) {
				setStartMessage("Selected task has no instance");
				return;
			}
			onOpenChat(instance.id, instance.name, selectedRow.sessionId);
			return;
		}

		if (key.name === "down" || key.name === "j") {
			const next = clampIndex(selectedTaskIndex + 1, planData.tasks.length);
			setSelectedTaskIndex(next);
			void refresh(next);
			return;
		}

		if (key.name === "up" || key.name === "k") {
			const next = clampIndex(selectedTaskIndex - 1, planData.tasks.length);
			setSelectedTaskIndex(next);
			void refresh(next);
			return;
		}
	});

	const planReady = planData.hasPrd && planData.tasks.length > 0;
	const viewModel = buildExecuteViewModel({
		tasks: planData.tasks,
		progress: planData.progress,
		loopState,
		jobs: data?.jobs,
	});
	const selectedRow =
		viewModel.rows[clampIndex(selectedTaskIndex, viewModel.rows.length)] ??
		viewModel.rows[0];
	const projectRoot = data?.projectRoot ?? planInstance.projectRoot ?? "";
	const projectName = projectRoot ? basename(projectRoot) : "project";
	const currentTaskLabel =
		viewModel.currentTaskIndex !== undefined && viewModel.totalTasks > 0
			? `${viewModel.currentTaskIndex + 1}/${viewModel.totalTasks}`
			: `${viewModel.completedTasks}/${viewModel.totalTasks}`;
	const activeJobId =
		viewModel.activeJob?.id ?? viewModel.activeAttempt?.jobId ?? undefined;
	const projectInstance = data?.instances.find(
		(instance) => instance.directory === projectRoot,
	);
	const selectedInstance =
		(selectedRow?.job?.instanceId
			? data?.instances.find(
					(instance) => instance.id === selectedRow.job?.instanceId,
				)
			: undefined) ?? projectInstance;

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="column" marginBottom={1}>
				<box flexDirection="row" height={1}>
					<text
						attributes={TextAttributes.BOLD}
					>{`Project ${projectName}`}</text>
					{projectRoot && (
						<text attributes={TextAttributes.DIM}>
							{`  ${truncateText(projectRoot, 64)}`}
						</text>
					)}
					<box flexGrow={1} />
					<text fg={data ? "green" : "red"}>
						{loading
							? "refreshing"
							: data
								? `daemon online pid ${data.health.pid}`
								: "daemon offline"}
					</text>
				</box>
				<box flexDirection="row" height={1}>
					<text fg={loopStatusColor(viewModel.status)}>
						{`Loop ${viewModel.status}`}
					</text>
					{planReady && (
						<text attributes={TextAttributes.DIM}>
							{`  task ${currentTaskLabel}  ${viewModel.completedTasks}/${viewModel.totalTasks} done`}
						</text>
					)}
					{activeJobId && (
						<text attributes={TextAttributes.DIM}>
							{`  job ${activeJobId.slice(0, 8)}`}
						</text>
					)}
					<box flexGrow={1} />
					{startMessage && !error && <text fg="green">{startMessage}</text>}
					{error && <text fg="red">{error}</text>}
				</box>
			</box>

			<box flexDirection="column" marginBottom={1}>
				{viewModel.blockingMessage && !error && (
					<text fg="yellow">
						{truncateText(viewModel.blockingMessage, 120)}
					</text>
				)}
				{!viewModel.blockingMessage && viewModel.latestWarning && !error && (
					<text fg="yellow">{viewModel.latestWarning}</text>
				)}
			</box>

			<box flexDirection="row" height={1} marginBottom={1}>
				{starting ? (
					<text fg="cyan">Execution loop running...</text>
				) : planReady ? (
					<>
						<text fg="green">Plan ready</text>
						<text attributes={TextAttributes.DIM}>
							{"  [s] start/resume  [p] pause  [c] cancel  [d] daemon details"}
						</text>
					</>
				) : (
					<text attributes={TextAttributes.DIM}>
						Complete spec and prd in Plan view to enable execution
					</text>
				)}
			</box>

			<box flexDirection="row" flexGrow={1} gap={3}>
				<box flexDirection="column" width="62%">
					<text attributes={TextAttributes.BOLD}>Tasks</text>
					<text fg="#555555">{"─".repeat(56)}</text>
					{viewModel.rows.length ? (
						<scrollbox flexGrow={1} minHeight={0}>
							{viewModel.rows.map((row: ExecuteTaskRow) => {
								const isSelected = row.index === selectedRow?.index;
								const warningOrError = row.errors.length
									? "!"
									: row.warnings.length
										? "~"
										: " ";
								return (
									<box key={row.index} flexDirection="row" height={1}>
										<text fg={isSelected ? "white" : "#666666"}>
											{isSelected ? "> " : "  "}
										</text>
										<text fg="#888888">
											{String(row.index + 1).padStart(2, "0")}
										</text>
										<text fg={taskStatusColor(row.status)}>
											{` ${taskMarker(row.status).padEnd(6)}`}
										</text>
										<text
											fg={isSelected ? "white" : "#aaaaaa"}
											attributes={isSelected ? TextAttributes.BOLD : undefined}
										>
											{truncateText(row.description, 48)}
										</text>
										<box flexGrow={1} />
										<text attributes={TextAttributes.DIM}>
											{row.attemptCount ? `a${row.attemptCount}` : "  "}
										</text>
										<text attributes={TextAttributes.DIM}>
											{row.jobId ? `  ${row.jobId.slice(0, 8)}` : "          "}
										</text>
										<text fg={row.errors.length ? "red" : "yellow"}>
											{warningOrError}
										</text>
									</box>
								);
							})}
						</scrollbox>
					) : (
						<text attributes={TextAttributes.DIM}>No PRD tasks ready yet</text>
					)}
				</box>

				<box flexDirection="column" width="38%">
					<text attributes={TextAttributes.BOLD}>Task Detail</text>
					<text fg="#555555">{"─".repeat(34)}</text>
					{selectedRow ? (
						<box flexDirection="column" flexGrow={1}>
							<text fg={taskStatusColor(selectedRow.status)}>
								{`Task ${selectedRow.index + 1}: ${selectedRow.statusText}`}
							</text>
							<text fg="#aaaaaa">
								{truncateText(selectedRow.description, 44)}
							</text>
							<text attributes={TextAttributes.DIM}>
								{`attempts ${selectedRow.attemptCount || 0}`}
							</text>
							{selectedRow.jobId && (
								<text attributes={TextAttributes.DIM}>
									{`job ${selectedRow.jobId}`}
								</text>
							)}
							{selectedRow.sessionId && (
								<text attributes={TextAttributes.DIM}>
									{`session ${selectedRow.sessionId}`}
								</text>
							)}
							{selectedInstance && (
								<text attributes={TextAttributes.DIM}>
									{`instance ${selectedInstance.name}`}
								</text>
							)}
							{selectedRow.errors.length > 0 && (
								<box flexDirection="column" marginTop={1}>
									<text fg="red">Verification errors</text>
									{selectedRow.errors.map((message) => (
										<text key={message} fg="red">
											{truncateText(message, 46)}
										</text>
									))}
								</box>
							)}
							{selectedRow.warnings.length > 0 && (
								<box flexDirection="column" marginTop={1}>
									<text fg="yellow">Warnings</text>
									{selectedRow.warnings.map((message) => (
										<text key={message} fg="yellow">
											{truncateText(message, 46)}
										</text>
									))}
								</box>
							)}
							<box flexDirection="column" marginTop={1}>
								<text attributes={TextAttributes.BOLD}>Progress</text>
								<text fg="#aaaaaa">
									{selectedRow.progressEntry
										? truncateText(selectedRow.progressEntry, 120)
										: "No progress entry for this task yet"}
								</text>
							</box>
							{showDebug && data && (
								<box flexDirection="column" marginTop={1}>
									<text attributes={TextAttributes.BOLD}>Daemon Details</text>
									{data.instances.map((instance) => {
										const counts = countJobsByState(data.jobs, instance.id);
										return (
											<text
												key={instance.id}
												fg={instanceStatusColor(instance.status)}
											>
												{`${instance.name} ${instance.status} ${counts.running}r/${counts.queued}q`}
											</text>
										);
									})}
									{selectedRow.job && (
										<text fg={jobStateColor(selectedRow.job.state)}>
											{`selected job ${selectedRow.job.state}`}
										</text>
									)}
								</box>
							)}
						</box>
					) : (
						<text attributes={TextAttributes.DIM}>
							Select a task to inspect execution details
						</text>
					)}
				</box>
			</box>
		</box>
	);
}
