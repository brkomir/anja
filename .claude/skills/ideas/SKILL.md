---
name: ideas
description: Show + maintain the product-idea register in IDEAS.md (capture → refine → promote pipeline + rejected-variants record). Use when capturing a new product idea, asking "what ideas do we have / what happened to idea X?", or checking what an ideation run produced. Analogue of /flows and /surfaces for the idea pipeline; companion to /backlog (which owns ranking).
---

# Ideas — Product Idea Register

Read/maintain interface over **`IDEAS.md`** (repo root) — the unranked idea pipeline + disposition record. Sibling of `/flows` (Flow#), `/features` (F#), `/ops` (O#), `/surfaces` (S#) in the tracking-pattern family, but it tracks a PIPELINE (capture → refine → promote/reject), not audit coverage.

**Read-only state-query — carries its own marker `[ideas]`** (every reply is marked) for the default view (same family as `/flows`, `/status`). Write subcommands (`add`, `reject`, state flips) are ordinary edits.

## The division of labor (memorize)

- **`IDEAS.md`** — what we've thought of + what we decided about it (states: 💡 raw · 🔬 refined · 🅿️ gated · ⬆️ PROMOTED · ❌ REJECTED/KILLED). Includes the **Ideation-run corpora** index (bulk runs live in `plans/*.md`; the register indexes them).
- **`BACKLOG.md`** — ranked build queue. Ranking is a **founder decision**; nothing here auto-promotes.
- **Promotion mechanics belong to `/backlog promote`** — it prompts for tier/effort/trigger/tracker-home. On promotion, the `IDEAS.md` row flips to `⬆️ PROMOTED → P#` and STAYS (re-proposal guard); the BACKLOG entry cites `Source: IDEAS.md I#`.

## Usage

- `/ideas` — default view: counts by state, the pipeline table, runs index, staleness flags
- `/ideas add <description>` — capture: append a `💡` row (next I#) + a Details section only if the capture is substantial. Low-friction — no effort/trigger prompting at capture time (that happens at promotion, in `/backlog promote`)
- `/ideas reject <I# or fuzzy title> <reason>` — flip state to ❌ with a one-line reason + date; never delete the row or its detail
- `/ideas promote <I# or fuzzy title>` — thin hand-off: invoke `/backlog promote` on the item, then flip the row to ⬆️ with the assigned P#
- `/ideas review` — refine pass: staleness (>60 days at 💡 with no refinement → surface for drop/refine/promote), duplicate/merge candidates, cross-post flags (`⚠` rows still living in todo.txt), and run-corpora with 0 promotions after >30 days

## Process — `/ideas` (default view)

1. Read `IDEAS.md` (it is small by design — full Read is fine).
2. Count pipeline rows by state; count runs in the corpora table.
3. Render:
   ```
   # IDEAS status — {date}
   Pipeline: {N} ideas — {a} 💡 raw · {b} 🔬 refined · {c} 🅿️ gated · {d} ⬆️ promoted · {e} ❌ rejected
   Runs: {M} corpora ({unpromoted-candidate count} candidates not yet promoted)
   [pipeline table verbatim]
   Stale (>60d at 💡): {list or none}
   ```
4. **A state cell is a CLAIM:** before relaying a load-bearing status as *current fact* (e.g. "I2 awaiting owner go", "0 promoted from the 07-09 run"), git-verify it (`git log --oneline -S'<term>'`, the BACKLOG row, the plans doc) — states rot.

## Rules

- **Never rank, never auto-promote.** Priority is the founder's; this register only records states and evidence.
- **❌ rows are permanent.** They are the rejected-variants surface; the codified-policy check that grepped them (active-recall row) is PARKED with active-recall.md since 2026-09-07, so nothing loaded consults them before a re-proposal — deleting one re-opens a settled question.
- **One idea per need; merge before promoting.** If two rows would share a spec doc, merge them first.
- **I# allocation = max+1, re-check after write** (a read is not a reservation; I# is unguarded like H#). Never renumber.
- **Bulk ideation runs go in the corpora table, not as 20 pipeline rows.** Individual candidates promote straight from the run doc via `/backlog promote` (cite the doc + candidate name); only add a pipeline row if a candidate needs its own refinement life before ranking.
- **Detail sections are provenance — verbatim, append-only.** Update state in the table; append dated addenda (spikes, panel outcomes) to the detail section. Don't rewrite history.

## Coordination

- `/backlog` — owns ranked tiers + promotion mechanics; its `add` delegates here (ideas moved out of the backlog into their own register). `/backlog review` scans the task tracker and the plans directory for promote candidates; ideas-side staleness lives in `/ideas review`.
- `/wrap` Step 7c.3 — end-of-session "we should add X" signals not acted on → captured HERE.
- `/meta learn` Step 1 "we should add X / track Y — stated but no action" → maps to `/ideas add`.
- Ideation runs (`/expert-review` ideation panels, Fable sweeps) → run doc in `plans/` + one corpora-table row here, same session (else the run goes invisible — not being able to tell whether an ideation panel had been persisted at all is the incident this file answers structurally).

## Why this skill exists (codified 2026-07-10)

The backlog's ideas section drifted: two entry formats (broke date scans), KB-long single-bullet entries (spike reports, panel outcomes), states encoded only in prose (KILLED / PANEL-RESOLVED / do-NOT-promote), and bulk ideation-run corpora with no index — nobody could tell whether a 39-agent run was even persisted. Same pattern as the backlog's own split from the task tracker: **dedicated surface per concern.**
