---
name: sanity-check
description: A fresh-context reader, on Fable, with a refute mandate over one session's whole body of work — before a GO-for-push signal, a wrap, or any handoff that says "done". It asks whether the session did what the owner asked, whether its claims are backed by artifacts, what it promised and never delivered, and what the push will ship that no test and no paid draw has read. Distinct from the review hub, which reviews commits; this reads the session. Use before a GO-for-push, a wrap, or a "done" handoff. It began as a one-off fresh-agent check of one session's work and was codified as this command once that first run found real gaps.
---

# /sanity-check — a fresh reader refutes the session before it says "done"

**Invocation:** `/sanity-check` (default: before a GO or a wrap) · `/sanity-check <scope>` (one arc, one commit range, one plan section).
**Marker:** `[sanity-check]` on every reply of the run.
**Writes:** ONE dispatch (a general-purpose sub-agent on Fable, read-only) and, after the report, this session's working plan and the session's checkpoint file (`.claude/state/sanity-check-<sid8>.json`). No commits, no mail, no tracker edits from the checker itself; the orchestrator dispositions each gap afterwards through the ordinary channels.

## Why this exists

The review hub reads every commit and cannot see the session: a ruling the owner gave in chat with no artifact behind it, a promise made in a mail, a claim in a readout that no bank supports, a plan whose tail contradicts its head, a decision that shipped with no entry in the decisions log. So one general-purpose agent on Fable checks the session's whole body of work for the gaps a commit-by-commit review cannot see, and the check became `/sanity-check` because its first run was useful.

**First run, 2026-09-26 (the adoption evidence):** six real gaps in ~18 minutes, none found by the commit reviews or the session's own checks — the GO draft asserted a sequencing constraint the session's own commits refuted (the heldBriefSha re-mint precedent), the GO draft omitted the hub's "not verified" list, five owner rulings had no decisions-log entry while their behaviour was about to ship, the committed plan's live-items table contradicted its own tail, a promise to the hub had no durable row, and a prompt branch plus a reshoot path had been asserted but never drawn. It also re-ran a pre-fire reader on a post-fire bank to confirm a PASS held under both predicates — a check nobody had thought to run. Three of the six shaped what the owner was asked next.

## Process

1. **Say one line to the owner** (what is being checked, that it is read-only, that the GO or wrap waits on it).
2. **Dispatch ONE `general-purpose` agent, `model: fable`, `run_in_background: true`, read-only.** Never a fork: a fork inherits the session's context and with it the session's blind spots; the whole value is a reader who has to derive everything.
3. **The brief hands it INSTRUMENTS, never conclusions.** Every input is a path or a command it runs itself:
   - the working plan (`plans/session-<sid8>-<date>.md`; it enumerates headings and reads by range);
   - the session's commits (`python3 scripts/session-labels.py mine --sid <sid8> --since '<start>'`, which reads all three of a seat's labels — the 8-hex trailer, the seat's own remote-URL trailers, and a sid-closing subject scope — and prints its per-leg counts; a plain 8-hex grep saw 60 of one seat's 189 commits on 2026-09-29);
   - the tracker rows it filed (`grep -n 'filed: <date> by <sid8>' todo.txt`, read by row);
   - mail with the hub and peers, BOTH directions (`.claude/state/session-mail/<sid8>__*` and `*__<sid8>.md*`);
   - every paid-run artifact (banks, readers, pre-registrations) and the shipped bytes with their pins;
   - `DECISIONS.md` entries in the window;
   - owner speech beyond the plan: the transcript, walked line by line, never read whole, selecting EVERY population in the post-compact index's table (`.claude/skills/post-compact/SKILL.md` Step 4, (a) to (g), plus whatever it censuses UNRECOGNISED) by the keys that table names: `promptSource` typed / queued / suggestion_accepted; a queued-command attachment (`type == "attachment"`, `attachment.type == "queued_command"`, and BOTH `attachment.origin.kind == "human"` and `attachment.commandMode == "prompt"`, since task notifications share the channel); a local slash command read by its output (d); a slash command landing as a user record (e); an answered `AskUserQuestion` (f, the fork decisions); a user-rejected tool call (g). `scripts/post-compact-recovery-index.py` implements that table but indexes only the window since the previous compaction and appends a row to the post-compact triage log on every run (`--no-update` skips only the cache), so it does not stand in for a whole-session walk. Keying on `promptSource` alone misses the attachment population, and one day's owner rulings sat only there.
   State that repo state is read at HEAD (`git show HEAD:<path>`), never the worktree, because the tree carries peers' uncommitted files.
