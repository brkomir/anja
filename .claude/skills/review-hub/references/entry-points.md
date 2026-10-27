# Review Hub — the entry points: the flags and subcommands table, moved, with the copy's edits, from `SKILL.md` on 2026-10-26 (so Phase 3 ends inside the compaction carry); in its cells, "this file" and "below" mean the core `SKILL.md`, and the core wins a disagreement

## Entry points

| flag | what it does | where its text lives |
|---|---|---|
| `/review-hub` | become the hub on a fresh role: Phase 1 (arm the listener, the poller and the usage watch; stamp the marker), Phase 2 (broadcast), then Phase 3 per delegation | § Process, this file |
| `--await [<incumbent>]` | the incoming session: stamp AWAITING, write the manifest, arm the listener, mail the incumbent, WAIT; it claims nothing and broadcasts nothing | `references/handover-and-retire.md` §A |
| `--handover <sid or name>` | the current hub: stamp `.retiring` with the target FIRST, broadcast `hub-handover` (naming the usage watch), partition the work (queued transfers, started stays), the DONE broadcast, then hold for his `/wrap` go | `references/handover-and-retire.md` §B-§E |
| `--retire` | stand down in the fixed order: `.retiring` first, the queue by command, the dismissal ledger preserved, a broadcast ending in VACANCY or a successor CONFIRMED by ack, the inbox state, forward-only, teardown last | `references/handover-and-retire.md` § `/review-hub --retire`; `references/disciplines.md` § Phase 4 |
| `--pause` · `--resume` | hold new reviews, panels and seats until his word; running seats finish and their verdicts go out; `--resume` lifts the pause only, re-arms the usage watch and reads the open deploy holds | § ⏸ `/review-hub --pause` below, steps 1-5 |
| `--pause --when usage>=N` | the same pause, entered by the usage watch at N% of the five-hour window (97% weekly) and lifted at the reset or on an account switch below N | § ⏸ `/review-hub --pause` below, steps 6-10 |
| `--pause --disarm` | the pause as written, then `/pre-compact --disarm` through the Skill tool in the same turn | § ⏸ `/review-hub --pause` below, step 11 |
| `--takeover` | superseded 2026-09-12 by `--await` + `--handover`; the unresponsive-incumbent route only | `references/takeover-superseded.md` |
