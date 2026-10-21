---
name: me
description: Interactive interface to who-the-system-thinks-you-are. Shows user_profile.md + feedback memories, walks you through updates when stale, captures new working-style preferences mid-session. Read-only `/me` + interactive `/me check` + additive `/me learn <observation>`. Use when checking what the system has codified about your preferences, refreshing a stale profile, or adding a newly-surfaced preference.
---

# Me — Identity & Preference Interface

Surfaces what the system believes about you (from `user_profile.md` + `feedback_*.md` memories), flags staleness, and provides a structured interface to update. Scope is **your working style and preferences only** — not project state, not generalizable lessons about the system.

## Usage

> 💡 `/me help` (or `--help`) lists these modes without running anything.

- `/me` — read-only digest: profile summary + active preference count + staleness indicator + 2–3 coherence spot-checks
- `/me check` — interactive walkthrough of `user_profile.md` claims; confirm/edit/drop each; rewrite + commit; bump `last-reviewed`
- `/me learn <observation>` — add a newly-surfaced working-style preference mid-session; auto-classify to profile (core) or new feedback memory (narrow); ≤15 LOC auto-execute, larger = propose first
- `/me learn-session` — end-of-session scan of conversation context for behavioral signals; extracts 0–N preferences; writes to profile + new feedback files; auto-invoked by `/wrap` Step 7a. See "Process — `/me learn-session`" below.

## When to Use

- Session start, if `/orient` flagged the profile as stale (>30 days)
- User says "from now on prefer X" / "stop doing Y" / "always do Z" — that's a `/me learn` candidate
- Before a new major feature where defaults matter (what reports look like, what tone fits, what tools to pick)
- Periodically (~30 days) as a check-in

## When NOT to Use

- **Project decisions** (pricing, tech stack, architecture, feature choices) → `/session-memory`
- **Generalizable system lessons** (not specific to you as a user) → `/meta learn`
- **Memory hygiene across all files** → `/meta memory-audit`
- **Skill-spec drift from preferences** → `/meta coherence` (deep cross-audit)

## Process — `/me` (default, read-only)

1. Read `~/.claude/projects/<project-key>/memory/user_profile.md` (symlinked from `.claude/project-memory/user_profile.md`).
2. Count `feedback_*.md` files in the same directory; list their one-line descriptions (from frontmatter).
3. Parse `last-reviewed` frontmatter from profile. Compute age in days.
4. **Staleness indicator:**
   - ≤30 days → GREEN
   - 31–90 days → YELLOW ("profile is N days stale; `/me check` recommended")
   - >90 days → RED ("profile is N days stale; `/me check` mandatory before trusting defaults")
5. **Coherence spot-check (shallow — 2–3 probes only).** Pick 2–3 strong preference claims and grep relevant skill specs for compliance. Examples:
   - "Reports go inline" → grep `observations/SKILL.md` for "inline" / "no file written"
   - "Translate internal codes" → grep `observations/SKILL.md` for "translate every internal code"
   - "Skeptical experts on final audits" → grep `expert-review/SKILL.md` for "skepticism" / "HIGH"
6. **Output:** digest (identity + N preferences + staleness + 2–3 spot-check results). Read-only; no writes.

## Process — `/me check` (interactive walkthrough)

1. Read `user_profile.md`. Parse into discrete claims grouped by section (identity / self-characterization / working-style / business-details).
2. Present as numbered list with response format hint:
   ```
   N. [claim text]
   → reply: ok / edit: <new text> / drop
   ```
3. Collect user responses (user can batch like "1–5 ok, 7 edit: …, 11 drop").
4. Apply edits:
   - `ok` / `confirm` / silence → keep as-is
   - `edit: X` → replace claim with X
   - `drop` → remove claim (record reason if user provided)
5. Rewrite `user_profile.md` with updates + bump `last-reviewed: YYYY-MM-DD` to today.
6. Stage via explicit `git add .claude/project-memory/user_profile.md` (never `-A`).
7. Commit: `meta(profile): /me check — N confirmed, M edited, K dropped`.

## Process — `/me learn <observation>` (additive)

1. Parse the observation text. Classify:
   - **Profile-level** (identity, core working-style, broad preference) → append to `user_profile.md` working-style subsection
   - **Feedback-level** (narrow behavior, specific correction, tool preference) → create `feedback_<topic>.md`
   - **Ambiguous** → ask user: "profile claim, feedback memory, or both?"
2. **Duplicate check:** grep existing profile + feedback memories for the observation's keyword set. If a match exists, ask user: supersede (edit existing) OR add-alongside (new entry with cross-reference)?
3. **Size check:** if the resulting addition is ≤15 lines, auto-execute. If larger, present proposed diff and ask for approval.
4. Write + stage explicit file. Commit: `meta(profile): /me learn — added <short-name>`.

