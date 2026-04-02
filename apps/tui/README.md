# Ralph TUI + Local Daemon

This app talks to the local daemon (`ralphd`) for all runtime work.

End users should normally run `ralph`. The TUI will start `ralphd` when needed in packaged builds.

In local development, run `bun run dev` from the repo root. Turborepo will run
the TUI and daemon together, and the TUI will wait for the foreground daemon
instead of spawning a detached background process.

## Scaffold a workspace

From the `apps/tui` directory, run:

```bash
bun run src/cli.ts init /path/to/project
```

## Advanced daemon control

```bash
bun run src/cli.ts daemon start
bun run src/cli.ts daemon health
bun run src/cli.ts daemon stop
```

The daemon listens on a Unix socket at `~/.ralph/ralphd.sock` and persists state in `~/.ralph/state.json`.

## Run the TUI shell

```bash
bun dev
```
