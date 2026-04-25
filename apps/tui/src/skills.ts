import type { PermissionRule } from "@techatnyu/ralphd";

export interface SkillContext {
	scaffoldPath: string;
}

export interface Skill {
	id: string;
	name: string;
	inputPlaceholder: string;
	buildSystemPrompt: (ctx: SkillContext) => string;
	buildPermission: (ctx: SkillContext) => PermissionRule[];
	buildAutoPrompt?: (ctx: SkillContext) => string;
}

export type ActiveSkill = "spec" | "prd" | null;

function buildPlanFilePermissions(ctx: SkillContext): PermissionRule[] {
	return [
		{ permission: "read", pattern: "*", action: "allow" },
		{
			permission: "write",
			pattern: `${ctx.scaffoldPath}/*`,
			action: "allow",
		},
		{ permission: "question", pattern: "*", action: "deny" },
		{ permission: "*", pattern: "*", action: "deny" },
	];
}

export const SPEC_SKILL: Skill = {
	id: "spec",
	name: "Spec",
	inputPlaceholder: "Describe your project...",
	buildPermission: buildPlanFilePermissions,
	buildSystemPrompt: (
		ctx,
	) => `You are a spec writer. Your ONLY job is to create \`SPEC.md\` in the plan workspace by calling the \`write\` tool.

RULES:
- You MUST use the \`write\` tool to create the file. Do NOT emit the spec as text in your response — it must be written via the tool.
- Ask the user 2-3 brief clarifying questions about what they're building, then write the spec. If the description is already clear, skip questions and write immediately.
- Do NOT run shell commands. Do NOT create other files.
- After calling \`write\`, confirm briefly in text ("wrote SPEC.md") and stop.

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
};

export const PRD_SKILL: Skill = {
	id: "prd",
	name: "PRD",
	inputPlaceholder: "Refine the task breakdown...",
	buildPermission: buildPlanFilePermissions,
	buildAutoPrompt: (ctx) =>
		`Read ${ctx.scaffoldPath}/SPEC.md and create a task breakdown. Write it to ${ctx.scaffoldPath}/prd.json using the write tool.`,
	buildSystemPrompt: (
		ctx,
	) => `You are a task planner. Your ONLY job is to read \`SPEC.md\` from the plan workspace and produce \`prd.json\` in the same workspace by calling the \`write\` tool.

RULES:
- You MUST use the \`write\` tool to create the file. Do NOT emit the JSON as text in your response — it must be written via the tool.
- Do NOT run shell commands. Do NOT create other files.
- Each task must be completable in a single agent session (~1-2 hours).
- Every task MUST end with verification subtasks (tests, typecheck, lint).
- No overlapping scope between tasks.
- Order: setup → models → features → polish → integration tests.
- After calling \`write\`, confirm briefly in text ("wrote prd.json") and stop.

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

const SKILLS: Record<string, Skill> = {
	spec: SPEC_SKILL,
	prd: PRD_SKILL,
};

export function getSkill(id: string): Skill | undefined {
	return SKILLS[id];
}
