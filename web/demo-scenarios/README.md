# Recorded development scenarios

These fixtures are executed by `node scripts/record-dev-scenarios.mjs` before their browser-visible recordings are generated. The recorder uses the failing Python/SQLite process and Node test output directly; it only redacts the local checkout path before rendering public video assets.

- `worktree-mismatch`: an edited checkout and the checkout serving the preview are different.
- `missing-migration`: application code queries a SQLite column before its migration is applied.
- `test-regression`: `Number.parseInt` drops cents and fails a real `node:test` assertion.
