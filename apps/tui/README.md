# Ralph TUI + Local Daemon

This app now includes a local daemon (`ralphd`) for long-running loop jobs.

## Run the daemon

```bash
bun run daemon
```

The daemon listens on a Unix socket at `~/.ralph/ralphd.sock` and persists state in `~/.ralph/state.json`.

## Control the daemon

```bash
bun run daemon:ctl health
bun run daemon:ctl submit "Draft architecture for local-first daemon"
bun run daemon:ctl list
bun run daemon:ctl get <job-id>
bun run daemon:ctl cancel <job-id>
```

## Run the TUI shell

```bash
bun dev
```