## Process — `/me learn-session` (auto-invoked by `/wrap` Step 7a)

End-of-session bulk extraction of user-preferences from conversation context. Session-wide analog of `/me learn <observation>` — does NOT require user to articulate each preference; orchestrator scans the session and proposes. Adopts the same signal catalog as `/meta learn` but scoped to USER-preferences (not system lessons).

**Signal catalog (what to watch for in the session):**
- User pushback / reframing (questioning why so much is deferred, telling the system not to wait on something, asking for an item to be raised in priority)
- Directional preference statements (a call to ship now, a request that something not get lost, a lowered threshold for acting)
- Tool-friction flags (click-through fatigue, repeated prompts, workflow waste)
- Systems-thinking observations the USER made (not the orchestrator surfaced) — those signal the user's own mental model
- Severity recalibration (the user judging an issue more severe than it was flagged)
- **Praise / validation signals (added 2026-05-18 — closes the "we lose validated approaches" gap):** the user explicitly approves an unusual / non-default choice, OR accepts a non-trivial proposal without pushback after a clear pause-to-react moment. Pattern is the inverse of pushback: pushback says "the system did wrong"; validation says "the system did right, do this again." Easy to miss because absence-of-correction reads as default, not signal. **Concrete phrasings to detect:**
  - Explicit approval: `"perfect"`, `"exactly right"`, `"yes, that"`, `"keep doing that"`, `"good call"`, `"that was the right move"`, `"do this from now on"`
  - Acceptance of contrarian/unusual choice: user accepts a decision that diverged from the obvious default without flagging the divergence — silent acceptance of `"I bundled X with Y rather than separate commits because…"` reads as validation of the bundling logic
  - Post-friction relief: pushback resolved cleanly + user moves on without re-litigating — validates the corrected approach as the new default
  - **Distinguish from compliments**: `"thanks"` or `"nice"` alone is courtesy; treat as praise-signal ONLY if attached to a specific decision (`"perfect — that scope reduction was right"`). Bare courtesy doesn't surface as a preference.
  **Why explicit:** validated approaches without capture drift back to default in the next session. The user-as-oracle / Kim 2025 pattern is symmetric — sycophancy-under-rebuttal flips correct positions to agreement; absence-of-praise-capture lets correct-and-validated positions silently regress to default. Capture both ends. **Anti-pattern guard:** don't synthesize praise where none exists. If the user moved on without explicit signal AND the choice was the obvious default, that's NOT praise — skip. Praise only fires on (a) explicit phrasing OR (b) acceptance-of-non-default.

**Steps:**

