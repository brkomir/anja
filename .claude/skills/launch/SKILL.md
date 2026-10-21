---
name: launch
description: Show launch-readiness status from the LAUNCH.md runbook — critical-path / in-control / discretionary / paid-launch tracks, with done/open counts and the next action. Use when asking "where are we on launch?" or "what's left before we can ship?". Companion to /flows + /ops (audit coverage) and /launch-check (on-demand cross-system checklist generator).
---

# Launch Runbook Status

Show the current state of the launch checklist. Read-only — reports status, never mutates `LAUNCH.md` (checkbox edits are manual, made as items actually close).

## When to Use

When the user types `/launch` or asks about launch readiness / "what's left before we can ship?" / "are we on track for the date?".

**Distinct from:**
- `/launch-check` — the **command** that *generates* a fresh cross-system readiness checklist by inspecting code/config. `/launch` *reads the persisted tracker* (`LAUNCH.md`) — the ordered runbook with status.
- `/flows` + `/ops` — audit-coverage trackers (which surfaces have been audited). `/launch` is the go-live execution checklist (deploy / vendor / dashboard / ops steps), most of which are owner actions, not audits.

## Instructions

1. Read the runbook at `LAUNCH.md` (repo root). It's small (~90 lines) — read it whole.
2. **Parse checkbox state per section.** Items are markdown checkboxes with IDs (`CP-1`, `B-2`, `D-1`, `P-1`). `- [x]` = done, `- [ ]` = open. Count per track with:
   ```bash
   python3 - <<'PY'   # python, not awk: a skill invoked WITH arguments has awk's dollar-digit fields replaced by the argument words
   total, done, sec = {}, {}, ""
   for l in open("LAUNCH.md", encoding="utf-8"):
       if l.startswith("## "): sec = l.rstrip("\n")[3:]
       if l.startswith("- [x]"): total[sec] = total.get(sec, 0) + 1; done[sec] = done.get(sec, 0) + 1
       elif l.startswith("- [ ]"): total[sec] = total.get(sec, 0) + 1
   for s in total: print(f"{s:<48} {done.get(s, 0)}/{total[s]}")
   PY
   ```
   Never report status from a prior `/launch` invocation in session memory — re-read the file (~1 sec); checkbox state drifts as the owner works.
3. **Read the two-tier model table** at the top — surface each tier's current target date and launch framing. If the target date is in the past, flag it.
4. **Stale-pointer sweep (mirror of /flows tracker-row mechanical update).** Each item points at a canonical home (`todo.txt:N` or `BACKLOG #`). Do NOT re-verify every pointer on a routine read (too costly), BUT: if an item is still `[ ]` open while its canonical `todo.txt` line is `[x]` done (spot-check the 🔴 critical-path items only — they're the load-bearing ones), surface it: "CP-3 open in LAUNCH.md but todo.txt:333 is `[x]` — runbook checkbox is stale." Don't silently report stale state on the critical path.
5. **Surface the GO gates:**
   - **Soft-launch GO** = all 🔴 (CP) + all 🟠 (B) closed.
   - **Paid-launch GO** = soft-launch GO + 🟢 P-1 + P-2 closed.
6. Highlight the **next action** — the first open 🔴 critical-path item (these gate everything; calendar-bound, not effort-bound). If all 🔴 are closed, point at the first open 🟠.

## Output Format

Concise status grouped by track. One line per track with done/total + the open item IDs. Then:
- **Target date** + on-track / at-risk read (compare open critical-path items against days remaining; any external-clock items — a vendor verification or review that runs on its own calendar — are the binding constraint, call them out explicitly if open).
- **Soft-launch GO:** ✅ / ❌ (N items remain: …)
- **Paid-launch GO:** ✅ / ❌ (gated on its external go-live items + …)
- **Next action:** first open 🔴 item, framed as the owner/Claude action it needs (👤 owner / 🤖 in-repo per the LAUNCH.md legend).

Keep detail rows only for the track currently in focus (the first track with open items); one-line counts for the rest.

## Principles

- **Read-only.** `/launch` never ticks a checkbox. Items close when the owner (or Claude, for 🤖 items) actually does the work and edits `LAUNCH.md` — same discipline as not faking tracker-row flips in `/flows`.
- **The critical path is the headline.** Most 🟠 in-control blockers fit any 2-week window; the 🔴 external-clock items (vendor verifications, deploy, domain cutover — anything waiting on a third party's calendar) are what actually determine the date. Lead with those.
- **No human-time padding.** When reading the date, state the binding external clock — a vendor's published review turnaround, a real SLA — not invented effort estimates for owner work (per LARP markers).
- **Don't duplicate detail.** `/launch` reports the runbook's ordering + status; the canonical detail stays where each item points. If the user wants to *edit* an item, route them to that canonical home.

## Response-mode prefix

`/launch` is a read-only state-query skill (same class as `/flows`, `/ops`, `/status`) — emit output prefixed **`[launch]`**. ⛔ **The mode marker is visible.** This section previously said *unprefixed, no `[launch]` prefix*, which directly contradicted the house rule that every command's output carries the command's own name as its marker. A seat reading this spec at the moment of use would have followed the wrong one.
