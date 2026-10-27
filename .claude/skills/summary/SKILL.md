---
name: summary
description: Mid-session state readout — where THIS session has landed, what is blocked on the owner, what is still in flight. Use when the owner asks where things stand mid-session, especially in long multiday sessions after compactions. Every number derived live, never restated from context. It writes exactly one artifact — this session's working plan — and may update ANY part of it, the derived fence and the hand-written sections alike, correcting in place rather than regenerating.
---

# /summary — where this session has landed, right now

**The core, carried across every compaction.** Every clause's why is VERBATIM in `references/` (`summary-detail.md` · `tracker-row-predicates.md` · `unreviewed-commits.md` · `plan-table-and-output-shape.md` · `cases.md` (not in this copy)). The core wins. **Appending:** DIRECTIVE + TELL + the number the action needs here; the why to the reference, same commit.

**Mid-session**, owner-facing: the **net position** and **what needs them**. Marker `[summary]`. No commits, mail or tracker edits. ⛔ **ONE artifact — this session's working plan — and nothing else on disk moves**; inside it, write ANYWHERE, but ⛔ **CORRECT IN PLACE, NEVER REGENERATE:** a correction REPLACES; rows are edited in place, never deleted or aged out; closure is a dated status flip; rewrite a hand-written section only where it is WRONG, saying what it said; never delete one because this run did not re-derive it.

## Distinctions — what this is NOT

`/status` = the **project** · `/orient` = session START · `/wrap` = session END · `/peers` = who works on what · **`/summary` = THIS session's net state + the owner-decision queue, mid-session.**

## Iron rule: DERIVE, never RESTATE

**Every number, path, sha and state word comes from a command run THIS invocation** — never the conversation, a prior turn, a compaction summary or the context header. **Every count declares FLEET or THIS SEAT** (population rule): every instrument here answers a FLEET question by default — give both, or say it cannot separate them; ⛔ a predicate that SOUNDS seat-scoped is the dangerous case — scope on the SEAT ID (`${CLAUDE_CODE_SESSION_ID%%-*}`), never a first-person word; prefer a WRITER-stamped field (`filed: by <sid>`). **Never read the `gitStatus` block in the context header** (capped-instrument rule): its *"(truncated …)"* silence is the cap — run `git status --porcelain`; for any capped source, measure where the cap falls relative to the targets before trusting a negative.

## RETIRED — the Receipts row (heading kept only to be findable)

Retired because the receipts went unread: no `Receipts:` row; an unverified number says so IN its sentence.

## Process

Run these, then compose **only** from their output.

### 1. Git — pushed vs committed-unpushed vs dirty

`git fetch origin` (⛔ FIRST, NOT OPTIONAL — `origin/main` is a LOCAL ref) · `git log --oneline origin/dev..HEAD` (unpushed) · `git log --oneline origin/main..HEAD` (unpromoted — the WHOLE fleet) · `git status --porcelain` · `git log -1 --format='%h %s (%cr)'`.

- Each queue is **a count + the subset that is THIS session's**, from the **jsonl creation-records** — never tool-call history, never `git log --author`. ⛔ **READ `references/summary-detail.md` § 1 (the resolve recipe) and run it:** ONE `git cat-file --batch-check` pass, never `2>/dev/null`; gate on an EMPTY good-list; read every `missing` line; keep the UNQUOTED `$(…)`; **positive control first** (`git show --numstat --format='' --no-walk <a sha you know is yours>`).
- ⛔ **NO PER-SESSION COMMIT COUNT TO THE OWNER** — the FLEET unpushed count, this session's work in prose. ⛔ **NEVER FILTER A COUNT ON THE `Claude-Session:` TRAILER.** The creation-record is sound ONE way — **ABSENT ⇒ NOTHING**: **"≥N mine", a FLOOR.** A private-index commit prints NO confirmation line (`git reflog --format='%h %gs'` separates the routes); **`tail`/`head`, a redirect or `-q` on a commit** deletes the record too.

### 2. The owner-decision queue — the section the owner came for

One line per item blocked on the owner, named by what it changes (§ Output shape): **what** · **why it needs them** (which of the six owner-only reasons, the owner-column row in `.claude/orchestrator/conventions.md`) · **if they say nothing**. Sort by *cost of waiting*; "surfaced N times" is derived or omitted; an empty queue is a good answer. ⛔ **THIS-SEAT ITEMS ONLY** — an item another session filed or carries goes to the **`Next — fleet:`** line (split by ORIGIN, not importance), one clause tagged with its ORIGIN session's NAME (sid8 only when unnamed); never dropped.

