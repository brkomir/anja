# Steps 8a–9, commit procedure, Output and test gating — history and evidence — moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## Iron Law — evidence — from `SKILL.md` § Process

Evidence + fix: 4-seat review convergence (2026-07-01) — make the checkmark COMPUTED not ASSERTED; the enforce layer is Step 11 + `scripts/wrap-reconcile.mjs`, NOT another self-attested step.

## 8a — partition, not filter — from `SKILL.md` § Process

    ⚠️ **PARTITION, NOT FILTER — AND SAY SO, BECAUSE THE ADJACENT RULE LOOKS LIKE IT FORBIDS THIS.** `/summary` §1 states *"NEVER FILTER A COUNT ON THE `Claude-Session:` TRAILER"* and retires the instrument that did. It also states, in the same paragraph, *"The trailer itself STAYS — for peer disclosure and as a PARTITION; retired only as an identity a count can filter on."* 8a partitions and reports a residue; it never reports a per-session count to the owner. A future reader meeting the NEVER line first will think this step violates it, so the distinction is written here rather than left to be re-derived.

## 8a — the send-side rule — from `SKILL.md` § Process (tail of a paragraph, split at a sentence boundary)

**The rule, set on a wrap that did put the question:** a review that is warranted by its nature is not deferred back as an ask. The wrap judges whether a review is warranted, sends it, and states in the closing message that it sent it and what it was — the visibility stays and the asking stops. The old sentence's concern survives as the disclosure.

## 8a — what the old ask-never-send sentence said — from `SKILL.md` § Process

    ⚠️ **WHAT THE OLD SENTENCE SAID AND WHY IT IS GONE.** It read *"⛔ ASK, NEVER SEND. … it does not mail the hub on its own. 5e itself is surface-only for the same reason — a `--code` is a real token spend the owner opts into."* That reason was never part of the mandate: the 5e re-derivation step itself was mandated, but the ask-never-send clause carried NO such mandate and its rationale was the spec author's. **The cost it protected is real and survives as the DISCLOSURE, not as a gate** — you still tell the owner, you just stop asking first. It was a live contradiction with the standing rule that delegates code review to a peer.

## 9 — why a second learn — from `SKILL.md` § Process

   **Why a SECOND learn (not moving Step 2 later):** Step 2's early slot is load-bearing — its lessons can inform the Step 3 `/session-memory` + Step 3a `/decisions` writes, and it runs after the Step 1c defer-sweep so lessons reflect the corrected defer posture. Step 9 is purely additive: it captures ONLY the execution-time delta Step 2 cannot see. It also runs AFTER the Step 8 commit, so even if the meta-skill load triggers a compaction (a known compact-trigger at high end-of-session context), the session's durable work is already persisted.

## Commit procedure — the two superseded options — from `SKILL.md` § Commit procedure (shared with /audit-check Post-Gate Action)

   ⛔ **The two options this step listed until 2026-08-24 are both superseded, and each was wrong on a different axis.** (A) said `git restore --staged <foreign-file>` then a bare `git commit` — but the standing parallel-session commit rule bans managing a peer's index (a peer's staged files are left alone: no `git reset HEAD`, `git restore` or `git stash` on them), and the commit row, now in `.claude/orchestrator/commit-doctrine.md`, rules on this exact case: **"Do NOT unstage them. Do NOT read the refusal as permission to commit bare."** A bare commit then takes every foreign PATH in the shared index. (B) said `git commit -o <paths>` — which is correct on the PATH axis and maximally wrong on the CONTENT axis: `-o` RE-READS THE WORKTREE for the paths you name, so it absorbs a peer's concurrent write to *your* file.

## Commit procedure — evidence — from `SKILL.md` § Commit procedure (shared with /audit-check Post-Gate Action)

   Evidence: one wave's agent swept 32 files when 8 were explicitly staged — a parallel session had pre-staged 24. Caught at review, required amend-with-disclosure. One `git diff --staged` call would have pre-empted.

## Output — the commit count (superseded as an output obligation) — from `SKILL.md` § Output

