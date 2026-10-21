# Steps 1a–1c — evidence and rationale — moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## Step 1a — why here — from `SKILL.md` § Process

   **Why here:** classifications are local to a commit state; later session feature work can invalidate them silently. Evidence: a flow-audit session 2026-04-17/18 classified 5 e2e failures as `(c) pre-existing`; a later fix in the same session added a `disabled` gate to the exact button those tests clicked. Label carried forward stale; someone had to ask for the failures to be investigated and fixed before the root cause surfaced. Cost: ~5 min investigation + 1 extra commit. Without this sweep, the same pattern repeats every multi-commit session.

## Step 1a-ii — what this step used to read — from `SKILL.md` § Process

   *This step read `git diff --name-only <this-session-first-commit>^..HEAD` until 2026-09-21: a range on a shared branch is a TIME WINDOW, not a seat — measured 152 of 245 commits in it as other sessions' and 165 of 438 files as never committed by this session — and it contradicted the wrap skill file's (`SKILL.md`) own SIGNAL 1 rule further down. Its placeholder was defined nowhere, and with no empty-list guard an instrument that never ran reported "nothing of mine is unstaged". The session labels `SKILL.md` Step 1a-ii now reads (three forms, through `scripts/session-labels.py`) are a FLOOR: a commit carrying none of them (a bare `commit-tree`) is invisible here.*

## Step 1b — why mandatory, and the companion layers — from `SKILL.md` § Process

   **Why mandatory:** without this gate, post-compact-only scans systematically miss pre-compact technical-fix arcs that the harness compresses to one bullet. A 2026-05-09 incident: initial `/wrap` pass missed a Drizzle `${arr} = ANY` factual hit + a pivot decision + 2 unpushed-commit decisions because scan only covered post-compact ~250 messages. The gap surfaced only when someone asked whether the scan had looked past the last auto-compact. Same-session re-scan recovered all 4. Treat post-compact-only scan as a known failure mode — even when pre-compact summary appears comprehensive, factual hits frequently sit in the pre-compact arc.

   **Companion layers (already shipped):**
   - `compact-save.sh` (PreCompact hook) — checkpoints state BEFORE compaction (informational; preserves session metadata + git state, not fine-grained signal).
   - `session-start.sh` SRC=compact branch — emits the `/post-compact` directive (renamed from `postmortem` 2026-07-04; re-pointed off the `/meta` alias 2026-09-04, which is where the split's byte win is realised) + replays the checkpoint post-compaction (resume context, not full signal preservation). Was `compact-restore.sh`/PostCompact until 2026-07-03 — retired: PostCompact hook output never injects into agent context. Since 2026-07-04 the directive is the FIRST emission (EMIT-ORDER RULE: bounded before the unbounded mail dump — an 11-mail dump once truncated it out of context).
   - This Step 1b is the procedural layer the hooks alone can't provide — they preserve the metadata; the scan extracts the signal from the raw transcript that was compressed.

## Step 1b-DEEP — the spec is delivered whole — from `SKILL.md` § Process

   ⚠️ A skill invocation delivers its spec WHOLE (measured 2026-09-12: a 232,836 B spec arrives as one
   record, mid-file and tail markers present in equal counts across 161 of 174 transcripts), so the
   post-compaction seat that needs the brief block (now in `.claude/skills/deep-pass/SKILL.md`) gets it in one hop rather than paging that file.

## Step 1c — why here, and what it consumes — from `SKILL.md` § Process

   **Why here, not in /meta learn (Step 2):** /meta learn extracts lessons at session-end; this runs BEFORE it so lessons reflect the corrected defer posture, not the pre-sweep state. Also prevents a defer-sweep 3-part test miss from recurring, mechanically — rule auto-fires instead of relying on user pushback.

   **Consumer of:** the defer-sweep 3-part test lesson and its reinforcement. If the 3-part test produces zero promotions across 2+ sessions, the auto-sweep is over-engineered and should be relaxed; if the test produces frequent promotions, the orchestrator's defer calibration remains under-skeptical and the sweep is paying for itself.
