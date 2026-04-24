# Handoff

Last updated: April 24, 2026

## Objective

Ralph is a coding-agent orchestration TUI built around a Plan -> Execute -> Review flow:

1. **Plan**: chat with an agent to produce `SPEC.md` and `prd.json`.
2. **Execute**: read `prd.json`, create isolated task agents, and monitor job progress.
3. **Review**: inspect per-task diffs and approve or reject changes.

The current product focus is the Plan view and the overall structure of that flow. The immediate blocker was OpenCode crashing before Plan-mode messages could get through.

## OpenCode Crash Diagnosis

The OpenCode crash shown in the terminal was:

```text
TypeError: undefined is not an object (evaluating 'n._zod.def')
```

The stack trace pointed into OpenCode's bundled Zod/tool validation code. The local OpenCode plugin at:

```text
~/.config/opencode/plugins/claude-mem.js
```

registered `claude_mem_search` with plain JSON-schema-style args:

```js
args: {
	query: {
		type: "string",
		description: "Search query for memory observations",
	},
}
```

OpenCode `1.14.x` expects plugin tools to be wrapped with `tool(...)` from `@opencode-ai/plugin/tool`, and tool args must be Zod schemas:

```js
import { tool } from "@opencode-ai/plugin/tool";

tool({
	description: "...",
	args: {
		query: tool.schema.string().describe("Search query for memory observations"),
	},
	async execute(args) {
		// ...
	},
});
```

That mismatch explains why OpenCode tried to read `_zod.def` from an object that was not a Zod schema.

## Fix Applied

`~/.config/opencode/plugins/claude-mem.js` was rewritten as a readable ESM plugin that:

- imports `tool` from `@opencode-ai/plugin/tool`;
- wraps `claude_mem_search` in `tool({ ... })`;
- replaces the plain `query` arg object with `tool.schema.string().describe(...)`;
- preserves the existing worker calls, session mapping, hooks, and event behavior.

## Secondary Issues Found

### Stale OpenCode Server On Port 4096

A stale `opencode serve` process was previously listening on port `4096`. Ralph's installed OpenCode SDK defaulted to port `4096`, so a stale server can collide with new daemon/OpenCode runtime startup.

Useful checks:

```bash
lsof -nP -iTCP:4096 -sTCP:LISTEN
ps -p <pid> -o pid,ppid,command
```

Cleanup:

```bash
kill <pid>
```

### Invalid Ralph Model

Ralph's dev config had:

```text
concentrate/kimi-k2-5
```

but OpenCode reported:

```text
Provider not found: concentrate
```

Known-good OpenRouter examples from the local OpenCode setup:

```text
openrouter/anthropic/claude-sonnet-4.5
openrouter/anthropic/claude-haiku-4.5
openrouter/minimax/minimax-m2.7
openrouter/moonshotai/kimi-k2
```

The TUI model store lives at:

```text
~/.config/ralph/config.json
```

To set a valid Ralph model from `apps/tui`:

```bash
bun run src/cli.ts model set openrouter/anthropic/claude-sonnet-4.5
```

## Verification Commands

After patching `claude-mem`, run:

```bash
opencode models openrouter
```

This should no longer crash with `_zod.def`.

Then compare a normal OpenCode run with a pure run:

```bash
opencode /Users/kevinpei/ralph --prompt hi --model openrouter/anthropic/claude-haiku-4.5
opencode /Users/kevinpei/ralph --pure --prompt hi --model openrouter/anthropic/claude-haiku-4.5
```

Finally, start Ralph and verify the Plan chat can submit a message and receive non-empty output:

```bash
cd /Users/kevinpei/ralph/apps/tui
bun run dev
```

## Ralph Plan-View Notes

- `project.md` describes the intended Plan -> Execute -> Review architecture.
- `roadmap.md` is partially stale: it says streaming is missing, but the repo already contains `daemon.streamJob` and TUI hooks consuming it.
- The next Ralph work should focus on making Plan chat reliable against OpenCode, then aligning the Execute flow with `prd.json` task dispatch and worktree isolation.
