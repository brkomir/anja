---
name: report
description: Build ONE self-contained local HTML page that shows one session topic, arc, run or artifact in detail — visually and structurally, one row per item, images that open full-size, colour for right/wrong, the numbers in cells, the answer at the top. Use when the owner asks for a report, when a subject has more than about three moving parts (a multi-frame verdict, a model comparison, a smoke or eval run, a fork with measurements), or when a readout would otherwise be a long prose wall.
---

# /report — one subject, shown so the owner can orient in it

**Invocation: `/report <subject>`** where the subject is an arc name, a run or artifact (a results JSON, a
tee log, a judge file), a plan doc, or the word `session` (this session's work). Bare `/report` reports
the subject the session is currently on.

**Marker `[report]`.** It WRITES: the page, its assets, and one records commit under `plans/`. It never
touches trackers, memory, mail, or code. The command exists so that one session topic, or a session's
work, is shown in detail and is visually and structurally well laid out and easy to read. It codifies a
standing preference: a complicated subject is explained visually, as an HTML page the reader can orient
in, because a wall of chat text on a non-trivial matter is harder to read than it needs to be — a smoke
run before a cert, for example, is read as a report: the image, the full-size image on click, and a
results table.

## Distinctions — what this is NOT

| Command | Shape | Answers |
|---|---|---|
| `/summary` | sectioned readout + plan table, in chat | where is THIS SESSION, what needs the owner |
| `/eli5` | narrative, in chat | what is going on and why, the story |
| `/explain` | one audited sentence, in chat | what did YOUR sentence mean |
| **`/report`** | **a PAGE on disk, opened locally** | **one subject shown in full — items, images, numbers, verdicts** |

If the answer is three sentences, it is not a report; say it in chat. If the answer is a table of items
with images or numbers behind them, it is a report even when nobody asked for one — build it and hand
the pointer.

## ⛔ The Iron rule — DERIVE every cell, and say on the page what was not

Every number, verdict and label on the page comes from an artifact read THIS invocation (a results
JSON, a ledger row, a judge file, a set file, a tee log), never from context or a compaction summary.
The plain-register rule applies to the PROSE on the page and to the chat reply; the page's CELLS carry
the apparatus the prose strips — file names, shas, per-draw counts — because that is what the owner checks with.
A number the page cannot source gets a visible **unverified** mark in its cell, never a footnote.

## The page contract

1. **Self-contained and offline.** One `.html`, inline CSS (the house stylesheet below), system fonts,
   no CDN, no script unless a control needs one. Opens from `file://` on the owner's box.
2. **The answer at the top.** Under the `<h1>`: a `.note` paragraph of at most three sentences and about
   80 words — what the page shows, the verdict or recommendation, the one caveat. The owner reads this first and
   may stop there. Directly under it, one `.meta` line in plain words saying when and from what the page
   was built — *"Built 2026-09-20 09:45Z from commit <sha>; covers runs up to 09:30Z"* — and, when the
   code the page measures has changed since, *"Out of date: the gate changed at <sha>"* instead of a
   paragraph about the working tree (the owner once had to ask whether a page was up to date when its only sha
   sat in its last paragraph).
3. **One row per item.** A `<section class="row good|bad|mixed|silent">` per frame / model / version /
   decision, in the order that answers the question (worst first for a triage, corpus order for a run).
   Each row: `<h2>` with the item's name and a `.tag` verdict; a `.meta` line with the label, the
   source file and the counts; the images; then the quotes or numbers.
4. **Images: thumbnail on the page, full size on click.** `<a href="<full>"><img src="<thumb>"></a>`.
   Thumbs go beside the page in `<page-stem>/thumb-<key>.jpg` (≤ 480 px wide, `node -e
   'require("sharp")("<src>").resize({width:480}).jpeg({quality:80}).toFile("<dst>")'`); a 1:1 crop of the
   key detail is a second image with class `crop`. The full-size `href` is a COMMITTED copy under the
   same folder when it is small enough to commit (≤ ~2 MB), else the local cache path
   (`eval/.frame-cache/…`) — and then the `.note` says the full-size links work only on this machine.
5. **Colour carries the verdict, never alone.** `good` (green) right / better; `bad` (red) wrong / worse;
   `mixed` (amber) split; `silent` (grey) abstained / no data. The `.tag` text says the same in words.
6. **The numbers in cells.** A results `<table>` at the end (or the top, for a run): one row per item,
   one column per measured quantity, the totals row last. Per-model or per-version comparisons are
   side-by-side columns of ONE table for the arms the question compares (about three); extra arms
   (bisect legs, controls the owner did not ask about) go in a second table below it, so the main table stays
   under about eight columns (a 20-column bisect page drew a complaint about too many columns,
   2026-10-19; its 8-column rebuild drew rulings). Tokens, dollars and timings go in a closed
   `<details>` after the results, never above them. The `.note` and the cells never disagree: a verdict a
   later step changed shows both, `FAIL (paid run) → PASS ($0 replay)` (a page whose cells still read
   fail after a later pass drew the question why, 2026-10-20).
7. **Sources at the bottom.** A `.meta` paragraph naming every artifact the page was derived from
   (file names, shas, the command that produced them) so a reader can regenerate it.
8. **Decisions, if any, in their own block** near the top: what needs the owner, my recommendation first,
   what happens if the owner says nothing — the `/summary` §2 rule, rendered.
9. **A legend in plain words, and what the owner is asked to judge.** Directly under the `.note`: one line per mark
   drawn on an image (each box, line and colour) and per column header that is not plain English, saying
   what the mark IS in the photograph and what it tells the owner — never the name of the computation behind it
   (*"p5/p95 mass extent (the gate's witness)"* drew a request for a legend from a page that had a legend,
   2026-09-15). Then a "What to judge" line as an if/then: *"if the subject reaches the
   edge, the fire is wrong; if it stops inside, the fire is right."* Grey (`silent`) means no data; a row
   waiting on the owner's ruling is amber with the tag "your call", never grey. A page built for a review panel
   shown to the owner carries all of this too, with the panel's apparatus in a closed `<details>`.

### House stylesheet (lift verbatim; extend, do not restyle)

```css
body{font:15px/1.45 -apple-system,Helvetica,Arial,sans-serif;margin:24px auto;max-width:1500px;padding:0 20px;color:#222;background:#fafafa}h1{font-size:22px}h2{font-size:18px;margin:0 0 6px}.row{border-left:6px solid #999;padding:14px 18px;margin:18px 0;background:#fff;border-radius:6px}.row.bad{border-left-color:#c0392b}.row.good{border-left-color:#27ae60}.row.mixed{border-left-color:#e67e22}.row.silent{border-left-color:#999}.tag{font-size:13px;font-weight:600;padding:2px 8px;border-radius:10px;background:#eee;margin-left:8px}.bad .tag{background:#fde2df;color:#8a1f12}.good .tag{background:#dff5e6;color:#14602c}.mixed .tag{background:#fdebd0;color:#7d4a00}.meta{color:#444;margin:4px 0 10px}.imgs{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}.imgs img{max-width:760px;width:100%;height:auto;border:1px solid #ccc}.imgs img.crop{max-width:720px}.imgs a{flex:1 1 480px}.quotes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}.quotes div{background:#f4f4f4;padding:10px 12px;border-radius:6px}.quotes p{margin:6px 0 0;color:#333}.judge{color:#555;font-size:14px;margin-top:10px}.note{background:#fff8e1;padding:10px 14px;border-radius:6px}table{border-collapse:collapse;margin:14px 0;font-size:14px}th,td{border:1px solid #ddd;padding:6px 10px;text-align:right}th:first-child,td:first-child{text-align:left}tr.total td{font-weight:600;background:#f4f4f4}
```

## Process

1. **Name the subject and the question it answers** in one sentence, and the artifacts that hold the
   answer. No artifact ⇒ the subject is a narrative and belongs in `/eli5`, not here; say so.
2. **Read the artifacts** — the set file for labels, the results / judge / ledger files for numbers,
   the tee logs for what fired. For a run, one row per frame; for a comparison, one column per arm.
3. **Generate, do not hand-type, when there are rows.** A page over an artifact is produced by a small
   script — `scripts/report-<slug>.mts` when the shape will recur (a smoke, a cert, a judge run), the
   scratchpad when it will not — that reads the artifacts and emits the HTML plus the thumbs. Hand-typed
   cells are where restatement errors live (`/summary`'s founding incident). A narrative report over a
   decision or a method may be composed by hand, with every number sourced.
   **Generators (none of the scripts named here is in this copy):** the recurring ones live in `scripts/report-*.mts` (`ls` them; every one imports
   `scripts/lib/report-page.mts`); a one-shape page may commit its generator beside it as `<page>.gen.mts`.
   Their shared chrome (`shortName`, the note-sentence gate, the provenance stamp, the render check) lives in
   `scripts/lib/report-page.mts` and frame-cache resolution in `scripts/lib/focus-frame-cache.mts`:
   a new generator IMPORTS both — the judge generator hand-copied the chrome and four already-paid findings
   came with it, one blocking and one serious finding among them.
4. **Write it under `plans/<arc>/report-<slug>-<YYYY-MM-DD>.html`** (assets in
   `plans/<arc>/report-<slug>-<YYYY-MM-DD>/`), never under `/tmp`, never online
   (on disk first, an online artifact only when the owner asks —
   there is no delete for one). A page named any other way drops out of every count of these pages
   (one was missing from a 2026-10-25 census of 93).
5. **`open` it** (macOS) BEFORE writing the chat reply:
   the owner should be looking at the page while the owner reads the answer. It is the step that gets skipped: `open` ran in
   14 of 19 invocations, 2026-09-11 to 2026-10-25. Before `open`, the generator runs
   `assertRenderResolves` (`scripts/lib/report-page.mts`): every local `src`/`href` target inside a tag
   (either quote) exists, and, when the generator passes a row count (every generator but `report-smoke`, whose
   rows have no single item list, so its row count goes unchecked), the row count equals the items the
   subject names. Three pages opened in one session failed exactly that
   (2026-09-17 and 2026-09-19: one with seven rows of the wrong frames and an empty
   assets folder, two whose images did not render). There is no privacy exception: no photo used on these pages is private,
   so every target is committed beside the page and the check has nothing to skip.
6. **Commit** the page + assets + generator with `scripts/safe-commit.sh` (explicit files, own counts);
   a `--signal info` FYI to the live hub per the records rule; a `--code` request when a reusable
   generator under `scripts/` shipped.
7. **The chat reply is the answer plus the pointer**, plain register: the three-sentence verdict from the
   page's `.note`, the file path, and what needs the owner. Never the page's contents re-typed in chat: no table
   and no sha in the reply, since the page's cells carry those (2 of 19 replies put a markdown table in chat,
   one with shas in its cells, and the 5 replies measured for length on 2026-10-25 ran a median of 424
   words against a `.note` of about 80).

## Anti-scope

- Not for a single number or a yes/no — chat. Not for session STATE — `/summary`. Not for the story —
  `/eli5`.
- No tracker, memory, decision-log or rule writes from here; if the report surfaces a defect, name it in the
  reply and file it as a separate act.
- Never publish online, never a `.md` rendered as a page, never a page that needs the network.
- A page is not a substitute for the artifact: every cell links back to what produced it.

## Revisit

- Reopen signal: an owner message carrying the page's `file://` path, or a `[Image #N]` of one of its rows with a question. Measured 2026-09-11 to 2026-10-25 over 120 transcripts: 4 path pastes on 3 pages, 12 row screenshots after 4 pages, of 19 pages built under this command. 3 pages in a row with neither ⇒ the format is too heavy — shorten.
- Too-little-source signal: a row screenshot whose question the row should have answered (a question asking why one row's score had not flagged it and what its prose said, 2026-10-19), or `/eli5` / `/explain` within an hour of the page — 6 of 19 pages drew one, 4 of those quoting the CHAT reply's closing list and 0 a page cell. Either ⇒ add the per-item sources inline rather than at the bottom, and put the decisions on the page (contract item 8) rather than re-typing them in chat, which is where the owner quotes from.
- If the owner asks whether a page is current (baseline 2 in the same window, 2026-09-15 and
  2026-09-20), the build line under the note is missing or unclear.
- If a generator gets written twice for the same artifact shape, promote it to `scripts/` and name it here. *Fired
  2026-09-13 — the two generators were named in Process 3; since 2026-10-25 Process 3 points at `scripts/report-*.mts`
  and the shared lib they import.*
