# @techatnyu/ralphd

## 0.1.0

### Minor Changes

- a7b9b2b: Stream messages from daemon to the TUI chat

### Patch Changes

- 6181ce2: Migrate daemon persisted state from `~/.ralph/state.json` to a SQLite
  database at `~/.ralph/state.sqlite`.

  The move enables transactional mutations, WAL-mode crash durability, and
  indexed queries as the daemon scales. Schema is versioned via SQLite's
  `PRAGMA user_version` so future migrations can be additive.

  **Upgrade note:** existing `state.json` files are not migrated automatically.
  On first run after upgrade, the daemon starts with an empty database — you
  will need to re-register any instances and resubmit in-flight jobs. Old
  terminal job history is lost. If preserving state matters to you, hold off
  upgrading until an explicit migration path ships.
