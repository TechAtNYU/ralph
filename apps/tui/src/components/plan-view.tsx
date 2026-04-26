import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";
import type { usePlanInstance } from "../hooks/use-plan-instance";
import { useSkill } from "../hooks/use-skill";
import { writePrdArtifact, writeSpecArtifact } from "../lib/plan-artifacts";
import type { Skill, SkillContext } from "../skills";
import { ContextSidebar } from "./context-sidebar";
import { PlanChat } from "./plan-chat";
import { TaskOverlay } from "./task-overlay";

const SIDEBAR_MIN_WIDTH = 120;

interface PlanViewProps {
	focused: boolean;
	planData: PlanFilesData;
	daemonOnline: boolean;
	planInstance: ReturnType<typeof usePlanInstance>;
}

async function readSpecForPrompt(scaffoldPath: string): Promise<string> {
	const spec = await readFile(join(scaffoldPath, "SPEC.md"), "utf8");
	const trimmed = spec.trim();
	if (!trimmed) {
		throw new Error("SPEC.md is empty");
	}
	return trimmed;
}

async function buildSkillPrompt(
	skill: Skill,
	ctx: SkillContext,
	prompt: string,
): Promise<string> {
	if (skill.id !== "prd") {
		return prompt;
	}
	const spec = await readSpecForPrompt(ctx.scaffoldPath);
	return `${prompt}

SPEC.md:
\`\`\`markdown
${spec}
\`\`\``;
}

async function writeSkillArtifact(
	skill: Skill,
	ctx: SkillContext,
	content: string,
): Promise<void> {
	if (skill.id === "spec") {
		await writeSpecArtifact(ctx.scaffoldPath, content);
		return;
	}
	if (skill.id === "prd") {
		await writePrdArtifact(ctx.scaffoldPath, content);
	}
}

export function PlanView({
	focused,
	planData,
	daemonOnline,
	planInstance,
}: PlanViewProps) {
	const [showTasks, setShowTasks] = useState(false);
	const { activeSkill, skill, startSkill } = useSkill();
	const { ensure: ensureInstance } = planInstance;
	const ensureInstanceId = useCallback(
		() => ensureInstance().then((h) => h.instanceId),
		[ensureInstance],
	);
	const chat = useChat(ensureInstanceId);
	const { width } = useTerminalDimensions();
	const showSidebar = width >= SIDEBAR_MIN_WIDTH;

	const { hasSpec, hasPrd, tasks, specError, prdError } = planData;
	const prevHasSpec = useRef(hasSpec);
	const prevHasPrd = useRef(hasPrd);
	const prevLoading = useRef(chat.loading);
	const { addSystemMessage, loading: chatLoading } = chat;

	useEffect(() => {
		if (!prevHasSpec.current && hasSpec && activeSkill) {
			addSystemMessage(
				"wrote SPEC.md — type /prd to generate the task breakdown",
			);
		}
		prevHasSpec.current = hasSpec;
	}, [hasSpec, activeSkill, addSystemMessage]);

	useEffect(() => {
		if (!prevHasPrd.current && hasPrd && activeSkill) {
			const n = tasks.length;
			addSystemMessage(
				`wrote prd.json (${n} task${n === 1 ? "" : "s"}) — press Ctrl+T to review, then switch to Execute`,
			);
		}
		prevHasPrd.current = hasPrd;
	}, [hasPrd, tasks.length, activeSkill, addSystemMessage]);

	useEffect(() => {
		const wasLoading = prevLoading.current;
		prevLoading.current = chatLoading;
		if (!wasLoading || chatLoading || !activeSkill) return;

		const target = activeSkill;
		const timeoutId = setTimeout(() => {
			const produced = target === "spec" ? hasSpec : hasPrd;
			if (produced) return;
			const filename = target === "spec" ? "SPEC.md" : "prd.json";
			const err = target === "spec" ? specError : prdError;
			const reason = err
				? `written but invalid (${err}) — review and retry`
				: "not written — check model permissions or retry";
			addSystemMessage(`${filename}: ${reason}`);
		}, 3000);
		return () => clearTimeout(timeoutId);
	}, [
		chatLoading,
		activeSkill,
		hasSpec,
		hasPrd,
		specError,
		prdError,
		addSystemMessage,
	]);

	const { send: chatSend, clear: chatClear } = chat;
	const sendWithSkill = useCallback(
		async (prompt: string) => {
			if (!skill) return;
			const { scaffoldPath } = await ensureInstance();
			const ctx: SkillContext = { scaffoldPath };
			let finalPrompt: string;
			try {
				finalPrompt = await buildSkillPrompt(skill, ctx, prompt);
			} catch (e) {
				addSystemMessage(
					`SPEC.md: ${e instanceof Error ? e.message : "failed to read file"}`,
				);
				return;
			}
			const result = await chatSend({
				prompt: finalPrompt,
				systemPrompt: skill.buildSystemPrompt(ctx),
				permission: skill.buildPermission(ctx),
			});
			if (!result?.content) return;
			try {
				await writeSkillArtifact(skill, ctx, result.content);
			} catch (e) {
				const filename = skill.id === "spec" ? "SPEC.md" : "prd.json";
				const reason =
					e instanceof Error ? e.message : "generated response was invalid";
				addSystemMessage(
					`${filename}: generated response was invalid (${reason})`,
				);
			}
		},
		[skill, ensureInstance, chatSend, addSystemMessage],
	);

	const handleStartSkill = async (id: "spec" | "prd") => {
		const s = startSkill(id);
		chatClear();
		if (!s.buildAutoPrompt) return;
		const { scaffoldPath } = await ensureInstance();
		const ctx: SkillContext = { scaffoldPath };
		let prompt: string;
		try {
			prompt = await buildSkillPrompt(s, ctx, s.buildAutoPrompt(ctx));
		} catch (e) {
			addSystemMessage(
				`SPEC.md: ${e instanceof Error ? e.message : "failed to read file"}`,
			);
			return;
		}
		const result = await chatSend({
			prompt,
			systemPrompt: s.buildSystemPrompt(ctx),
			permission: s.buildPermission(ctx),
		});
		if (!result?.content) return;
		try {
			await writeSkillArtifact(s, ctx, result.content);
		} catch (e) {
			const filename = s.id === "spec" ? "SPEC.md" : "prd.json";
			const reason =
				e instanceof Error ? e.message : "generated response was invalid";
			addSystemMessage(
				`${filename}: generated response was invalid (${reason})`,
			);
		}
	};

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "t" && key.ctrl) {
			setShowTasks((s) => !s);
		}
	});

	const toggleTasks = () => {
		setShowTasks((s) => !s);
	};

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" flexGrow={1}>
				<PlanChat
					focused={focused && !showTasks}
					messages={chat.messages}
					loading={chat.loading}
					error={chat.error ?? planInstance.error}
					daemonOnline={daemonOnline}
					onSendPrompt={sendWithSkill}
					onToggleTasks={toggleTasks}
					onClear={chat.clear}
					onStartSkill={handleStartSkill}
					skill={skill}
				/>

				{showSidebar && (
					<ContextSidebar
						planData={planData}
						messageCount={chat.messages.length}
						activeSkill={activeSkill}
					/>
				)}
			</box>

			{showTasks && planData.hasPrd && (
				<TaskOverlay
					focused={focused && showTasks}
					data={planData}
					onClose={() => setShowTasks(false)}
				/>
			)}
		</box>
	);
}
