# `/review-hub --takeover` — SUPERSEDED section (moved, with the copy's edits, from SKILL.md, 2026-09-29)

Moved by the review hub to bring `SKILL.md` under the 140,000-character warn line. The text below was byte-identical to SKILL.md at the commit before the move, before the copy's edits; `SKILL.md` keeps a pointer. Normal handover is `--await` + `--handover` (§A-§E in SKILL.md).

### ⏸ `/review-hub --takeover` — SUPERSEDED 2026-09-12 by `--await` + `--handover` (§A-§E in SKILL.md)

⛔ **NOT THE NORMAL PATH ANY MORE. Read §A-§E first.** Kept for exactly two cases: an incumbent that has STOPPED ANSWERING (where no `--handover` can be invoked because the seat that would invoke it is unresponsive), and its warrant mechanics, which are the only machinery in this file for authenticating an owner instruction that arrived at the wrong seat. **Everything below is still accurate about ITSELF** — it is the routing that changed, not the mechanics. ⚠️ Its own first step cannot be satisfied on a first turn: a slash-command invocation is `promptSource=None`, so `/review-hub --takeover` typed alone yields NO warrant, by construction, every time. That defect is why `--await` + `--handover` replaced it.

*Original heading: the successor SIGNALS, the incumbent CONSENTS, then the claim moves.*

⛔ **OWNER-INVOKED ONLY, and that is load-bearing rather than ceremonial: the owner's typed
directive is what the signal CARRIES.** A session cannot mint this for itself — the warrant
below resolves to a human primary record or it does not resolve at all.

**Use this instead of `--retire` whenever a successor session exists.** A retiring hub cannot
name a successor that does not exist yet and cannot wait for one that may never arrive, so
`--retire` alone can only ever end in a VACANCY. A takeover ends in a NAMED LIVE HUB.

⛔ **NEVER TWO LIVE HUBS.** A split fleet routes half its reviews to each and neither hub knows
it is half — strictly worse than a vacancy, which at least is loud and has a named remedy. Every
rule below serves that one invariant: **the successor stamps nothing and claims nothing until
the incumbent has consented.**

⛔ **THE CLAIM IS THE LAST STEP, NOT THE FIRST — corrected after the
old order deadlocked live.** This section used to open with `fleet-claim review-hub` and say
"LOST names a winner — ack them and STOP, you are not the hub." Against a LIVE incumbent that
outcome is guaranteed (a live hub holds its claim by definition), so the command could never
proceed, and its own "Incumbent LIVE → announce the takeover" branch three steps below was
UNREACHABLE. Measured: a successor session ran `--takeover`, got LOST from the live incumbent (lifecycle
CHECKPOINT, no `.retiring`), and correctly stopped with nothing done. **The election was right
and the ORDER was wrong** — succession needs the holder's CONSENT, and the old sequence asked
for the claim before anyone had asked for the consent.

1. **DERIVE THE WARRANT from this session's own transcript** — the owner's directive record,
   as `<sid8>:<YYYY-MM-DDTHH:MM:SSZ>` at seconds precision. Do not type a timestamp from
   impression; extract it with the tool's own predicate so your instrument and the validator
   cannot disagree by construction:
   ```
   python3 -c "import importlib.util,json,glob; s=importlib.util.spec_from_file_location('sm','scripts/session-manifest.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); [print((d.get('timestamp') or '')[:19]+'Z') for d in (json.loads(l) for l in open(glob.glob('<transcript>')[0],errors='ignore')) if m._record_is_human_primary(d)]"
   ```
   Validate it, **with a negative control**, before it rides the bus:
   `m._validate_authorized_by('<sid8>:<ts>')` must return `(True, …)`, and a timestamp an hour
   off must return `(False, …)`. ⛔ **A `--takeover` with no verifying warrant is not a takeover
   — stop and tell the owner.** ⚠️ A slash-command invocation is a record of shape
   `promptSource=None` and is NOT a human primary record: `/review-hub --takeover` typed alone
   yields NO warrant. The owner's directive must be a typed message. If the owner only typed the
   command, ask the owner for the instruction in words.
2. **SIGNAL the incumbent** — `mail-send --to <incumbent> --signal hub-retire-demand
   --authorized-by <sid8>:<ts>`, body carrying the owner's instruction **QUOTED IN FULL, verbatim**.
   The full quote is the point, not politeness: the incumbent grep-authenticates it against
   your transcript, and a paraphrase is exactly what cannot be authenticated. Say what you are
   NOT doing (no marker stamped, no claim taken, no `--force`) so the incumbent can see the
   invariant is intact. The signal token is unlisted in the wake denylist, so it WAKES them.
3. **WAIT for the `.retiring` stamp.** That stamp IS the consent; nothing else is. Do not
   announce, do not stamp a marker, do not claim. ⛔ **`--force` is NOT the escalation path** —
   its stated precondition is "provably dead", it is unenforced at all three gates, and the cost
   of using it here is never this succession: it is the NEXT force, over a genuinely live holder,
   by someone who learned here that the precondition is decorative. **If the incumbent cannot or
   will not answer, escalate to the OWNER**, who can stamp the marker (the owner's consent
   outranks both sessions) or rule otherwise.
4. **CLAIM, now that consent exists** — `fleet-claim review-hub`, which needs no override flag
   once `.retiring` is stamped. Read the MESSAGE, not the exit code: three outcomes share rc=3.
   ⛔ **LOST names a winner — ack them, STAMP NOTHING, and STOP: you are not the hub, and step 5's
   marker is what would make you the second one.** *(This imperative was DELETED by the very rewrite
   that created this step: at HEAD its only surviving copy sat inside the ⛔ paragraph above, quoted
   as the retired WRONG behaviour — a directive that became a quotation of a retired directive.
   Restored 2026-09-06. Note the inversion that hid it: under the OLD order LOST
   was guaranteed, so a missing instruction would have been noticed instantly; under the new order
   LOST fires ONLY in the race — precisely when two hubs are one line away.)* REFUSED is a
   NEAR-match — read `--list` before deferring. COULD NOT VERIFY means the write landed and the
   read-back was empty — **`--check` before STAMPING**, not merely before announcing: the marker is
   the hub-identity signal, so every guard phrased *before announcing* still permits stamping first.
5. **ARM + STAMP + ANNOUNCE**, in that order. Arm the listener with `--rebroadcast-hours 48`,
   stamp your own hub marker (Phase 1) so an arriving request has somewhere to land, then
   announce `--to all`: your sid · the outgoing hub's sid and state · **"open loops stay with the
   outgoing hub, new requests come to me"** · and whether its inbox is still read.
   ⚠️ Arming early is fine and good; **stamping early is not** — the marker is the hub-identity
   signal, so a marker stamped before the claim transfers is the two-hub split.

**EXCEPTION — an incumbent that has EXITED needs no signal.** `lifecycle_status` EXITED already
counts as stood-down (mail to it lands nowhere, so waiting on an ack strands the fleet
deterministically). Skip to step 4 and say in the announcement that you are filling a VACANCY
rather than taking a handover — a takeover announcement naming a seat that cannot act is the
designates-nobody defect wearing the opposite costume.

