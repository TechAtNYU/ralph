# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Ralph is a coding agent orchestration TUI — a daemon (ralphd) manages OpenCode SDK instances and jobs, while a React-based terminal UI provides interactive monitoring. Built as a Bun monorepo with Turbo.

## Commands

```bash
bun install              # Install dependencies
bun run build            # Build all packages (turbo)
bun run dev              # Start all dev servers
bun run dev:docs         # Start docs site only
bun run test             # Run all tests (bun test)
bun run check            # Biome lint + format check
bun run check:types      # TypeScript type checking
```

### Per-package commands

```bash
cd apps/tui && bun run dev        # Run TUI in dev mode
cd packages/daemon && bun test    # Run daemon tests only
cd apps/docs && bun run dev       # Run docs dev server
```

### Release

```bash
bun run release:build     # Compile binaries for all platforms
bun run release:stage     # Stage distribution for publishing
bun run release:publish   # Publish to npm
bun run release:dry-run   # Test publish without uploading
```

## Architecture

### Monorepo Layout

- `apps/tui/` — Terminal UI app (@techatnyu/ralph), React 19 + @opentui/react
- `apps/docs/` — Documentation site, Fumadocs + TanStack Start + Vite
- `packages/daemon/` — Background daemon (@techatnyu/ralphd), socket-based IPC
- `packages/config/` — Shared TypeScript configuration
- `scripts/` — Release and build automation

### Daemon-Client Architecture

The daemon (ralphd) runs as a background process and communicates with TUI clients via a Unix domain socket (`ralphd.sock`). Key patterns:

- **Protocol-driven**: All requests/responses defined with Zod schemas in `packages/daemon/src/protocol.ts`. Type-safe discriminated unions for all message types.
- **Job lifecycle**: queued → running → succeeded/failed/cancelled. Per-instance concurrency control (default: 4, configurable via `RALPHD_MAX_CONCURRENCY`).
- **Instance management**: `ManagedInstance` tracks OpenCode runtimes with lazy initialization. States: stopped → starting → running → error.
- **State persistence**: JSON file at `~/.ralph/state.json` (or `$RALPH_HOME/state.json`).

### TUI

React components rendered in the terminal via @opentui/react. Real-time job monitoring with keyboard navigation (j/k or arrows). CLI argument parsing via CrustJS.

## Code Style

- **Biome** for linting and formatting: tab indentation, double quotes, import organization
- **TypeScript strict mode**, ES2022 target, bundler module resolution
- Shared base tsconfig in `packages/config/tsconfig.base.json`
- TUI uses `@opentui/react` as JSX import source

## Environment Variables

- `RALPH_HOME` — Base directory (default: `~/.ralph`, dev: `./.ralph-dev`)
- `RALPHD_MAX_CONCURRENCY` — Max concurrent jobs per instance (default: 4)
- `RALPHD_BIN` — Override daemon binary path

## Git Conventions
- Reasonably Commit after every fix.

<claude-mem-context>
# Memory Context

# [ralph] recent context, 2026-04-24 1:27am EDT

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (15,904t read) | 723,567t work | 98% savings