⛔ **AN ITEM THE OWNER EXPLICITLY DEFERRED IS NOT A QUEUE ITEM — DROP IT FROM §2 AND FROM FREE-FORM CLOSERS FOR THE REST OF THIS SESSION, AND WRITE THE DEFERRAL ON ITS DURABLE ROW NOW:** `⏸ owner-deferred YYYY-MM-DD — "<verbatim>" → resurface next session` on the `todo.txt` row or `IDEAS.md` entry — an unwritten deferral is raised by NOTHING. ⛔ **Suppression covers only what the deferral NAMED — uncertainty REPORTS**; never drop it from disk.

⛔ **DERIVE EVERY ITEM, PER ITEM, THIS INVOCATION** — four checks (`references/summary-detail.md` § 2): ANCHOR (`grep -nF` the row across `todo.txt` / `DECISIONS.md` + `DECISIONS-ARCHIVE-*.md` / `plans/` / `BACKLOG.md` / `IDEAS.md` — ⛔ IN the list; no home ⇒ that is the finding) · STATE (the checkbox NOW over the whole ROW) · PEER CLOSURE (`git log -G '^- \[x\] <ROW-NAME>' -- todo.txt`; **-G, NEVER -S** — blind to a close) · QUANTITY (recompute). Failing one ⇒ **closed**, say so. **Step 2 decides; step 3 is the one you will skip.**

### 3. In-flight work

