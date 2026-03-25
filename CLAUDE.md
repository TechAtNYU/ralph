# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