1. **Scan conversation context** for behavioral signals per catalog. Look across entire session, not just last N turns. **Extend to parallel sessions (added 2026-04-21):** also scan top-level `*.jsonl` transcripts in `~/.claude/projects/<project-key>/` modified in the last ~20h, excluding the current session file. Extract user messages (role: user, non-slash-command, <500 chars — PLUS at least three owner-message shapes that predicate misses — the full census is `/post-compact` Step 4's population table, which also names rejected tool calls other than a dismissed question: **(a) QUEUED messages** — a message typed while a turn is running arrives as `type:"attachment"` with `attachment.type == "queued_command"`, `attachment.origin.kind == "human"` AND `attachment.commandMode == "prompt"`, not as a user record, so a `role: user` filter cannot see it (a queued message CAN also land as a user record with `promptSource == "queued"`, which the role filter already reads — both channels are live; require BOTH fields: task notifications AND peer-session prompts (`origin.kind == "peer"`) ride the same attachment channel; the text is `attachment.prompt`); **(b) QUOTE-THEN-RULE messages of ANY length** — the owner pastes a cell or sentence of the assistant's text, then writes the owner's ruling after the closing quote and ` - ` (`"<assistant text>" - approve`, straight or curly quotes), often several pairs in one message, so the 500-char cap drops exactly the messages that carry the most rulings. Split each pair with `/post-compact` Step 4's segmenting `finditer` regex, never its greedy detector; the text after the dash is the owner's words, the quoted part is the assistant's and is never attributed to the owner; **(c) ANSWERED multiple-choice questions** — an `AskUserQuestion` answer arrives as a `tool_result`, which no user-record predicate sees. Key it exactly as `/post-compact` Step 4 row (f) does, which governs if this summary ever disagrees: the `tool_use_id` link to an `AskUserQuestion` call PLUS a NON-EMPTY `toolUseResult.answers`, never the tool name or the content string. Classify per QUESTION, never per record (`answers` maps each question to its answer): an answer matching an offered label is the owner's CHOICE (strip `(Recommended)`; a multi-select answer is either a LIST, read element by element, or labels joined by `, `, split only when every part is an offered label — row (f) says how); one matching no label is the owner's own prose, so quote it; a rejected question (row (g), `toolDenialKind == "user-rejected"`) is a dismissal, never an answer) and apply same signal catalog. **Why:** user frequently runs parallel sessions; preference signals surface in whichever session hit the friction, not necessarily current. A current-session-only scan would miss them (discovered when a scan of every other session from the last 20 hours proved the gap). **Always run the read-only parallel-scan — there is no skip-gate.** ⛔ **AND THE OBVIOUS IMPLEMENTATION OF "modified in the last ~20h" RETURNS ZERO ON THIS BOX, SILENTLY (measured 2026-07-31).** BSD/macOS `find` does not accept GNU's relative form: `find … -newermt '20 hours ago'` yields **0 files** while `-newermt '2026-07-31 01:00'` yields 11, with 118 transcripts present and the CURRENT session's own file modified minutes earlier. There is no error — a step the spec declares un-skippable returns a clean, plausible, empty result, so the scan reports "no parallel signals" and nobody looks again. **Use an absolute timestamp** (`-newermt "$(date -v-20H '+%Y-%m-%d %H:%M')"` on macOS, or `-newermt "$(date -d '20 hours ago' '+%F %T')"` on GNU), **and run the positive control before believing a zero: your OWN transcript must appear in the unfiltered set.** If it does not, the instrument is broken, not the fleet. (Control-first, at the mandatory-step surface.) **⛔ SECOND FALSE-ZERO SHAPE (measured 2026-08-05): user-turn `content` is a BLOCK ARRAY (`[{type:"text","text":…}]`) in most transcript records, not a string — a string-only extractor passes the file-level positive control and still returns ZERO messages from full transcripts.** Handle both shapes; a zero-message result from files the control confirmed present is the instrument, not the fleet. ⛔ **THIRD SHAPE, AND IT FAILS THE OTHER WAY — FILE MTIME IS NOT MESSAGE RECENCY (measured 2026-09-05).** A RESUMED session rewrites its ENTIRE jsonl, so a file that passes the ~20h mtime filter can carry days of history and every message in it reads as fresh. Measured at a `/wrap` 7a: a `2026-08-28T17:55:27Z` utterance surfaced as a NEW signal and was one step from being written into an existing feedback memory as a third occurrence of a rule that already banked it — a false N=3 escalating a satisfied rule. **Keep the file filter as the cheap pre-pass, then compare each extracted message's OWN `timestamp` field to the cutoff and drop anything older.** ⛔ **A RECORD WITH NO `timestamp` IS KEPT, NEVER DROPPED — `type=last-prompt` CARRIES NONE (13,944/13,944 on this seat's 16-file window and 2,831/2,831 on the hub's own transcript, two independent corpora, 2026-09-06) AND IS SOMETIMES THE ONLY OWNER SPEECH IN A WINDOW (shape 7, nine measured times).** An absent stamp means the instrument cannot DATE the record, never that the record is OLD — `bash-environment.md` § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE, at the recency surface. ⚠️ **Today this is LATENT, not live, and the reason is why the clause belongs here rather than in a tracker row:** the extractor one clause above filters `role: user`, which `last-prompt` does not carry, so the shape never reaches this comparison. It goes LIVE the moment anyone widens that extractor — and the codified owner-speech catalogue (`active-recall.md`) arguably requires exactly that. **The fix for one half arms the other half, and the two edits sit in different sentences of the same paragraph.** ⚠️ Every correction above is about the FILE predicate, so a reader arrives at this step believing the recency question is settled. (The former "skip if current session has ≥30 user messages = strong own-signal" gate was dropped 2026-06-09: the scan is a cheap read-only grep of the last-~20h jsonls, and message COUNT is a crude proxy for signal DENSITY — a long mechanical session would wrongly skip while a short rich one would needlessly run; the 30 itself was a napkin number eyeballed from the 2026-04-21 17-vs-37 split with no empirical basis. `expert-review` Step 1b already always-injects peer context with no count gate — same design.) **What IS gated is the WRITE, not the scan:** per parallel-session coordination (shared-memory append discipline), if a preference surfaces from a parallel session whose transcript — or the shared `user_profile.md` / `feedback_*.md` — is being actively edited by that peer right now, PROPOSE/defer the write rather than auto-writing it (Step 6 staging discipline applies; the peer's own `/wrap` may capture it). The scan always surfaces; only the write defers when a peer is mid-edit.
2. **De-duplicate against existing profile + feedback.** For each candidate, grep `user_profile.md` + `feedback_*.md` for overlapping keyword set. Skip items already captured.
3. **Classify each surviving candidate:**
   - **Profile-level** (core working-style, systems-thinking pattern, velocity preference) → append to `user_profile.md` dated section
   - **Feedback-level** (narrow behavior, specific tool preference, concrete procedural rule) → create `feedback_<topic>.md` with frontmatter + 4 standard fields (trigger / action / why / revisit)
