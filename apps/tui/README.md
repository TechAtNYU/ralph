# Ralph TUI + Local Daemon

This app uses a local daemon (`ralphd`) for long-running loop jobs.

End users should normally run `ralph`. The TUI will start `ralphd` when needed.

In local development, run `bun run dev` from the repo root. Turborepo will run
the TUI and daemon together, and the TUI will wait for the foreground daemon
instead of spawning a detached background process.

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