### Apr 22, 2026
S5 Fix OpenCode provider config to resolve empty responses in ralph's plan chat (Apr 22 at 6:11 PM)
S3 Phase-driven plan chat refactor complete — all lint and type checks pass (Apr 22 at 6:11 PM)
S6 Fix OpenCode Zod v3/v4 incompatibility crash by switching to OpenRouter with Claude Sonnet 4 (Apr 22 at 6:54 PM)
S32 Ralph daemon PID 72596 killed (Apr 22 at 6:55 PM)
### Apr 24, 2026
70 1:06a ✅ Daemon SDK Pinned to @opencode-ai/sdk@1.14.22 — Version Mismatch Resolved
71 1:07a 🔴 OpencodeRegistry Provider Model Mapping Fixed for SDK v1.14.22 Capabilities Shape
72 " 🟣 Added normalizeSessionError() and Restored extractText() to Daemon Server
73 1:08a 🔴 Daemon SDK pinned to exact version 1.14.22 — resolving ProviderModelNotFoundError
74 " 🔄 Daemon job completion refactored to session.idle event-driven pattern
75 " 🟣 normalizeSessionError() added for structured OpenCode error handling in daemon
76 " 🔵 Zombie daemon process accumulation pattern identified in Ralph daemon lifecycle
77 1:09a 🔴 Daemon test suite fixed — 37/37 passing after resolveSessionIdle() method added
78 " ✅ Daemon fix changes uncommitted — 16 files modified across TUI and daemon packages
79 " ✅ Daemon package clean — biome formatted, types pass, 37/37 tests green, ready to commit
80 1:10a 🔵 Running daemon uses default RALPH_HOME (~/.ralph), not .ralph-dev — CLI commands need matching RALPH_HOME
81 " 🔵 Daemon PID 42833 survived SIGTERM but died on SIGKILL — opencode subprocess 42834 had already exited
82 " 🔴 Stale active jobs in .ralph-dev/state.json manually cancelled before daemon restart
83 " ✅ Daemon restarted with new code at PID 72596 using RALPH_HOME=.ralph-dev
84 1:11a 🔵 End-to-end live daemon job confirmed working — "RALPH_OK" response in ~3 seconds
85 " 🔵 OpenCode session.idle event flow traced in logs — confirms exact trigger sequence for daemon job completion
86 " ✅ Daemon fixes committed to feat/plan-view as "Fix daemon completion with current OpenCode SDK"
87 1:13a ✅ Ralph daemon PID 72596 killed
88 1:14a 🔴 Daemon OpencodeSessionClient prompt() return type made optional
89 " 🔴 Daemon server.ts null-safe access for prompt response fields
90 " 🔵 use-chat.ts streaming job event loop pattern
91 1:15a 🟣 use-chat.ts handles failed job state in done event
92 " 🔴 use-chat.ts updateLastMessage wrapped in useCallback to fix lint exhaustive-deps
93 " 🔵 Biome exhaustive-deps persists after useCallback wrap — dep array also needs updating
94 " 🔴 use-chat.ts send dep array updated to include updateLastMessage
95 " ✅ Daemon restarted after null-safety and use-chat fixes — clean state confirmed
96 1:16a ✅ Daemon restarted with updated null-safety code — PID 93736
97 " 🔄 use-chat.ts fully refactored — polling replaced with streaming, ChatMode removed
98 " 🔵 Ralph TUI — 20 modified files and 6 new files uncommitted as of Apr 24 1:16am
100 1:17a ✅ Daemon null-safety fix committed — "Handle missing OpenCode prompt info" (30813fa)
101 1:18a 🔵 Ralph Daemon and OpenCode Processes Still Running After Kill Attempt
S39 Ralph Daemon and OpenCode Processes Still Running After Kill Attempt (Apr 24 at 1:18 AM)
102 1:20a 🔵 ProviderModelNotFoundError resurfaces in share-next subscriber — not blocking main execution
103 1:21a 🔵 Job stuck in running state after daemon restart mid-execution — idle event lost
104 " 🔵 SPEC system prompt confirmed wired into TUI job submission
105 1:22a 🔴 Daemon server.ts: fast-fail when OpenCode returns no message data and fail empty-output jobs
106 " 🔵 opencode/minimax-m2.5-free confirmed working as alternative free model
107 " ✅ Daemon test suite passes 37/37 after server.ts fast-fail and empty-output-fail fixes
108 " 🔴 Default model switched to opencode/minimax-m2.5-free to avoid ProviderModelNotFoundError
109 1:23a ✅ End-to-end smoke test passed with opencode/minimax-m2.5-free — DEV_OK confirmed
110 " ✅ Committed "Fail empty OpenCode prompt responses" — 80d50b7 on feat/plan-view
111 1:24a 🔵 TUI CLI missing "daemon status" and "model current" subcommands
112 1:25a 🔵 state.json confirms original "response.info.id" TypeError bug before null-safety fix
113 " 🔵 plan-chat.tsx architecture — file picker, slash commands, phase-aware system prompt
114 " 🔵 chat.tsx has independent daemon streaming — separate from use-chat.ts hook
115 " 🔵 Ralph TUI CLI full command surface — daemon and model subcommands mapped
116 1:26a 🔵 Daemon instance stops on restart — requires manual "daemon instance start" to resume
117 " 🔵 CLI "daemon submit" reads model from ralphStore via parseModelRef() — SMOKE_OK confirmed
118 1:27a 🔵 TUI development server confirmed running alongside daemon — full dev stack active
119 " 🔵 TUI dev process uses relative RALPH_HOME — OPENROUTER/OPENAI keys not inherited
120 " 🔵 Daemon client protocol architecture — Unix socket, newline-delimited JSON, Zod v4 schemas

Access 724k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>