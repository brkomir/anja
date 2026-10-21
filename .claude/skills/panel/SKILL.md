---
name: panel
description: Alias for /expert-review — orchestrate a multi-expert panel on any topic. Use when the user types /panel; routes to the expert-review spec, which owns every mode, flag and synthesis rule.
---

# /panel — alias → `/expert-review`

**`/panel` is a small addition to `/expert-review`: an alias for it.** The panel IS the thing the command produces, and `/panel` is what it gets called in conversation; the alias closes the gap between the spoken name and the typed one.

**Execute the `/expert-review` spec** at `.claude/skills/expert-review/SKILL.md` with whatever followed `/panel`, flags included — `/panel --lean <topic>` runs exactly as `/expert-review --lean <topic>`, `/panel --code --last 3` exactly as `/expert-review --code --last 3`. Every mode, the sizing FLOOR, the panel-composition rules, the synthesis format and the anti-scope live in that file. **Do not duplicate any of it here** — this stub exists precisely so there is nothing to drift.

⛔ **THIS IS A LIVE ALIAS, NOT A DEPRECATION.** `.claude/commands/expert-audit.md` is the other alias in this repo and it reads *"retire this stub once the old name falls out of use"* — that is a RENAME being wound down, and copying its framing here would invert this one's purpose. Both names stay; neither is preferred.

**Why a skill stub and not `.claude/commands/panel.md`:** the commands directory is an enumerated set — four in this copy, counted as `commands: 4` by `scripts/architecture-counts.mjs` and named literally in `.claude/orchestrator/conventions.md` (which lists the source project's seven, three of them not in this copy). A fifth file there silently falsifies both. The skills count is DERIVED, so a skill stub moves nothing that has to be hand-corrected.

`/panel help` (or `--help`) resolves through the universal help-arg convention and prints `/expert-review`'s usage block — read it there, never a copy kept here.
