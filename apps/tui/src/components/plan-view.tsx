import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ChatMessage, useChat } from "../hooks/use-chat";
import type { PlanFilesData } from "../hooks/use-plan-files";
import type { usePlanInstance } from "../hooks/use-plan-instance";
import { useSkill } from "../hooks/use-skill";
import { writePrdArtifact, writeSpecArtifact } from "../lib/plan-artifacts";
import type { Skill, SkillContext } from "../skills";
import { ContextSidebar } from "./context-sidebar";
import { PlanChat } from "./plan-chat";
import { SpecOverlay } from "./spec-overlay";
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

export function buildConversationTranscript(messages: ChatMessage[]): string {
	return messages
		.filter((message) => message.role !== "system" && message.content.trim())
		.map((message) => {
			const speaker = message.role === "user" ? "User" : "Ralph";
			return `${speaker}: ${message.content.trim()}`;
		})
		.join("\n\n");
}

export function addTranscriptToPrompt(
	prompt: string,
	messages: ChatMessage[],
): string {
	const transcript = buildConversationTranscript(messages);
	if (!transcript) return prompt;
	return `${prompt}

Conversation transcript:
${transcript}`;
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
	const [showSpec, setShowSpec] = useState(false);
	const { activeSkill, skill, startSkill } = useSkill();
	const { ensure: ensureInstance } = planInstance;
	const ensureInstanceId = useCallback(
		() => ensureInstance().then((h) => h.instanceId),
		[ensureInstance],
	);
	const chat = useChat(ensureInstanceId);
	const { width } = useTerminalDimensions();
	const showSidebar = width >= SIDEBAR_MIN_WIDTH;

	const { hasSpec, hasPrd, specError, prdError } = planData;
	const prevLoading = useRef(chat.loading);
	const brainstormHintShown = useRef(false);
	const { addSystemMessage, loading: chatLoading } = chat;

	useEffect(() => {
		if (!activeSkill) {
			startSkill("brainstorm");
		}
	}, [activeSkill, startSkill]);

	useEffect(() => {
		if (
			activeSkill !== "brainstorm" ||
			chatLoading ||
			brainstormHintShown.current
		) {
			return;
		}
		const hasAssistantReply = chat.messages.some(
			(message) => message.role === "assistant" && message.content.trim(),
		);
		if (!hasAssistantReply) return;

		brainstormHintShown.current = true;
		addSystemMessage("Type /spec when you're ready to generate the spec.");
	}, [activeSkill, chatLoading, chat.messages, addSystemMessage]);

	useEffect(() => {
		const wasLoading = prevLoading.current;
		prevLoading.current = chatLoading;
		if (
			!wasLoading ||
			chatLoading ||
			(activeSkill !== "spec" && activeSkill !== "prd")
		) {
			return;
		}

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
				displayAssistant: skill.id === "brainstorm",
				sessionMode: skill.id === "brainstorm" ? "current" : "ephemeral",
			});
			if (!result?.content) return;
			try {
				await writeSkillArtifact(skill, ctx, result.content);
				if (skill.id === "spec") {
					addSystemMessage(
						"SPEC.md updated. Press Ctrl+S to view. Type /prd when ready.",
					);
				} else if (skill.id === "prd") {
					addSystemMessage(
						"prd.json updated. Press Ctrl+T to review tasks, then switch to Execute.",
					);
				}
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
		if (!s.buildAutoPrompt) return;
		const { scaffoldPath } = await ensureInstance();
		const ctx: SkillContext = { scaffoldPath };
		let prompt: string;
		try {
			const autoPrompt =
				s.id === "spec"
					? addTranscriptToPrompt(s.buildAutoPrompt(ctx), chat.messages)
					: s.buildAutoPrompt(ctx);
			prompt = await buildSkillPrompt(s, ctx, autoPrompt);
		} catch (e) {
			addSystemMessage(
				`SPEC.md: ${e instanceof Error ? e.message : "failed to read file"}`,
			);
			startSkill("brainstorm");
			return;
		}
		const result = await chatSend({
			prompt,
			systemPrompt: s.buildSystemPrompt(ctx),
			permission: s.buildPermission(ctx),
			displayAssistant: false,
			displayUser: false,
			sessionMode: "ephemeral",
		});
		try {
			if (!result?.content) return;
			await writeSkillArtifact(s, ctx, result.content);
			if (s.id === "spec") {
				addSystemMessage(
					"SPEC.md generated. Press Ctrl+S to view. Type /prd when ready.",
				);
			} else {
				addSystemMessage(
					"prd.json generated. Press Ctrl+T to review tasks, then switch to Execute.",
				);
			}
		} catch (e) {
			const filename = s.id === "spec" ? "SPEC.md" : "prd.json";
			const reason =
				e instanceof Error ? e.message : "generated response was invalid";
			addSystemMessage(
				`${filename}: generated response was invalid (${reason})`,
			);
		} finally {
			startSkill("brainstorm");
		}
	};

	useKeyboard((key) => {
		if (!focused) return;
		if (key.name === "t" && key.ctrl) {
			setShowTasks((s) => {
				const next = !s;
				if (next) setShowSpec(false);
				return next;
			});
		}
		if (key.name === "s" && key.ctrl) {
			setShowSpec((s) => {
				const next = !s;
				if (next) setShowTasks(false);
				return next;
			});
		}
	});

	const toggleTasks = () => {
		setShowTasks((s) => {
			const next = !s;
			if (next) setShowSpec(false);
			return next;
		});
	};

	const handleClear = () => {
		brainstormHintShown.current = false;
		chatClear();
		startSkill("brainstorm");
	};

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" flexGrow={1}>
				<PlanChat
					focused={focused && !showTasks && !showSpec}
					messages={chat.messages}
					loading={chat.loading}
					error={chat.error ?? planInstance.error}
					daemonOnline={daemonOnline}
					onSendPrompt={sendWithSkill}
					onToggleTasks={toggleTasks}
					onClear={handleClear}
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

			{showSpec && (
				<SpecOverlay
					focused={focused && showSpec}
					data={planData}
					onClose={() => setShowSpec(false)}
				/>
			)}

			{showTasks && (
				<TaskOverlay
					focused={focused && showTasks}
					data={planData}
					onClose={() => setShowTasks(false)}
				/>
			)}
		</box>
	);
}
