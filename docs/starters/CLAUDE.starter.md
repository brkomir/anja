# CLAUDE.md starter

Copy this file to your repository root as `CLAUDE.md`, fill in every `<…>`, and delete this paragraph. The harness loads `CLAUDE.md` into every session and every sub-agent except the built-in Explore and Plan agents, so keep it short: it is a router, not a rules file. Its main job is the table under "Rules". The harness strips a rule file's frontmatter before it injects it, so a path-scoped rule file cannot announce itself, and this table is the only place a session learns that one exists.

# Project

<One or two lines: what the project is and who uses it.>

- Stack: <framework, database, hosting, payments, AI provider>
- Source of truth for <prices, plan limits, other constants>: `<path>`. If a document disagrees with the code, the code wins.

# Rules

Two rule files load in every session: `.claude/rules/bash-environment.md` and `.claude/rules/migrations.md`. `migrations.md` is written for Postgres migrations on Supabase; keep it only if your project has migrations of that kind, and otherwise delete the file and its mention here. The others are path-scoped: Claude Code loads each one when the session reads, writes or edits a file that matches its `paths:` line (its memory page), and the source project found that the write which creates a file does not load it, so none of them can be counted on for the first file a session creates. That is why each trigger below is an intent, never a path. When you change a rule file's `paths:` line to fit your tree, change its row here too; when you delete a rule file, delete its row.

| about to… | READ FIRST | scoped to |
|---|---|---|
| write or edit a unit test | `.claude/rules/tests-unit.md` | `tests/*.test.ts(x)` and the unit-test subtrees its `paths:` line lists |
| write or edit an end-to-end test | `.claude/rules/tests-e2e.md` | `tests/e2e/**` |
| write TypeScript or an `.mjs` script, or edit the build config | `.claude/rules/typescript.md` | `src/**`, `scripts/**`, `tests/**`, `tsconfig.json`, `*.config.ts`, `*.config.mjs` |
| add a route, a layout or a metadata image | `.claude/rules/nextjs.md` | `src/app/**`, `next.config.ts`, `src/proxy.ts` |
| propose a guard or hook, promote one from warn to block, or count occurrences toward a ship bar | `.claude/rules/session-cadence.md` | `.claude/hooks/**`, `.claude/rules/**`, `.claude/orchestrator/**`, `.claude/commands/**`, `.claude/skills/meta/**`, `scripts/**`, `.githooks/**` |

`.claude/rules/active-recall.md` and `.claude/rules/behavioral-anti-patterns.md` are scoped to an archive directory the copy does not ship, so they never load. Leave them that way or re-scope them on purpose.

# Commands

The command index is `.claude/orchestrator/conventions.md` § Commands, which a SessionStart hook delivers to the main session only. `/help` lists every command.

# Key files

- `todo.txt`: <ops checklists, bugs and deferred items>
- `BACKLOG.md`: <the ranked list of what to build>
- `DECISIONS.md`: <the decision log, Shipped / Open / Rejected>
- `IDEAS.md`: <unranked ideas>
- `plans/`: <design documents and each session's working plan>
- `.claude/project-memory/`: <the project memory; `MEMORY.md` is its index>
- <your own key paths>
