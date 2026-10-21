---
name: help
description: Slash-command discovery by topic. Use when you forget which command does what, or when onboarding to the system. Routes "what command do I run for X?" to the right entry point.
---

# /help — Slash Command Discovery

This skill maps tasks to the commands a session uses, grouped by intent. Every command lives in `.claude/skills/<name>/SKILL.md` or `.claude/commands/<name>.md`, and `/help <command>` reads any of them live, including commands the tables below leave out.

In a local terminal session this project skill replaces Claude Code's own `/help`, which has no alias (Claude Code's skills page, the table under resolving skills that share a name). So a question about Claude Code itself is routed back to Claude Code's command list (step 0 below), and renaming this skill, both its folder and its `name:` line (to `project-help`, say, which then runs as `/project-help`), brings the built-in `/help` back.

## Usage

- `/help` — show all topic categories with their commands.
- `/help <topic>` — show commands for a specific topic. Topics: `session`, `sessions`, `experts`, `audit`, `release`, `planning`, `registers`, `system`.
- `/help <command>` — show what a specific command does, its subcommands, and when to use it (e.g., `/help expert-review`). **Reads the command's `.claude/skills/<command>/SKILL.md` Usage section LIVE** — never a duplicated table here, so it can't go stale.

**Two layers of discovery — know which you want:**
- **`/help`** = breadth (across-command): "which command does X?" — this skill.
- **`<command> help` / `<command> --help` / `-h` / `?`** = depth (per-command): "what subcommands/flags does *this* command have?" — handled by the always-loaded `universal-help-arg` convention (the orchestrator emits the target spec's Usage section without running the command). Example: `/meta help` lists every `/meta` entry point.

## Process

0. **Not about this system? Do the built-in's job.** If the argument names one of Claude Code's own commands (`/compact`, `/model`, `/config`, `/clear` and the rest) or asks about Claude Code itself (its keyboard shortcuts, its settings, its built-in commands), answer as Claude Code's `/help` would: list or explain Claude Code's commands from its command reference (`https://code.claude.com/docs/en/commands`), and say in one line that this project's `/help` stands in for the built-in in a terminal session. A bare `/help` ends with one line pointing there.
1. Parse `<topic>` argument. If empty → output the full topic table (Section A below). If matches a topic → output that topic's command list (Section B). If matches a command name → **read `.claude/skills/<command>/SKILL.md` (or `.claude/commands/<command>.md`) and emit its Usage/entry-points section live**, augmented by the deep-dive in Section C if one exists. Do NOT rely solely on Section C's curated text — read the spec so subcommands added since last review still surface.
2. For unknown args, suggest the closest matches via grep against the skill/command inventory (`ls .claude/skills/ .claude/commands/`).
3. Output inline (never write a file).

---

## Section A — Topic Table (default `/help` output)

| Topic | What it covers | Primary commands |
|---|---|---|
| **session** | Start, check where you are, pause, end | `/orient`, `/summary`, `/eli5`, `/explain`, `/working-plan`, `/pause`, `/pre-compact`, `/post-compact`, `/wrap` |
| **sessions** | Several sessions on one branch | `/peers`, `/board`, `/mail`, `/review-hub`, `/review-queue` |
| **experts** | Consult or build with expert agents | `/expert-review` (also `/panel`), `/agent-work`, `/limit-recovery` |
| **audit** | Checks before calling work done | `/audit-check`, `/sanity-check`, `/test-gap`, `/sniff-test`, `/fix`, `/verify` |
| **release** | Ship the working branch | `/deploy-check`, `/push`, `/promote` |
| **planning** | What to do next | `/backlog`, `/ideas`, `/triggers` |
| **registers** | Status readouts over registers the project keeps | `/features`, `/surfaces`, `/ops`, `/launch`, `/flows` |
| **system** | The agent system itself | `/meta`, `/me`, `/session-memory`, `/decisions`, `/observations`, `/help` |

> Tip: when in doubt at session start, type `/orient`; mid-session, `/summary`; at session end, `/wrap`.

---

## Section B — Per-Topic Detail

### `session`

- **`/orient`** — Read-only session start: branch, recent commits, uncommitted work, open items and where to start.
- **`/summary`** — Mid-session readout: where this session has landed, what waits on you, what is still in flight. Derives every number live; writes only the working plan.
- **`/eli5`** — Plain-English account of where the work stands, or of one topic, when you have lost the thread. Read-only.
- **`/explain "<line>"`** — Expand one compressed line the session wrote into what it means and how it is known.
- **`/working-plan`** — Show and update the session's working plan.
- **`/pause`** — Let running agents finish, start nothing new, and hold the work until it is resumed.
- **`/pre-compact`** / **`/post-compact`** — Bank the session's state in its working plan before a compaction; rebuild it afterwards.
- **`/wrap`** — End of session: runs `/hanging-work`, the lesson and memory steps, and commits what is left, with parallel-session awareness.
- **`/hanging-work`** — Read-only check for undone work before the wrap.

### `sessions`

- **`/peers`** — This session and the parallel sessions, with what each is working on.
- **`/board`** — The fleet board: one read-only card per open session, derived on each render.
- **`/mail`** — Handoffs between parallel sessions.
- **`/review-hub`** / **`/review-queue`** — Turn one session into the code-review hub for its peers; read what is waiting on it.

### `experts`

- **`/expert-review <topic>`** (also `/panel`) — Multi-expert consultation, sized by mode (`--lean`, `--spot`, `--code`, `--final-audit`). Consult only: no code changes.
- **`/agent-work <task>`** — One to five specialists making code changes in parallel; the orchestrator integrates and runs the checks.
- **`/limit-recovery`** — Take over the work of helper agents that died at a usage limit.

### `audit`

- **`/audit-check <feature>`** — The verification gate before an audit is marked complete (13 checks; `/audit-check help` lists them live).
- **`/sanity-check`** — A fresh reader tries to refute one session's whole body of work before it is called done.
- **`/test-gap`** — What a file or feature has tested and untested.
- **`/sniff-test`** — Self-audit of a draft before sending it.
- **`/fix`** — Plan a targeted code fix and run the tests it needs.
- **`/verify`** — Verification loop before a commit: types, lint, a security scan, a diff review.

### `release`

- **`/deploy-check`** — Types, tests, migrations, environment settings and known blockers before a production push.
- **`/push`** — Push the working branch so the staging build rebuilds.
- **`/promote`** — Ship the working branch to production by pull request, merged only on your explicit word.

### `planning`

- **`/backlog`** — Show and maintain the ranked queue of features and improvements.
- **`/ideas`** — Capture, refine and promote product ideas.
- **`/triggers`** — Deferred tasks whose revisit condition now holds.

### `registers`

- **`/features`**, **`/surfaces`**, **`/ops`**, **`/launch`**, **`/flows`** — Status readouts over the registers the project keeps (each reads its own register; the starters in `docs/starters/` show the shape).

### `system`

- **`/meta`** — Health and evolution of the expert and memory system; `/meta help` lists its entry points.
- **`/me`** — What the system has recorded about your working preferences.
- **`/session-memory`** — Capture the session's decisions in memory before the wrap.
- **`/decisions`** — Keep the human-readable decisions log: add, promote or audit an entry; the wrap sweeps it at step 3a.
- **`/observations`** — A narrative read of where the system keeps tripping up and what to fix next.
- **`.claude/docs/architecture.md`** — 11-lecture system architecture reference. Read this when onboarding or planning major changes to `.claude/`.
- **`.claude/docs/state.md`** — companion to architecture.md: current health + the numbered known failure modes. Read this when diagnosing a recurring problem or reviewing system fragility.

---

## Section C — Per-Command Deep-Dive (selected)

For commands not covered in detail here, read the skill spec directly: `.claude/skills/<command>/SKILL.md`.

### `/expert-review` deep-dive

Composes a panel of 3–15 domain experts plus (optionally) a contrarian whose explicit job is to find what the panel missed. Panel composition uses:

1. **Panel Playbook** — biases toward experts that have produced actionable findings on similar topics.
2. **Department directory** — routes by domain (e.g., "billing" → saas-economist + saas-engineer + security-expert).
3. **Skepticism field** — high-skepticism experts (security-expert, qa-expert) weighted heavier in critical audits.

Flags:
- `--final-audit` — pre-launch verification mode (stricter + adds `/audit-check` post-run).
- `--phase-fresh-synthesis` (opt-in, when shipped) — for ≥9-expert panels, runs synthesis in a fresh sub-agent to avoid orchestrator-context accumulation.

Output: synthesis grouped by topic (NOT by expert), with evidence-class labels (CONVERGED / SINGLE-SOURCE / DISPUTED).

### `/audit-check` deep-dive

13 checks, each producing PASS/FAIL with specifics; some are not applicable to every audit (`/audit-check help` lists them and when each applies). Cannot mark COMPLETE until all applicable checks pass.

Inline-fix during audit: ≤5-line mechanical fixes apply inline (e.g., stale source-grep assertions broken by this audit's legitimate copy changes).

### `/agent-work` deep-dive

The flagship parallel pattern. Orchestrator's job is two-step:

1. **Brief** — what each agent does, which skill they load, what their success criteria are. Every implementation agent MUST load the relevant expert SKILL.md + MEMORY.md.
2. **Integrate** — after agents return, glue the work together (typecheck, test, resolve conflicts).

Typical brief for a feature touching 4 files:
- Agent A (frontend-developer) — refactor src/components/foo.tsx
- Agent B (ux-copywriter) — write the feature's new interface strings
- Agent C (saas-engineer) — add server action in src/actions/
- Agent D (security-expert, contrarian) — review the diff for missing auth gates

Subagents emit Memory Update blocks in their final output; orchestrator extracts and appends (per sub-agent MEMORY blocks, subagents cannot directly write to MEMORY.md).

---

## Anti-patterns this skill must avoid

- **Listing every skill mechanically.** This is a routing aid, not a complete inventory. Group by intent.
- **Re-duplicating per-command usage.** `/help <command>` and the `<command> help` convention BOTH read the target spec live — never paste a command's subcommand list into Section A/B/C. The Section A topic table + Section B per-topic groupings are the only hand-maintained surface (intent-grouping is editorial; it can't be auto-derived). Per-command *depth* is always live-read, so it can't drift.
- **Going stale.** Refresh trigger for Section A/B only: when 3+ new slash commands ship since last review, regenerate the topic groupings. Per-command Usage needs no refresh (live read).

## Revisit

- If `/help` is invoked <3× per month for 3 months, discovery isn't actually a problem — consider deprecating.
- If new contributors join and bypass `/help` in favor of asking via chat, the tables are too dense — slim Section A to a one-paragraph routing decision tree.
