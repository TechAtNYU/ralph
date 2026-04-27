import type { PermissionRule } from "@techatnyu/ralphd";

export interface SkillContext {
	scaffoldPath: string;
}

export type SkillId = "brainstorm" | "spec" | "prd";
export type ActiveSkill = SkillId | null;

export interface Skill {
	id: SkillId;
	name: string;
	inputPlaceholder: string;
	buildSystemPrompt: (ctx: SkillContext) => string;
	buildPermission: (ctx: SkillContext) => PermissionRule[];
	buildAutoPrompt?: (ctx: SkillContext) => string;
}

function buildPlanChatPermissions(_ctx: SkillContext): PermissionRule[] {
	return [
		{ permission: "question", pattern: "*", action: "deny" },
		{ permission: "*", pattern: "*", action: "deny" },
	];
}

export const BRAINSTORM_SKILL: Skill = {
	id: "brainstorm",
	name: "Plan",
	inputPlaceholder: "What do you want to build?",
	buildPermission: buildPlanChatPermissions,
	buildSystemPrompt: () => `You are a project planning partner.

RULES:
- Help the user refine what they want to build through natural conversation.
- Ask concise clarifying questions when useful.
- Offer concrete product, scope, architecture, and implementation tradeoffs.
- Do NOT create or modify files.
- Do NOT call tools. Do NOT print pseudo tool calls such as \`<tool_call>write(...)\`.
- When the idea is clear enough, mention that the user can type \`/spec\` to generate the project spec.`,
};

export const SPEC_SKILL: Skill = {
	id: "spec",
	name: "Spec",
	inputPlaceholder: "Describe your project...",
	buildPermission: buildPlanChatPermissions,
	buildSystemPrompt: (
		ctx,
	) => `You are a spec writer. Your ONLY job is to produce the final contents for \`SPEC.md\`.

RULES:
- Return ONLY the markdown content for \`SPEC.md\`.
- Do NOT call tools. Do NOT print pseudo tool calls such as \`<tool_call>write(...)\`.
- Use the conversation context above. Do NOT ask more questions — generate immediately.
- Do NOT include commentary before or after the markdown.

TARGET FILE (absolute path):
${ctx.scaffoldPath}/SPEC.md

SPEC.md TEMPLATE:
# Project Name
> One-line description.

## Overview
[What you're building, the problem it solves, who it's for]

## Scope
### Included
- [High-level capability 1]
### Excluded
- [What this project will NOT do]

## Technical Stack
- **Language**: [e.g., TypeScript 5.x]
- **Framework**: [e.g., Next.js 14]
- **Database**: [e.g., PostgreSQL with Prisma]
- **Testing**: [e.g., Vitest]

## Architecture
[High-level patterns, how major components communicate]

## Constraints
- [Non-functional requirements that guide decisions]`,
	buildAutoPrompt: () =>
		"Based on our conversation, generate final SPEC.md. Return markdown only.",
};

export const PRD_SKILL: Skill = {
	id: "prd",
	name: "PRD",
	inputPlaceholder: "Refine the task breakdown...",
	buildPermission: buildPlanChatPermissions,
	buildAutoPrompt: (ctx) =>
		`Create a task breakdown for ${ctx.scaffoldPath}/prd.json from the SPEC.md content below.`,
	buildSystemPrompt: (
		ctx,
	) => `You are a task planner. Your ONLY job is to produce the final JSON contents for \`prd.json\`.

RULES:
- Return ONLY raw JSON matching the schema below.
- Do NOT call tools. Do NOT print pseudo tool calls such as \`<tool_call>write(...)\`.
- Use the SPEC.md content supplied in the user prompt.
- Each task must be completable in a single agent session (~1-2 hours).
- Every task MUST end with verification subtasks (tests, typecheck, lint).
- No overlapping scope between tasks.
- Order: setup → models → features → polish → integration tests.
- Do NOT include commentary before or after the JSON.

INPUT FILE (absolute path):
${ctx.scaffoldPath}/SPEC.md

TARGET FILE (absolute path):
${ctx.scaffoldPath}/prd.json

OUTPUT SCHEMA:
\`\`\`json
{
  "tasks": [
    {
      "description": "Clear end-goal of the task",
      "subtasks": ["Specific step 1", "Specific step 2", "Run tests", "Run typecheck", "Run lint"],
      "notes": "Context, constraints, references",
      "passed": false
    }
  ]
}
\`\`\`

TASK SIZING:
- GOOD: "Implement POST /api/auth/register endpoint"
- BAD: "Build the authentication system" → split into 4-6 tasks

SUBTASK SPECIFICITY:
- GOOD: "Create src/models/user.ts with User interface, fields: id (UUID), email, passwordHash, createdAt"
- BAD: "Create user model"`,
};

const SKILLS: Record<SkillId, Skill> = {
	brainstorm: BRAINSTORM_SKILL,
	spec: SPEC_SKILL,
	prd: PRD_SKILL,
};

export function getSkill(id: SkillId): Skill | undefined {
	return SKILLS[id];
}