> ### ⛔ THE COMMIT COUNT IS THE ONE `{N}` A PASTED COMMAND CANNOT GIVE YOU
> ✅ **SUPERSEDED AS AN OUTPUT OBLIGATION — THE COUNT IS NO LONGER REPORTED AT ALL, so the cheapest reading of everything below is: this is why.** The block stays because its REASONING is still the live fact — the isolation is semantic, not syntactic — and because anyone who needs the number internally still needs to know that no range expression produces it. What changed is the disposition: rather than keep repairing an instrument whose every version is a floor presented as a count, the CLAIM is ruled out of the readout. A later seat tempted to re-add a "N mine" line should read this block first and then not.
> ⚠️ **And the most recent repair attempt is itself the argument.** A `Claude-Session:` trailer auto-stamp took coverage from ~2% to near-total and looked like the fix — then `/summary` filtered a RANGE on it, i.e. exactly the syntactic isolation this block says does not exist. It false-ZEROES for any seat whose commit body carries the harness's own suggested `Claude-Session: https://…` footer, because `ifExists=doNothing` preserves that value and an 8-hex compare never matches it. Better instrument, same class of wrong answer, in the reassuring direction.
> **`git log <session-start-sha>..HEAD | wc -l` and `git log --author=<user>` are BOTH PEER-INFLATED — do not use either for this number.** Every terminal in the fleet commits as the same `git.user`, so `--author` filters **nothing**, and the range is peer-dominated on a shared `main` where 2-4 sessions commit concurrently. Both answer *"what landed on main"*, never *"what did I do."*
> **ENUMERATE YOUR COMMITS BY SUBJECT / tag / known-work**, then paste that count. There is no range expression that isolates a session here — the isolation is **semantic, not syntactic**.
> Occ-1 (2026-07-11): the range said **48**; **5** were the session's. Occ-2 (2026-07-13): the range said **99**; **22** were the session's — caught ONLY by a Step-2 reconcile check, the one part of the lesson pass the <15-min exception may not skip.
> **It bites two surfaces:** this summary count (a FALSE CLAIM to the owner — the worst, because it is asserted as fact); and the **Step-1b-DEEP `>20-commit` trigger** (over-fires — harmless, and the ONLY direction the spec's "peer over-count is safe" note excuses).
> ⚠️ **A pasted number is not automatically a true one.** The Iron-Law demands the count be COMPUTED, not typed — this block is the reminder that a computed count off the *wrong range* is still a false claim, just a well-sourced one.

## Output — why Bottom line exists — from `SKILL.md` § Output

⛔ **THE `Session Summary` TEMPLATE IN `SKILL.md` § Output IS ALL MECHANISM, AND UNTIL 2026-08-12 THAT WAS ITS ONLY REGISTER — so a jargon-dense closer was partial COMPLIANCE with this contract, not deviance from it.** Every slot demands a pasted count or a closure-state token (`dirty_unattributed(N)`, `migration_unrecorded(NNNN)`, `{emitted}→{persisted}`), and nothing anywhere required a sentence the owner could read. Measured: 6 events across 5 sessions in 6 days where a closer line had to be explained before it could be read, **three of which hid a substantive error inside the unparseable clause** — a cost that did not exist, a fork one command dissolved, an invented gate. A sentence the owner cannot parse is a sentence nobody has checked.

## Output — the retired Receipts row — from `SKILL.md` § Output

- ⛔ **The `Receipts:` row is RETIRED for the owner-facing summary** — a typed count with no command behind it now carries its hedge in its own sentence, the way any unverified claim is marked unverified IN the sentence that makes it. Historical form: the summary's 1-3 load-bearing state claims each name the pasted command behind them or carry `unverified` — a typed count with no command behind it is exactly what the row exists to make visible.

## Test gating — the three original objections — from `SKILL.md` § Test gating in /wrap (revised 2026-06-09)

- *"Duplicates work when audit-checks ran"* → still true, so Step 5b **skips** when any `/audit-check` ran (its Check 9 already ran the unit suite). Objection preserved via the condition.
- *"Fires when no feature was marked COMPLETE (irrelevant)"* → **refuted**: a non-feature session (refactor / ops fix / meta / bugfix) can break unit tests with no local gate — exactly an earlier scheduled-job ops incident, where the red surfaced only in CI two sessions later. Non-feature ≠ irrelevant.
- *"Conflates session/feature boundary"* → the counter-point: the session boundary IS a valid "did my work break anything" gate, distinct from the feature boundary. Unit is fast (~2 min) so the gate is cheap.
