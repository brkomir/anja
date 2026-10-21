# Expert Panel Review

The full process spec lives in `.claude/skills/expert-review/SKILL.md`.

This file used to duplicate that spec — it drifted (claimed "23 skills" while 55+ existed,
listed obsolete department buckets, missing `--lean` / `--spot` / `--final-audit` modes).
Replaced with this redirect on 2026-04-14 to prevent future drift.

When the user invokes `/expert-review`, the harness loads the skill spec automatically.
This `.claude/commands/expert-review.md` file is retained only for back-compat with any
external tooling that might enumerate `.claude/commands/`.
