# Step 0 — gate comments and post-compact-gate history — moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## The marker gate — why three branches — from `SKILL.md` § Process

```bash
# THREE branches, not two. A bare CLEAR cannot tell "no marker ever existed" from "this
# session's own /meta post-compact deleted one seconds ago" — and the second is VACUOUS: the
# gate reads state this session removed, so it COULD NOT HAVE FAILED while presenting as a
# check that passed. Measured 2026-08-26: marker cleared 21:31:01Z, gate reported CLEAR
# 21:31:39Z — 38 s apart, same variable. `/post-compact` Step 8 now drops the breadcrumb
# this reads; it is ADDITIVE and no other consumer knows the name, so the `rm` it sits beside
# is unchanged (`wrap-reconcile.mjs` and three hooks still read the PENDING marker as before).
```

## The marker gate — the CLEAR wording is the predicate's — from `SKILL.md` § Process

```bash
# ⛔ THE WORDING IS THE PREDICATE'S, NOT THE HOPE'S. This read "no marker EXISTED for THIS
# session" until 2026-09-03 — a claim about HISTORY that `[ ! -f "$C" ]` cannot support, and
# false in exactly the world the breadcrumb exists to catch: a clear that wrote no breadcrumb.
# `wrap-reconcile.mjs` and `/post-compact` Step 8 now both prescribe the breadcrumb, so that world is
# shrinking, but a hand-typed bare `rm` still reaches it and this branch still cannot see it.
# The wording got stronger while the predicate did not.
```

## Queued-directive residue scan — founding incident — from `SKILL.md` § Process

```bash
# OWNER MESSAGES THAT WERE QUEUED AND NEVER DELIVERED — rc=3 means residue, and residue is a
# WORKLIST you READ, never a count you report. Added 2026-09-07 after two owner directives were
# enqueued at 23:28Z, popped, and never became a turn; that session's closer four minutes later
# read "Next - me: nothing queued" and another pass found them ~40 min later. There is no
# in-session tell: a queue-operation carries no promptSource and is invisible to every
# owner-speech probe keyed on type:"user". ⚠️ It cannot separate a dropped delivery from a queue
# the owner cleared — surface the rows to the owner, do not narrate a harness fault.
```

## Orphaned-prompt scan — founding incident and the wrong predicate — from `SKILL.md` § Process

```bash
# AND THE SIBLING GAP THE SCAN ABOVE IS STRUCTURALLY BLIND TO: an owner message that
# arrives as an ORDINARY TYPED RECORD and never gets a turn. There is no queue op to find,
# the record looks completely normal, and nothing in-session tells you. Measured 2026-09-19:
# 2 of 37 typed owner prompts were delivered and never answered — one
# carried an action the session awaited, and the wrap that
# followed it listed the owner's messages for the session without it. Both were found only
# because parentUuid was read by hand.
# ⛔ THE OBVIOUS PREDICATE CANNOT FIND THEM AND READS CLEAN: the harness attaches a
# total_tokens_reminder as a child of EVERY user message, so "is this uuid anybody's parent"
# scores an orphan ANSWERED. It must be an ASSISTANT record in the subtree. That wrong
# predicate was run here first and returned 0 against a true 2.
```

## Checkpoint flag — spelling and marker history — from `SKILL.md` § Process

```bash
#   The command flag and the script flag are now the SAME WORD, deliberately — see the
#   modes-compose section above. If that reads redundant, that IS the alignment.
#   Until 2026-08-26 both modes wrote a byte-identical marker and this spec said so
#   ("the lifecycle marker is 'wrapped'/done-for-now either way; a framing rule, not a
#   state change"), so a checkpoint was indistinguishable from a close to /whoami, /peers,
#   the overlap gate and every peer. It is a state change now: --checkpoint derives
#   CHECKPOINT instead of WRAPPED. Both stay NON-TERMINAL and identical to every gate.
```

## Post-compact gate — the mid-wrap compaction measurement and corrected mechanism — from `SKILL.md` § Process

**Measured:** Step 0 printed `✅ GATE CLEAR — no marker` at `11:33:02.965Z`; the marker was written at `11:33:03` — **35 ms later**; the compaction summary landed at `11:35:03.957Z`. **The gate was CORRECT when it ran.** There was no marker to find, because the compaction had not started yet.

⚠️ **THIS CLAUSE FIRST SHIPPED WITH THE WRONG MECHANISM AND IS CORRECTED IN PLACE.** It said the marker is written by the SessionStart(`source=compact`) hook, "whose output arrives in the system-reminder attached to the FIRST tool result of the resumed turn". Both halves are false, and one grep settled it when this was written (the counts below are as measured then): `grep -cF 'post-compact-pending' .claude/hooks/session-start.sh` → **0** (it only PRINTS the directive); `.claude/hooks/compact-save.sh` → **2**, the hook that writes the marker, which the source project wires to **PreCompact**. The marker in the measured case predates SessionStart by **two minutes**. I reasoned the mechanism from the symptom instead of reading the hooks, and the symptom is compatible with both stories.

