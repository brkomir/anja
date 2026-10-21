# Git hooks (`.githooks/`)

This project's git hooks live **here**, not in the default `.git/hooks/`. Git only runs
them when `core.hooksPath` points at this directory.

## Wiring — automatic

In the source project `npm install` wires it: the `prepare` script in its `package.json` (not in this copy) runs

```sh
git config core.hooksPath .githooks
```

so a fresh clone is protected the moment you install dependencies. To wire it by hand
(or after a config reset): `git config core.hooksPath .githooks`.

## Why this matters (the silent-dormancy class)

`core.hooksPath` is **per-clone local config** (`.git/config`) — never committed, so it
can drift without a trace (e.g. back to the inert `.git/hooks` default). When it does,
**every gate goes dormant: commits (and, in the source project, pushes) sail through with
zero output.**

## Detection — so it can't recur silently

`scripts/smoke-test-hooks.sh` asserts `core.hooksPath → .githooks` (skipped under `CI`,
where gating is the workflow's job, not local hooks). That suite runs in **`/meta
self-audit` Check 9** (and, in the source project, in its pre-push gate) — so a drift surfaces
at the next self-audit instead of quietly disabling protection.

## Hooks here

- **`pre-commit`** — skill-lint warn-mode marker.

The source project also runs a `pre-push` hook (the hook and enforce-script smoke suite, a
focus-visible block, a column-ACL check, a server-action auth check, an e2e gate). It is tied
to that project's product checks and is not part of this copy.