4. **The seven questions, verbatim in every brief** — each answered as a numbered gap or an explicit "checked, no gap" with the command behind it:
   1. Owner asks vs delivered: for every ruling quoted verbatim, the committed artifact that discharges it, or none.
   2. Pre-registration drift: bars as registered vs what the readers score vs what was reported as PASS.
   3. Claims vs artifacts: at least six load-bearing claims from the newest blocks, re-derived.
   4. Unfinished loops and promises: mails, rows, "still mine" items with no artifact.
   5. Shipping risk the reviews cannot see: what ships that no test and no paid draw exercised — named candidates, checked not assumed.
   6. Contradictions between surfaces: plan vs tracker vs decisions log vs code on one fact.
   7. Anything else a careful colleague would flag.
5. **Output contract:** gaps most serious first, each with the claim, the evidence (path + command + what it returned), a severity from {blocks the push, should precede the push, after the push}, and a one-line fix shape; then "checked, no gap" with the same evidence discipline; then "could not verify" with why. Under ~250 lines, about 45 minutes.
6. **Disposition at read, before anything gated on the check moves:** every gap gets fold-now / a tracker row / a named reject, in the plan and in the readout to the owner. A gap on an owner-facing artifact (a GO draft, a readout) is fixed in the artifact, not annotated beside it.
7. **Write the working plan:** the report's gap list and each disposition, as a dated block — and **write the checkpoint** (below), so the next run in this session continues from here.

## Checkpoint — a second run in one session continues, it does not start over

Every run ends by writing `.claude/state/sanity-check-<sid8>.json` (gitignored state, session-scoped): `{ run, at, headSha, transcriptRecords, newestMailTs, planLines, gaps: [{ n, title, severity, disposition, artifact }] }` — `headSha` is the HEAD the checker read at, `transcriptRecords` the session jsonl's record count at dispatch, `newestMailTs` the newest store filename timestamp it read, and each gap carries the disposition the orchestrator gave it and the artifact that discharged it (a sha, a row name, a mail filename, or "named reject: <why>"). The plan block written at step 7 is the human-readable copy of the same record, so a lost state file (new machine, cleared state) is rebuilt from the plan's newest "Sanity check" block before dispatch.

**On the next invocation in the same session, the brief changes shape:** it carries the previous checkpoint verbatim and asks the checker for two things only — (1) **verify each prior gap's disposition landed** (the artifact exists at HEAD and says what the disposition claims; a "named reject" is re-argued only if new evidence appeared), and (2) **run the seven questions over the DELTA only**: commits `<headSha>..HEAD` with this session's trailer, plan lines after `planLines`, mail files newer than `newestMailTs`, transcript records after `transcriptRecords`, tracker rows filed since. Anything the delta touches that the prior run had marked "checked, no gap" is re-checked; anything it does not touch is carried forward as a one-line "unchanged since run <n>" and not re-derived. The report's numbering continues from the prior run (gap 7 → 8), so a gap keeps one number across the session. A run with no checkpoint is run 1 and reads everything.

**Why a state file and not the plan alone:** the delta instruments need exact anchors (a sha, a record count, a timestamp) that a prose block invites rounding; the plan block is for the owner and for recovery, the state file is for the next brief.

## What it is NOT

- Not the `--code` review; the hub keeps that and the checker never reviews a diff for correctness.
- Not `/hanging-work` (a session-end mechanical scan of this transcript) and not `/summary` (this seat's own derivation): the point is a reader with NO prior belief about the session.
- Not a substitute for the owner's rulings: a gap that turns out to be a decision the owner reserved is put to the owner, not resolved by the checker.
- **Not a `/wrap` step and not a push gate: it is left to the owner to invoke at the owner's own pace.** The wrap hook was measured first: of the 25 sessions that wrapped in the seven days to 2026-09-28 (40 wraps), 25 of 25 had both committed to main and compacted, so a "committed or compacted" trigger is a per-wrap default in disguise ("committed product code" still fires 20 of 25); the push hook fails because a push bundles hundreds of commits, so a queue-wide check at push time has no single arc to refute. It stays owner-invoked; do not re-propose either hook without new evidence.

## Revisit

- If three consecutive runs across different sessions find nothing the hub and the seat's own checks did not already hold, retire it: it has become a second reviewer.
- If a run's "blocks the push" gap is refuted by the seat on evidence, record the refutation in the plan; two refuted P1s in a row mean the brief's questions need narrowing, not the check retiring.
- Cost per run is one Fable agent (~300k tokens on the first run); if the owner wants it cheaper, the seven questions can be split across two smaller seats, but never handed to a fork.