`python3 scripts/session-manifest.py mail-check --peek 2>&1 | head -20` — **`--peek` is load-bearing; bare `mail-check` CONSUMES** (`.md` → `.md.read`). Plus background agents/monitors (this turn's task state) and delegated reviews → **§3b, not optional**.

### 3b. QUEUE POSITION — every review this seat SENT, and whether the hub needs a nudge

Procedure: `references/summary-detail.md` § 3b. **Three reads, in order:** (1) the fence's `Derived state — reviews this seat sent` list (a FLOOR — it opens the question, never closes it); (2) per PENDING row, the hub's last word (an ACK naming a POSITION answers; one naming only the sha does not); (3) ⛔ **OPEN YOUR OWN OUTBOUND AND READ THE REQUEST SENTENCE** — a sha MENTIONED is not a sha REQUESTED. **Resolves toward NOT nudging:** no request sentence ⇒ no position, fix your row, tell the hub to drop it · a POSITION named ⇒ no nudge · requested, no ack ⇒ nudge once. ⛔ **Reverse direction too: `node scripts/review-request-closure-scan.mjs` and `python3 scripts/hub-open-promises.py`** — **READ ITS ROWS, NEVER ITS COUNT** (mail-only: a promise discharged elsewhere reads OPEN). Report it even when empty, once all four reads ran. ⚠️ Re-measure a relieving correction at the ref it was about, never HEAD.

### 4. Filed-with-triggers delta

Rows parked THIS session *with a concrete trigger*, from the row's own provenance field, never a tracker's `git log` (fleet-wide). ⛔ **SCAN THE ROW BLOCK, NOT THE FIRST LINE** (line-scoped under-reported **16×**). Narration: `references/tracker-row-predicates.md` § 4.

```bash
SID=${CLAUDE_CODE_SESSION_ID%%-*}
python3 - "$SID" <<'PY'
import sys, re
sid = sys.argv[1]
rows, cur = [], None
for line in open('todo.txt', encoding='utf-8', errors='replace'):
    if re.match(r'^- \[[^\]]*\] ', line):   # NOT [ x]: six checkbox forms exist
        if cur: rows.append(cur)
        cur = [line]
    elif cur is not None:
        cur.append(line)
if cur: rows.append(cur)
row_name = re.compile(r'^- \[[^\]]*\] (.*)$')
row_id = re.compile(r'^[A-Z0-9][A-Z0-9-]{3,}(?=\s|$)')
def row_label(first_line):
    m = row_name.match(first_line.rstrip("\n"))
    if not m: return '(unparseable row)'
    rest = m.group(1).strip()
    t = row_id.match(rest)
    return t.group(0) if t else (rest[:60] + ('...' if len(rest) > 60 else ''))
def FILED_BY(sid):   # `\s` crosses newlines: safe ONLY per ROW BLOCK
    return r'filed:\s*[0-9-]*\s*by ' + re.escape(sid) + r'\b'
for r in rows:   # OPEN rows whose BLOCK names this seat as filer
    if r[0].startswith('- [ ] ') and re.search(FILED_BY(sid), "".join(r)):
        print(row_label(r[0]))
PY
```

**Positive control:** a row you filed THIS session must appear. A defer with no trigger is an open loop — §2 or §5, never here.

### 5. Next actions, split by owner

Two short lists, the closing split: **yours** (decisions, approvals, external facts only you hold) and **mine** (work I can do without you). ⛔ **READ `references/tracker-row-predicates.md` § 5 before composing them or editing the block below.** Its gates: **one token for "waiting on the owner"**, `owner-pending: <why>` (older spellings via `OWNER_PENDING_ALIASES`; `⏸ owner-deferred` stays) · **a step on "yours" the owner performs outside this terminal carries its CLICK PATH** (where, which control, what done looks like) · **work not yet on GitHub's `dev` ⇒ "mine" carries "push at the end of my /wrap, if needed", "yours" the look once landed; never promise a mid-session push** · **an empty "mine" is a CLAIM — derive it.** `scripts/summary-owner-predicate-check.py` EXTRACTS `owner_line`, `owner_pipe`, `row_name`, `row_id` and both `row_label` / `FILED_BY` copies from this file and executes them — keep the two copies byte-identical.

```bash
SID=${CLAUDE_CODE_SESSION_ID%%-*}
python3 - "$SID" <<'PY'
import sys, re
sid = sys.argv[1]
rows, cur = [], None
for line in open('todo.txt', encoding='utf-8', errors='replace'):
    if re.match(r'^- \[[^\]]*\] ', line):   # NOT [ x]: six checkbox forms exist
        if cur: rows.append(cur)
        cur = [line]
    elif cur is not None:
        cur.append(line)
if cur: rows.append(cur)
def FILED_BY(sid):   # `\s` crosses newlines: safe ONLY per ROW BLOCK
    return r'filed:\s*[0-9-]*\s*by ' + re.escape(sid) + r'\b'
pat = re.compile(FILED_BY(sid) + r'|\bowner: *' + re.escape(sid) + r'\b')
owner_line = re.compile(r'^[^\S\n]*owner: *(\S+)', re.M)   # AUTHORITATIVE; keep `[^\S\n]`
owner_pipe = re.compile(r'\|[^\S\n]*owner: *(\S+)')        # FALLBACK
for r in rows:
    if not (r[0].startswith('- [ ] ') and pat.search("".join(r))):
        continue
    body = "".join(r)
    m = owner_line.search(body) or owner_pipe.search(body)
    if m and m.group(1) not in (sid, 'me'):
        continue   # a peer owns it, or owner-BLOCKED
    if any(k in body for k in ("NOT DOABLE-NOW WORK", "STANDING RULE")):
        continue   # a discipline, not queued work
    # a done-when naming an external actor/gate ⇒ §3, not "Next — me"
    row_name = re.compile(r'^- \[[^\]]*\] (.*)$')
    row_id = re.compile(r'^[A-Z0-9][A-Z0-9-]{3,}(?=\s|$)')
    def row_label(first_line):
        m = row_name.match(first_line.rstrip("\n"))
        if not m: return '(unparseable row)'
        rest = m.group(1).strip()
        t = row_id.match(rest)
        return t.group(0) if t else (rest[:60] + ('...' if len(rest) > 60 else ''))
    print(row_label(r[0]))
PY
```

⚠️ A FLOOR, never a total; read what the instrument returned, not just its count. ⛔ ONE of TWO populations: the plan's own rows (§ The plan table) are the other; the you/me split is their UNION.

### 6. Working-plan currency — DERIVED, and SYNCED

Is this session's plan (`plans/session-<sid8>-*.md`, the LAST in `LC_ALL=C sort` order) BEHIND the state just derived? One line: last written `%h %cr`, and commits since. **SYNC IT — the FIRST of two acts:** `node scripts/summary-plan-sync.mjs` → `CURRENT | UPDATED | NO-PLAN` (`--check` reports only). **It updates the plan UNLESS one of exactly three things holds:** (1) no plan file; (2) nothing changed — the derived block is byte-identical; (3) the SCRIPT's write would land outside its fence — structurally impossible (`spliceFence`). ⛔ **Do not "fix" `spliceFence` to reach outside the fence.**

### AND THEN UPDATE THE PROSE — the second act

Ask `/working-plan`'s question — *has anything SHIPPED, closed, or been ruled since the newest state block?* — and write the delta in: a stale closability verdict is SUPERSEDED by a dated block, never edited · an owner ruling or deferral goes on the item's row, verbatim, dated · a closed item gets a dated status flip, never deleted · a section PROVED wrong is corrected, saying what it used to say · ⚠️ nothing this run did not derive goes in.

⛔ **EVERY SESSION-WIDE STATEMENT** (closability, open-items count, the owner/mine split, "nothing owed") **DERIVES OVER THE WHOLE PLAN** — every live row incl. ⏸/✅, every ledger row, every dated block, this seat's open tracker rows — **BY ENUMERATION, NEVER A WHOLE-FILE `Read`**: `grep -nE '^#+ ' <plan>` (never `###` alone), then each block by anchor. A WINDOW claim names the blocks it read.

⛔ **ANCHOR THE PROSE WRITE ON THE FENCE'S `SUMMARY-SYNC:BEGIN` MARKER — NEVER A HEADING, NEVER `### Derived state`** (inside the fence, so the next sync deletes it): `a = "\n<!-- SUMMARY-SYNC:BEGIN"; assert t.count(a) == 1; i = t.index(a)`. ⭐ **THEN DIFF THE HEADING SET AGAINST HEAD** (`diff <(git show HEAD:<plan> | grep '^#\+ ') <(grep '^#\+ ' <plan>)` — `>` added, **`<` DESTROYED**) — ⛔ **FIRST `git ls-files --error-unmatch <plan>`: untracked ⇒ the diff is vacuous in the PASS direction, SAY it could not run.** ⛔ **THE FENCE HOLDS ONLY THIS SEAT'S OPEN/CLOSED TRACKER ROWS — NEVER FLEET NUMBERS** or timestamps.

### 7. Shipped-but-UNREVIEWED — what this seat committed that no reviewer has seen

⛔ **RUN `python3 scripts/summary-unreviewed.py`; read line 1.** `STATE: CRASH` (rc 2) is an instrument failure, never "everything reviewed": skip §7. `STATE: NOTHING-COMMITTED` is a session that committed nothing. Else one `sent:0|1 <sha> <subject> | touches:` row per commit, taken from the jsonl's git and commit-tool confirmation lines — ⛔ NEVER the `Claude-Session:` trailer, never the mail store; `sent:1` only where a review REQUEST (subject marker or an ALLOWLISTED frontmatter `signal:` — it STAYS an allowlist) names the sha; reachability `dev` then `main`, NEVER `HEAD`. Edit its lists only with `references/unreviewed-commits.md` open.

**Report the UNSENT set, then triage it — never a raw count** — on what the diff TOUCHES: a WIRED hook, guard, gate or `settings.json` · an ALWAYS-LOADED file · `src/`, a migration, a test ⇒ **OWED — name it; `/wrap` or your next ordinary turn sends it** · tracker rows, plan prose ⇒ skip, saying so. ⛔ **CLASSIFY AND SURFACE, NEVER SEND — `/summary` DOES NOT MAIL; name what is owed and TO WHOM.** Cross-check a low count against the trailer UNION of your commits' spellings.

⚠️ A FLOOR of commits you RAN; an unnamed sha reads unsent — SAFE over-report, growing with age. ⭐ **Before treating an aged `sent:0` as a finding: `git log --all --grep='<sha>' --format='%h %s'`, never capped**; a clean APPROVAL leaves no fold commit, so at fold-verify write the verdict sha into a `todo.txt` row. ⛔ **Dismissing a row needs a NAMED ARTIFACT.** An empty unsent set is good — **say which BASE you measured from.** ⛔ **RUN THE NON-GIT LEG EVERY TIME: `python3 scripts/non-git-writes.py`** (the script is not in this copy: until you write it, say that this leg did not run, and do not write "nothing unreviewed") — each EXACT path, and each POSSIBLE row that is a write, is REVIEWED (a frozen dated copy + sha256 mailed to the hub, verdict named; a changed sha256 is unreviewed again) or carries a stated reason; rc 2 = instrument failure, never an empty set (an empty set prints `NONE` — quote it). **Closability counts this leg.**

## The plan table — PART OF THE DEFAULT READOUT

Every run appends the plan table; `--plan` / `plan` are ACCEPTED AND IGNORED; nothing parses arguments: `--light` / `light` / `-l` ⇒ the DEFAULT (digest table) · `--full` / `full` / `-f` ⇒ the WHOLE table · anything else, or both ⇒ the DEFAULT, never an error (a design pick).

**Plan (table)** — Item · Status · one-liner per the plan-display rule, composed IN the reply, never a file pointer. ⛔ **`/working-plan --light`'s SHAPE: the LAST 10 live-items rows in FILE order, and SAY THE DENOMINATOR** (`10 of 45 live rows, last 10 in file order`), N counted by enumeration (`grep -nE '^#+ '` → the `## Live items` block → `grep -c '^|'` − 2). ⛔ **Only the SELECTION and DENOMINATOR transfer — the closability verdict is REQUIRED.** A last-10 landing on a fleet row ⇒ skip it, take the next this-seat row, say so. Row CONTENT comes from the NEWEST state blocks plus the sync fence, cross-checked against this run's §1-§5 — the fresher reading wins, the plan is then BEHIND (§6); session-wide statements derive over the WHOLE plan. ⛔ **THIS SESSION'S ITEMS ONLY** — fleet items go on `Next — fleet:`, origin-tagged. **Cell register:** § Output shape's register paragraph (the route for `/post-compact` 7b).

## Output shape

Compact; one screen. ⛔ **COUNT COMPACTIONS BY THE FIELD `isCompactSummary` IN THIS SESSION'S jsonl, NEVER BY THE MARKER PHRASE** (which matches this spec once loaded; block: `references/plan-table-and-output-shape.md` § Output shape).

```
## Session <sid8> "<name>" — <n> days, <n> compactions

**Bottom line:** <one-to-two PLAIN sentences anyone can act on; no coined name, number, sha, path or rule id; never invent a stake>
**Landed:** <one sentence, net>
**Closability:** <ready to `/wrap`: yes / no, then what the wrap will still carry; never "safe to close"; over the WHOLE plan>
**Git:** <n> unpromoted (FLEET) · <n> unpushed to origin/dev · <n> dirty · HEAD <sha> <subj>
**Needs you:**
- <item — THIS seat's arc only> — <why yours> · <cost of silence>
**In flight:** <agents/monitors/reviews, or "nothing">
**Filed with triggers:** <n> — <one-line each, or "none">
**Unreviewed:** <n risk-bearing commits no reviewer has seen, named with what they touch, or "everything risk-bearing has been sent"; state the BASE>
**Plan file:** <IN SYNC, or N commits behind — the FILE, never the work; ⛔ "current" is banned here>
**Next — you:** <… with click paths (§5)>   **Next — me:** <…>
**Next — fleet:** <OTHER sessions' items, tagged with the origin session's NAME; omit when empty>

## Plan
<the plan TABLE per § The plan table>
```

Omit an empty section; never pad.

**Write the readout in the owner's register.** Digits. A **Needs you** item is named by what it changes for a user or for the owner, never by a label coined this session unless the sentence says what the label is. A Status cell is plain words (done · in progress · waiting on review · waiting on you · filed for later), never a glyph alone, a sha, a time or a verdict code; the one-liner has a subject and a verb; the item says what it is. A row waiting on the owner's decision is also under **Needs you**, one waiting on a step the owner takes under **Next — you**; a row §2 dropped says so in its Status cell.

## Anti-scope

- **One ARTIFACT, never a persistence pass** (corrected twice, 2026-08-25 and 2026-09-03): `/wrap` decides what enters memory, trackers, the decisions log and git; `/summary` derives, reports, keeps ONE file honest.
- **No narrative. No project-tracker sweep** (`/status`). **No self-assessment. No fleet gossip** (a fleet thread only where this session owes or awaits something). **Never a substitute for `/wrap`.**

## Revisit

Triggers: `references/plan-table-and-output-shape.md` § Anti-scope, Revisit, Provenance.

## Provenance

Full record: `references/plan-table-and-output-shape.md` § Provenance.