4. **Propose + execute.** Present a short summary table:
   ```
   N preferences surfaced this session:
   - Profile-level: {K} additions to user_profile.md
   - New feedback files: {M} ({list})
   ```
   Auto-execute if total scope ≤30 LOC. Larger scope → propose diff + wait for user confirm.
5. **Do NOT bump `last-reviewed`.** That field means "the owner last REVIEWED the profile's claims" and is reserved for `/me check` (the interactive walkthrough). learn-session APPENDS observations — it is not a review. Bumping it here made `/orient`'s >30-day staleness flag structurally unreachable: `/wrap` Step 7a auto-invokes learn-session, so every wrap reset the staleness clock and the `/me check` prompt could never fire (found 2026-07-30, fixed 2026-08-02).
6. **Stage explicit files** via `git add` (never `-A`). Staging only; commit happens inside `/wrap` Step 8.

**Skip rule:** If zero preferences surface after steps 1–2, emit one-line `No new preferences this session.` Don't create empty work or synthetic observations.

**De-dup is a FORK, not an auto-skip.** When a candidate de-dups to an EXISTING preference/feedback rule (Step 2 match), do NOT skip on "already covered" alone — branch on whether that rule was **honored or violated this session**:
- **Honored** (the rule fired, no violation) → skip normally. No duplicate capture file.
- **Violated despite coverage** (the rule was loaded via the Trigger Index and broken anyway) → do **NOT** skip. A loaded rule that didn't fire is an **active-recall-before-write, possession≠application** failure — the session's highest-value signal (knowledge gaps are cheap; application gaps are the expensive recurring kind). Route it to `/meta corrections --add` as a `preference-violation` + the meta watch-register (toward an enforce-layer promotion — active-recall row / hook / louder trigger). Still write NO new feedback file (Capture is fine; the gap is **Enforce**). "Already covered" describes Capture; a violation-despite-coverage is an Enforce gap, and silent-skipping it buries the most important finding of the session.

**Scope discipline:** same rules as `/me learn <observation>` — USER preferences only. Project decisions go to `/session-memory`, system lessons to `/meta learn`. A session might produce entries in all three (one audit session did: system lessons for /meta, a tracker flip for /session-memory, and /me learn-session capturing the 6 preferences surfaced via user pushback).

**Anti-pattern guard:** don't re-extract preferences already surfaced this session via explicit `/me learn <observation>`. If the user ran `/me learn` mid-session for specific items, those are already in the profile — de-dup against recent git log on `user_profile.md` + `feedback_*.md` (since session-start-SHA) before proposing.

## Principles

- **Scope discipline.** /me is user-preferences only. If the observation is about the project (pricing, features, code architecture), redirect to `/session-memory`. If it's about system behavior generalizable across users, redirect to `/meta learn`.
- **Staleness is informational, not blocking.** Flag old profiles; don't refuse to proceed.
- **Profile edits preserve drop rationale.** Don't silently remove a claim — record "dropped on YYYY-MM-DD, reason: …" in the commit message or profile comment.
- **Bare `/me` must always work.** The no-argument case is the most common (transparency). Keep it read-only and fast.
- **Shallow spot-check in /me; deep cross-audit in /meta coherence.** Don't duplicate the exhaustive audit here.

## Coordination

- **`/orient`** at session-start reads the profile's `last-reviewed`; if >30 days old, prints a one-line flag pointing at `/me check`.
- **`/meta coherence`** runs the exhaustive preference-vs-skill-spec audit across all preferences × all skills. `/me` default runs a 2–3-probe spot-check to keep default output fast.
- **`/session-memory`** captures project decisions at session-end; `/me learn` captures user-preference decisions anytime.
- **`/meta memory-audit`** sweeps ALL memory files for hygiene; `/me check` is the user-facing interactive version scoped to profile + feedback.

## Anti-patterns this skill must avoid

- **Lecturing.** Don't say "You prefer X." Show the claim, ask if it still applies.
- **Memory proliferation.** Not every small correction needs a new `feedback_*.md` file — group into existing patterns when a related memory exists (e.g., an existing memory about recommending and acting rather than listing options and waiting already covers a new observation that phrases the same preference differently).
- **Scope confusion.** A stated preference for the paid plan's price point is a project decision, not a user preference. Redirect.
- **Over-aggressive drop.** If user says "drop 11" without explanation, ask once for the reason before removing — the claim might still apply; they may just want it re-phrased.

## Revisit

- If `/me check` produces zero edits for 2 consecutive runs, the profile is stable — extend cadence to 60 days.
- If `/me learn` creates >3 new `feedback_*.md` files in one week, duplicate-check rule isn't firing hard enough — tighten.
- If `/meta coherence` consistently reports no CONTRADICTS for 3 runs, cross-audit is over-engineered; prune or relax.