**What the corrected mechanism changes:** the failure is not "a hook arrives late", it is **"a gate you ran correctly describes a state that no longer holds"** — which generalises past that gate to every Step-0 reading in a procedure long enough for a compaction to fire inside it. A wrap is dozens of turns.

## Post-compact gate — why a step, and the enforce layer — from `SKILL.md` § Process

**Why a step and not just the EXISTING prompt-keyed hook.** `compact-save.sh` (PreCompact) stamps the marker and `post-compact-pending-check.sh` (UserPromptSubmit) re-surfaces it on every **prompt** — but a `/wrap` is ONE prompt and dozens of turns, so a prompt-keyed net can never interrupt a wrap already in flight. **A gate keyed to a boundary the procedure crosses only once cannot interrupt that procedure.** This does NOT generalize to "no hook can": neither a PreToolUse nor a Stop hook is prompt-keyed. PreToolUse is the wrong primitive (printing ✅ is text, not a tool call); a **Stop hook returning `exit 2`** fires outside the wrap's control flow and is the real hard-stop — the block-mode graduation named in Step 11. Evidence: 2026-07-10, an auto-compaction fired *inside* a `/wrap` at 07:59:38Z; the directive printed at the top of a turn already committed to Step 0 and went unnamed for eleven tool calls — after the identical skip had been corrected earlier the same session. It was not rationalized away; it was never considered. The `[wrap]` prefix is the tell: the response-mode marker announces which checklist owns the turn, and the checklist ate the interrupt.

**Enforce layer (COMPUTED, not self-attested).** `scripts/wrap-reconcile.mjs` (Step 11) reads the marker *before* its own transcript gate and pushes it into `findings[]` when it stands, so **the TOOL withholds `ok:true`**. It is warn-mode (exit 0 always): it cannot literally stop the orchestrator typing ✅ — honoring it is the orchestrator's job until the **Stop hook (`exit 2`)** that `SKILL.md` Step 11 names lands. Saying "the wrap CANNOT print ✅" was false at the behavioural layer; the tool's refusal to say `ok:true` is what is true. Guarded by a discriminating, mutation-checked pair in `scripts/smoke-test-hooks.sh` (marker present → must report; marker absent → must stay silent). Generalizes: any mandatory gate that fires *during* a long procedure gets absorbed by it — name it in the next response, then continue.

## Inbound-mail peek — placement and latency rationale — from `SKILL.md` § Process

- **Placed BEFORE the `wrapped` stamp** ("check the inbox, THEN signal done-for-now") so an actionable handoff surfaces while you can still choose to address it before the wrap completes — not after.
- **Not a correctness fix, a latency one.** Per the lifecycle model a wrapped session is still live, so missed mail isn't LOST (it re-surfaces at the next resume) — but "done-for-now" can be a while and you're often actively coordinating, so the ~150ms wrap-time surface is worth it.

## Lifecycle marker — how the WRAPPED stamp works (8-hex key) — from `SKILL.md` § Process

**Lifecycle marker (shipped 2026-06-03):** `session-lifecycle.py wrapped` re-stamps `.claude/state/session-wrapped-<8-hex>` on every `/wrap` run — ⛔ **the 8-HEX PREFIX, not the full UUID: `session-lifecycle.py` returns `raw[:8].lower()` and joins `session-wrapped-{sid}` from it, so an `ls .claude/state/session-wrapped-$CLAUDE_CODE_SESSION_ID` verification FALSE-NEGATIVES and reads as a failed stamp.** Measured 2026-09-07: the stamp printed `marked WRAPPED` and the full-variable `ls` in the SAME call returned `No such file or directory`; the 8-hex glob found it. Every other marker this spec names is keyed on the full id, which is what makes `<sid>` here read as one (tracks the MOST-RECENT wrap intent — correct under the 2-5× re-wrap pattern). This is "done-for-now," NOT "exited." The terminal "exited" signal is written ONLY by the `SessionEnd` hook (`.claude/hooks/session-end.sh`, which passes the end `reason` to `session-lifecycle.py`, where only the logout and prompt_input_exit reasons write it) — the agent cannot write it (no turn left at exit). Derived status: `python3 scripts/session-lifecycle.py status`. The `SessionStart` hook (`session-start.sh`) emits a REOPENING advisory if a resumed session already wrapped (kills the re-wrap loop) + deletes marker files past their age limit (housekeeping; the crash-recovery sweep that inferred exits was removed). Do NOT add a date-keyed flag or invalidate-on-continue logic — status is derived from marker presence (derive, don't store), markers are session_id-keyed (the chain is built on `vinicius91carvalho/.claude`'s signal-gated Stop pattern), terminal vs intent are separate-writer markers.
