# /wrap — Step 7 and its sub-steps 7a to 7h — the full pre-slim text, moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (2026-10-25)

**Not loaded on a wrap.** `../SKILL.md` is the core an invocation and every compaction carry pays for; this file holds that step's full prior text — the rulings, measurements, incident records, history and instrument commands the core condenses. **Where this file and the core disagree, the core wins.** Each `## ` section below is one step (or section) of the core, cut at the ref's line numbers, and the sections tile the pre-slim body with no gap. A `references/<file>.md` pointer inside the moved text resolves against the skill directory (`.claude/skills/wrap/`), as it did in the core. Append new history to the core's owning step reference, never to the core.

## Step 7 — session summary — from `SKILL.md` § Process, lines 259–259

7. Show session summary (commits made, tests added, experts consulted, any pending Check 10 failures from feature audits)

## Step 7a — /me learn-session — from `SKILL.md` § Process, lines 260–260

7a. **Run `/me learn-session` (auto-invoked — added 2026-04-20, user-preference session extraction).** Mirrors the `/meta learn` + `/session-memory` pattern but scoped to USER working-style preferences. Scans session conversation for behavioral signals (user pushback, directional preferences, tool-friction flags, systems-thinking observations), de-duplicates against existing `user_profile.md` + `feedback_*.md`, classifies surviving candidates as profile-level or feedback-level, and writes. Auto-execute if total scope ≤30 LOC; larger = propose + confirm. Skip silently if zero preferences surface. Full spec: `.claude/skills/me/SKILL.md` → "Process — `/me learn-session`". **Why here, not Step 3:** user preferences belong alongside other session-end curation passes; running after session summary ensures the summary reflects the final preference state. Writes land in Step 8's commit. **Skip rule:** on trivial sessions (<5 messages, no decisions) /me learn-session is skipped same as /meta learn.

## Step 7b — tracker pointer-line refresh — from `SKILL.md` § Process, lines 261–284

7b. **Tracker pointer-line refresh (mandatory when this session committed to any of: `project_critical_flows.md`, `project_feature_audits.md`, `project_ops_register.md`).** The one-line summaries in `~/.claude/projects/<project-key>/memory/MEMORY-INDEX.md` (the cold index, the file 7b's own procedure below reads) for each tracker are written ONCE per `/wrap` and silently rot when subsequent sessions transition row Status without re-stamping. An earlier lesson enforces "count from tracker, not pointer" at READ time; this step closes the WRITE gap so the next session's `/orient` reads accurate counts.

   **Detection (≤5 sec):** if `git log --name-only <session-start-sha>..HEAD` doesn't list any of the 3 tracker files, skip silently — pointer counts haven't drifted from this session.

   **Procedure (per touched tracker):**
   ```bash
   # 1. Re-count Status column directly from tracker.
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7b — why the field-4 awk was refuted — provenance only
   node scripts/tracker-list.mjs flows --counts
   # ⚠️ Same command with `features` / `ops` for the sibling trackers — 7b is mandatory for all three.
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7b — why the awk was replaced, not repaired — provenance only
   # 2. Read the matching pointer line in MEMORY-INDEX.md (search "Critical flows tracker" / "Feature audits tracker" / "Ops register")
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7b — MEMORY.md vs MEMORY-INDEX.md — provenance only
   # 3. Compare CLAIMED counts (in pointer) vs ACTUAL counts (from step 1's command). If mismatch:
   #    Edit ONLY the "N flows: X COMPLETE / Y PENDING / Z RESEARCH_GAP / W ungated" substring.
   #    DO NOT touch the trailing narrative ("; latest #N (date); #M still PENDING ...") — that's session-curated, not derivable from count.
   ```

   **Auto-fix rule:** ≤1-line targeted Edit per pointer (count substring only) auto-executes. If the pointer line's narrative tail references a flow/feature that no longer matches tracker reality (e.g., "latest #52" when tracker now has #65), surface as proposal — don't guess the right narrative.

   **Skip rule:** if all 3 trackers were untouched this session, skip silently. Also skip when the parallel-session check (Step 8's pre-stage `git diff --staged --name-only`) shows MEMORY-INDEX.md is currently staged by a concurrent session — refresh on the NEXT `/wrap` to avoid double-staging.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7b — evidence basis** — provenance only.

## Step 7c — tracking-file sync sweep (7c.1, 7c.1b, 7c.1c, 7c.2, 7c.3) — from `SKILL.md` § Process, lines 285–449

7c. **Tracking-file sync sweep (forward-direction tracker-file sync at /wrap close, mandatory when this session has ≥1 commit AND `BACKLOG.md` / `todo.txt` not currently staged by a parallel session).** Closes the forward-direction gap: session shipped work matching a BACKLOG entry or open todo task → trackers must reflect shipped state. Companion to Step 7b (tracker-pointer count refresh) and inverse-companion to `/hanging-work` Check 12 (defer-trigger-fired — covers blocker-fired direction; this step covers task-done + archive-shipped + idea-capture directions).

   **Detection (≤10 sec):** if `git log --oneline <session-start-sha>..HEAD | wc -l` is 0, skip silently — nothing shipped to reconcile.

   **Procedure — the sub-checks below, in order** *(they were "3" in prose until 2026-09-05 while four were listed, and 7c.1c makes five; derive the set by reading the `**7c.` headings rather than trusting a count here — the cite-a-spec-never-a-number rule)*:

   **7c.1 — BACKLOG.md archive sweep.** For each P0/P1/P2 entry:
   ```bash
   # P-tier entries in BOTH forms (`### N.` + `- **#N`). NOT a range-awk: `/^## P[0-2]/,/^## P[0-9]/` ends on its own start line, read 0 of 163 (2026-09-14)
   awk '/^## /{p=/^## P[0-2]/} p' BACKLOG.md | grep -nE '^(### [0-9]|- \*\*#[0-9])'
   # Grep session commits for feature-IDs + completion markers.
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7c.1 — why the single-regex form and the fixed /tmp path are gone — provenance only
   SESS=/tmp/wrap-sess-${CLAUDE_CODE_SESSION_ID}.txt
   git log <session-start-sha>..HEAD --oneline > "$SESS"
   for m in COMPLETE PASS shipped /audit-check; do grep -inF "$m" "$SESS"; done | sort -u
   ```
   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1 — set-equivalence caveat** — READ IT before executing this step.
   If an entry's distinctive ID (F#, Flow #, or unique keyword) appears in a commit subject AND a completion marker is present → propose archive move. **Auto-archive** if ≤3-line move per entry (delete from P-tier, append to `## Archive → Shipped` with commit hash + 1-line summary). **Propose for batch approval** if ≥2 candidates OR if entry has shared keywords (e.g., "F11" could match multiple entries — surface for disambiguation).

   **7c.1b — Composite/rollup-entry candidate reconcile (mandatory whenever 7c runs).** 7c.1's whole-entry archive sweep is **entry-granular + archive-only** — structurally blind to a *composite/rollup* entry (one whose BODY enumerates `F#` / `Flow #` / `OPS #` candidates) that is NOT itself archivable (some candidates still open) but whose internal candidate list went **stale** because some candidates completed. 7c.1 checks "is the WHOLE entry done?" → no → does nothing → the stale sub-candidates are never touched. And because the completion often happened in a DIFFERENT (earlier) session, a session-commit-scoped scan can't see it at all.
   ```bash
   # 1. Find the rollup entries (body enumerates F#/Flow#/OPS# candidates with status markers)
   grep -nE "^### [0-9.]+\. " BACKLOG.md
   # 2. For EACH rollup entry, MECHANICALLY enumerate every candidate id of ALL types — never eyeball the body (the lesson's second occurrence).
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7c.1b — why not a range-awk, and the range-heading blind — provenance only
   START=$(python3 - "$N" <<'PY'   # python, not awk: dollar-digit fields are replaced when this skill gets arguments
   import re, sys
   n = int(sys.argv[1])
   for i, l in enumerate(open("BACKLOG.md", encoding="utf-8"), 1):
       m = re.match(r"### (\d+)(?:–(\d+))?", l)
       if m and int(m.group(1)) <= n <= int(m.group(2) or m.group(1)): print(i); break
   PY
   )
   END=$(awk -v s="$START" 'NR>s && /^##+ / {print NR-1; exit}' BACKLOG.md); [ -z "$END" ] && END=$(wc -l < BACKLOG.md)
   # ⛔ KEY ON CANDIDATE **LIST LINES**, NEVER ON EVERY ID IN THE BODY.
   sed -n "$((START+1)),${END}p" BACKLOG.md \
     | grep -E '^[[:space:]]*([-*+]|[0-9]+\.)[[:space:]]' \
     | grep -oE "F[0-9]+|Flow #[0-9]+|OPS #[0-9]+" | sort -u
   # POSITIVE CONTROL, required before trusting a zero: the same pipeline WITHOUT the list-line filter
   # must return MORE. Equal counts mean the filter did not engage (an entry whose candidates are not
   # list-formatted) — read that entry by hand rather than reporting it clean.
   # 3. Loop EVERY enumerated id against its OWNING tracker's CURRENT Status (ground truth, NOT this session's commits):
   #   F#   → project_feature_audits.md      Flow # → project_critical_flows.md      OPS # → project_ops_register.md
   # CRITICAL (the same lesson's second occurrence, 2026-06-17): sweep ALL candidate TYPES, not just the tier this session worked on. The grep
   # removes the orchestrator-discipline dependency the tier-anchored skip (two flows done, a feature missed) exploited.
   ```
   > 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7c.1b — why candidate LIST lines, not every id — **READ IT before executing this step** (a reference-file pointer, not the scan-output legend above)
   **The reconcile is against tracker ground truth, NOT session commits** — that is what catches the cross-session case (a candidate completed 2 days ago in another session). For each candidate: tracker row reads ✅ COMPLETE but the BACKLOG candidate line still reads pending/residual → **propose an in-place strike-✅ update** of that candidate line (mark `~~F#~~ ✅ … COMPLETE <date> (<commit>)`), NOT a whole-entry archive (the entry stays — other candidates remain). Bounded + cheap: only the handful of rollup entries, ~10-15 sec. ⛔ **DERIVE that set from step 1's grep — do not cite a list from here.** This clause named three specific entries until 2026-09-13 and **none of those three resolves any more**, so a seat checking whether the step applied to the right entries was reading a set that had not existed for weeks. **Auto-fix** ≤3-line in-place edits per candidate; **batch-propose** if ≥3 candidates flip at once OR the candidate ID is ambiguous (matches multiple tracker rows). Also re-derive the entry's "remaining" summary line + tier-count header if the strike changes them.

   **7c.1c — Session-touch reconcile: EVERY BACKLOG ITEM THIS SESSION TOUCHED GETS A DATED LINE. MANDATORY whenever 7c runs.**

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1c — the gap this closes** — provenance only.

   **Instrument — named here because a condition without one gets an unsound improvisation (a lesson minted on this same spec's Step 5b).** Two signals, unioned:

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1c — SIGNAL 1 reads the diff: the retired message-anchored form** — READ IT before executing this step.
   ```bash
   # (1) GROUND TRUTH — which ENTRY each changed line of BACKLOG.md falls under, per commit.
   #     Resolves a hunk's new-file line numbers against the entry headings in that commit's
   #     own blob, so it cannot be fooled by prose, by a supersedes clause, or by a plan-file
   #     commit that merely NAMES an item. A batch heading is a RANGE and is skipped here —
   #     its members are resolved by the four-form resolver below.
   python3 - <<'PY'
   import subprocess, re, bisect, sys
   HEAD_RE = re.compile(r'^(?:### (\d+)\.|### (\d+)–(\d+)\.|- \*\*#(\d+) |- \*\*P\d+ #(\d+) )')
   # WHOSE each commit is: the ONE classifier (scripts/session-labels.py), never a local copy.
   # '<date> 00:00', never a bare date: git reads a bare date as that date at the CURRENT clock
   # time, and on the session's own start day that returns zero commits at rc=0.
   part = subprocess.run(['python3','scripts/session-labels.py','partition','--since','<session-start-date> 00:00',
                          '--path','BACKLOG.md'], capture_output=True, text=True)
   sys.stderr.write(part.stderr)          # the per-leg count line: "0 of 0" is a window to widen, not an all-clear
   if part.returncode != 0: raise SystemExit('PARTITION FAILED — instrument failure, NOT an empty partition: ' + part.stderr[:300])
   mine, unattributed = {}, {}
   for row in part.stdout.split('\n'):
       if not row.strip(): continue
       label, h = row.split(' ')[:2]
       bucket = mine if label == 'MINE' else (unattributed if label in ('URL-OTHER', 'NO-TRAILER') else None)
       if bucket is None: continue          # a DIFFERENT seat — theirs, skip
       blob = subprocess.run(['git','show',f'{h}:BACKLOG.md'],capture_output=True,text=True).stdout.split('\n')
       anchors, ids = [], []
       for i, line in enumerate(blob, 1):
           m = HEAD_RE.match(line)
           if m: anchors.append(i); ids.append([x for x in m.groups() if x])
       d = subprocess.run(['git','show',h,'--unified=0','--format=','--','BACKLOG.md'],
                          capture_output=True,text=True).stdout
       for hm in re.finditer(r'^@@ -\S+ \+(\d+)(?:,(\d+))? @@', d, re.M):
           s = int(hm.group(1)); c = int(hm.group(2) or 1)
           for ln in range(s, s+max(c,1)):
               j = bisect.bisect_right(anchors, ln) - 1
               if j >= 0 and len(ids[j]) == 1: bucket.setdefault(ids[j][0], set()).add(h[:9])
   print("MINE        :", sorted(mine, key=int))
   print("UNATTRIBUTED:", sorted(unattributed, key=int), "<- another seat's URL, or no trailer; NOT another seat's sid")
   PY
   # (2) /backlog invocations THIS session — the args carry the item id
   python3 - <<'PY'
   import json,os
   sid=os.environ['CLAUDE_CODE_SESSION_ID'].split('-')[0]
   for l in open('.claude/logs/skill-invocations.jsonl'):
       try: r=json.loads(l)
       except: continue
       if r.get('skill')=='backlog' and str(r.get('session','')).startswith(sid): print(r.get('args'))
   PY
   ```
   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1c — the retired form's own defence** — READ IT before executing this step.

   ⛔ **SIGNAL 1 SPANS THE FLEET, NOT YOUR SEAT — `<session-start-sha>..HEAD` on a multi-day session is every seat's commits, and 7c.1's "peer over-count is safe (it only raises the fire-rate)" DOES NOT TRANSFER HERE.** Over-counting an archive sweep costs a redundant check; over-counting THIS step writes a peer's work into `BACKLOG.md` under your session id, which is the attribution failure the commit doctrine exists to prevent. **Partition with the block above, which calls `scripts/session-labels.py partition` (all three of this seat's labels: the 8-hex trailer, its own remote-URL trailers, a sid-closing subject scope)** — and treat it as the doctrine does: a PARTITION, never an identity, whose ABSENCE proves nothing and whose value has three shapes. An item you cannot attribute is still worth recording; attribute it to the WORK (the sha), not to your seat. ⛔ **AND THE TRAILER HAS A THIRD STATE THAT IS NEITHER YOURS NOR ANOTHER SEAT'S: A URL-FORM VALUE — MEASURED AT 25% OF THE LAST 400 COMMITS, AND 39% OF THE `BACKLOG.md`-EDITING ONES.** The hedge "whose ABSENCE proves nothing" does not reach it: a URL is a **present, non-matching value**, so an exact 8-hex compare reads it as positive evidence the commit is somebody else's and a URL-form seat gets a silent total false zero on every wrap, permanently. `safe-commit.sh` carries a test arm written for exactly this, in as many words. **Three buckets, never two — MINE (this seat's 8-hex or its OWN remote URLs) / ANOTHER 8-HEX SEAT / UNATTRIBUTED (another seat's URL, or absent), and the third is yours to consider, not to discard.** ⚠️ **Measured on this clause's own first run, and stated as the FLOOR it is: unpartitioned 24 items, trailer-matched 8. The retired sentence here read "16 items belonging to other seats" — bolded and flat, which is precisely the identity claim its own first clause forbids** (2026-09-05).

   ⚠️ **SIGNAL 2 FALSE-ZEROS BEFORE 2026-09-04.** `skill-invocations.jsonl` only started stamping a real `session` that day — 74 of the 78 historical `/backlog` records read `unknown`, so a run over older data returns empty and reads like a dead probe. Live going forward; do not "fix" it against the archive.

   ⛔ **SIGNAL 1 CANNOT TELL A COMMIT THAT *CHANGES* AN ITEM FROM ONE THAT MERELY *NAMES* IT — SO CONFIRM `BACKLOG.md` IS IN THE DIFF BEFORE WRITING AN ADVANCE.** The predicate reads the commit MESSAGE, and a session's plan-file, todo-row and mail commits routinely cite a backlog item in prose while touching nothing in `BACKLOG.md`. Measured on the maiden firing, 2026-09-05: of 4 items that reached the disposition step, **one item's only citation was a prose mention inside a plan-file commit** (`BACKLOG.md` NOT in its diff), against the other three (+11, +8, and 8 commits), which were all real entry edits. **One command separates them:** `git show --numstat --format='' <sha> | cut -f3 | grep -xF BACKLOG.md` — empty ⇒ the honest disposition is NO MATERIAL CHANGE, and the miss is the instrument's rather than the entry's. **Writing an ADVANCE off a mention is the exact fabrication the NO-MATERIAL-CHANGE outcome exists to prevent**, so this check is what makes that outcome reachable rather than decorative.

   ⚠️ **IT IS A FLOOR, NOT A CENSUS — say so rather than reporting it as complete.** In the same window **4 commits touched `BACKLOG.md` carrying no citation the predicate can see**, so the union under-reports by construction. What closes the residual is not a better regex: it is the orchestrator adding, from its own session knowledge, any item it worked on that the two signals missed. The instrument seeds the list; it does not bound it.

   ⛔ **RESOLVE THE ID AGAINST ALL FOUR ENTRY FORMS — A TWO-FORM RESOLVER SILENTLY DROPS ITEMS, AND THIS FILE HAS ALREADY DONE THAT TWICE.** Measured 2026-09-05: `### N.` **65** · `### N–M.` **5** (the batch headings every `/backlog sweep` promotion uses) · `- **#N ` **81** · `- **P0 #N ` **41**. A resolver knowing only the first and third — the pair a census naturally finds — misses 46 entries.
   ⛔ **AND THE BATCH FORM CANNOT BE RESOLVED BY A REGEX AT ALL — IT CARRIES A *RANGE*, SO MEMBERSHIP IS ARITHMETIC. THE FIRST VERSION OF THIS RESOLVER PUT `### [0-9]+–[0-9]+\.` INSIDE THE ALTERNATION WITH NO `$N` IN IT, WHICH MATCHES THE FIRST BATCH HEADING IN THE FILE FOR *EVERY* ITEM, INCLUDING ITEMS THAT DO NOT EXIST.** Measured on its own first live firing, 2026-09-05: two real items and the nonexistent `#999` and `#12345` ALL resolved to the same line, the file's first batch heading. **The tell was two different items resolving to one line**, and the negative control (`#999` → 0) that had passed at build time no longer reproduced against the shipped text — so the build-time control was sound and the thing that shipped was not. ⚠️ **7c.1b ONE STEP ABOVE ALREADY HAD THE RANGE-PARSE (`if (index(h,"–")) { split(h,p,"–") … }`) and this step re-invented a simpler broken one** — when a sibling sub-check resolves the same identifier, READ IT rather than re-deriving. Two commands, and the second is not optional:
   ```bash
   # (a) the three REGEX-resolvable forms
   grep -nE "^(### $N\.|- \*\*#$N |- \*\*P[0-9] #$N )" BACKLOG.md
   # (b) the BATCH form — range membership, so parse and compare (7c.1b's own logic)
   python3 - "$N" <<'PY'   # python, not awk: a skill invoked WITH arguments has awk's dollar-digit fields replaced
   import re, sys
   n = int(sys.argv[1])
   for i, l in enumerate(open("BACKLOG.md", encoding="utf-8"), 1):
       m = re.match(r"### (\d+)–(\d+)\.", l)
       if m and int(m.group(1)) <= n <= int(m.group(2)): print(f"{i}: {l.rstrip()}")
   PY
   ```
   **Run `#999` as a standing negative control every firing** — it must return NOTHING from both legs. A resolver that answers for a nonexistent item is answering for every item.

   ⚠️ **ALL 41 OF THE `- **P0 #N ` FORM SIT IN `## Archive`, SO RESOLVING THERE IS A DISPOSITION, NOT A MISS.** A cited item that lands in the Archive shipped already — record nothing unless this session actually RE-OPENED it, in which case the write is a re-open in the live tier, never an append to the archive line. Measured on this clause's own first run: of 8 touched items, one resolved only in the Archive and a two-form resolver reported it MISSING — which would have read as a broken predicate rather than a shipped item.

   ⚠️ **BATCH THE PER-ITEM ATTRIBUTION INTO ONE `git log --no-walk`, NEVER A LOOP PER ITEM.** You need each item's commits to write its disposition, and the obvious `for item; do for sha; do git log -1; done; done` is O(items × commits) — measured **timing out at 2 minutes on 8 items × 259 commits** while the single batched read returned the whole map instantly.

   **Disposition — per item, MANDATORY, and the write is a dated append in the entry's own house form** (`✅`/`⚠️`/`❓` + what changed + the date + the session id, exactly like the existing status bullets). One of:
   - **ADVANCED** — name what shipped and the sha.
   - **REFUTED / RESCOPED** — the entry's premise moved; correct the entry text IN PLACE and add the dated line saying what it used to claim.
   - **BLOCKED** — name the blocker and who owns it.
   - **NO MATERIAL CHANGE** — investigated, nothing moved. ⛔ **THIS IS A FIRST-CLASS OUTCOME AND MUST STAY ONE.** A mandatory write with no way to say "nothing changed" manufactures updates to satisfy itself, which is the failure mode that makes the next reader distrust every dated line in the file. Record it in one clause, or record nothing and say in the wrap output that the item was touched and needed no entry change — both are honest; a fabricated advance is not.

   **Already-updated check, so the step is idempotent on a re-wrap:** an item whose entry already carries a line naming THIS session is done — do not append a second one. ⛔ **THE COMMAND MUST BE RANGE-SCOPED, AND THE ONE THIS STEP SHIPPED WITH WAS WHOLE-FILE** — prose said "per entry range" and the command had none, so `grep -c <sid> BACKLOG.md` returns a file-wide count that is non-zero the moment you write your FIRST line, and every remaining item then reads "already done". On a maintain-wave wrap that silently drops 28 of 29 and reports them complete. **A named unsound instrument is worse than none: an unsound command gets pasted, an absent one gets thought about** (2026-09-05; whole-file count measured at 5 across five different entries while four items were still unwritten).
   ```bash
   SID8=$(echo "$CLAUDE_CODE_SESSION_ID" | cut -d- -f1)
   LN=$(grep -nE "^(### $N\.|- \*\*#$N |- \*\*P[0-9] #$N )" BACKLOG.md | head -1 | cut -d: -f1)
   END=$(awk -v s="$LN" 'NR>s && /^(### |## |- \*\*#|- \*\*P[0-9] #)/ {print NR-1; exit}' BACKLOG.md)
   [ -z "$END" ] && END=$(grep -c '' BACKLOG.md)
   sed -n "${LN},${END}p" BACKLOG.md | grep -c "$SID8"      # 0 => write; >0 => already done
   ```
   ⛔ **AND NO MATERIAL CHANGE MUST WRITE A MARKED LINE, NOT NOTHING — OTHERWISE THE IDEMPOTENCE GUARD CREATES THE FABRICATION GRADIENT THIS STEP EXISTS TO CLOSE.** "Record nothing" leaves no artifact, so the check above cannot see it, so the item is re-raised on every later wrap of the same session (checkpoint mode is same-steps-same-rigor) — **taking the honest outcome costs you the item forever while writing a false advance makes it stop.** That pressure comes from the guard, not from the wording, and only a recorded line removes it. Write the `❓ NO MATERIAL CHANGE — <date>, session <sid>` line and let it satisfy the check (2026-09-05 — the WORDING already carried the escape hatch; the guard was what undercut it).

   **Skip rule:** inherits 7c's — zero session commits, or `BACKLOG.md` staged by a parallel session. A skip is NAMED in the wrap output with which of the two it was; a silent skip is indistinguishable from the step not running.

   **7c.2 — `todo.txt` closed-entry sweep.** Inverse of blocker-fired direction; catches task-done direction:
   - For each open `- [ ]` entry, extract distinctive keywords (file path / function name / F# / OPS# / migration number)
   - Grep session commits + commit-touched files for matching keywords AND completion markers
   - **Auto-mark `- [x]`** (or move to closed section per `todo.txt` convention) if ≤2 entries match unambiguously
   - **Propose** otherwise

   **7c.3 — IDEAS.md capture.** If Step 2 `/meta learn` OR Step 3 `/session-memory` surfaced any "we should add X" / "future feature Y" / "captured for later" signal that did NOT get acted on this session (i.e., not promoted to P0/P1/P2, not added to an existing BACKLOG/IDEAS entry) → propose `/ideas add <title>` row(s) in root `IDEAS.md` with today's date (Ideas split out of BACKLOG.md 2026-07-10). **Auto-add** if ≤2 ideas; **propose** if more.

   **Auto-fix rule (cumulative across every 7c sub-check):** ≤5-line aggregate edit auto-executes inline. Larger changes surface as a single proposal table before write.

   **Skip rule:** zero session commits OR `BACKLOG.md` / `IDEAS.md` / `todo.txt` currently staged by parallel session (per Step 8 pre-stage check) → skip silently; reconcile on NEXT `/wrap`.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c — evidence basis and coordination notes** — READ IT before executing this step.

## Step 7d — architecture-doc audit — from `SKILL.md` § Process, lines 450–492

7d. **Architecture-doc audit (process lessons from this session's audit cadence-trigger enforcement, mandatory when this session added ≥1 new meta MEMORY lesson OR ≥1 new infrastructure file in `.claude/{skills,agents,hooks,rules,commands,templates}/` AND `.claude/docs/architecture.md` is not currently staged by a parallel session).** Closes the gap where `/meta architecture-audit` had documented cadence triggers but zero automation layer — relied on the orchestrator remembering. Architecture.md is the same shape of artifact as `MEMORY.md` pointer-lines (stamped at one time, silently rots until refreshed); same-shape /wrap enforcement as Step 7b/7c.

   **Detection (≤5 sec) — fire on ANY of two mechanical signals that directly observe what the doc enumerates:**
   ```bash
   # Signal 1: new L# headers in meta MEMORY (doc cites L# range in preamble + Appendix C rows).
   new_lessons=$(git diff <session-start-sha>..HEAD -- .claude/skills/meta/MEMORY.md \
     | grep -cE '^\+## [0-9-]+ — L[0-9]+:|^\+## L[0-9]+ \(')

   # Signal 2: new infrastructure files (doc enumerates counts of skills /  agents /  hooks /
   # rules / commands / templates / project-memory — all change when files added).
   new_files=$(git diff --name-status --diff-filter=A <session-start-sha>..HEAD -- \
     .claude/skills/ .claude/agents/ .claude/hooks/ .claude/rules/ .claude/commands/ .claude/templates/ \
     | wc -l)

   # Fire if either > 0
   [ "$new_lessons" -gt 0 ] || [ "$new_files" -gt 0 ] || skip
   ```

   **Cheap count-check runs UNCONDITIONALLY (a lesson's second occurrence, 2026-06-22).** The two signals above are PROXIES that gate only the heavier FULL `/meta architecture-audit` invocation (Tier 2/3 prose) — NOT the ~1-sec `node scripts/architecture-counts.mjs check`, which ALWAYS runs. The proxies under-fire on count-drift sources they don't grep: a new `.claude/project-memory/*.md` file (drifts `projectMemory`) or a `RULES.md`-row edit without a new L# header (drifts `metaRulesRows`) both leave the doc stale while both signals read 0. The check is content-keyed ground truth (the "key gates on CONTENT, not a proxy" fix — apply `architecture-counts fix` for ≤5-LOC drifts inline); the proxy signals then decide only whether the FULL audit also runs. Evidence: this 2026-06-22 wrap added a feedback memory + a RULES row → both proxy signals 0, yet `projectMemory`/`metaRulesRows` drifted; caught only by a hand run afterwards.

   **Cumulative conceptual-drift surface also runs UNCONDITIONALLY (added 2026-07-01 — the count-sync-masks-conceptual-staleness fix).** Alongside `check`, ALSO run `node scripts/architecture-counts.mjs conceptual-due` (read-only, ~1 sec) and surface its verdict in the /wrap output. This is the CUMULATIVE backstop the per-session proxies above miss: those proxies decide whether to fire the FULL audit from THIS session's ≥1 lesson/infra, but when the orchestrator does count-sync-ONLY (applies Tier 1, surfaces Tier 2/3 without integrating — the common path), whole subsystems accumulate un-integrated in the lecture *prose* while the count-sync keeps the *numbers* fresh and `last-reviewed` correctly stays put — so the git log reads as if real audits ran. `conceptual-due` measures accumulation SINCE `last-reviewed` (new infra files + new lessons — NOT commit-count, per the trigger-choice rationale below) and prints `⚠️ CONCEPTUAL PASS DUE` when new-infra ≥ 3 OR new-lessons ≥ 30: the signal to run a real Tier-2/3 `/meta architecture-audit` next session, not another count-sync. ⛔ **It can also print `⛔ INSTRUMENT DARK` (added 2026-09-14) — one half of the gate could not be measured, or the whole gate when git itself is failing. Surface that as a FINDING, never as a pass: a DARK lessons half is UNKNOWN.** The lessons half was dark this way for every run anchored after the 2026-08-06 memory split, printing an ordinary-looking PARTIAL, until 2026-09-14. **Surface-only — never blocks close** (like the Tier 2/3 rule below). Evidence: the 2026-07-01 audit found the entire `/push` + `/deploy` + `/review-hub` deploy/review subsystem (5 skills + 4 hooks + ~35 lessons) had accumulated un-integrated in Lectures 5/7/9 since 2026-06-23 while 7 architecture.md count-sync commits made the log read as active. **Invariant it depends on:** only a genuine Tier-2/3 pass bumps `last-reviewed`; a bare `architecture-counts.mjs fix`/count-sync must NOT (it doesn't touch the frontmatter) — else the anchor drifts and the signal goes blind.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7d — rationale for the trigger choice** — provenance only.

   Also skip if `git diff --staged --name-only` shows `.claude/docs/architecture.md` already staged by a parallel session per Step 8 pre-stage check — defer the audit to next /wrap.

   **Procedure:** invoke `/meta architecture-audit` (default mode — NEVER `--strict` at /wrap; that mode is reserved for explicit CI/auto-fix flows per the warn-mode-first discipline: warn before block). The audit auto-fixes ≤5-LOC Tier 1 mechanical drifts inline (count corrections, stale L# refs, last-reviewed/maxL date refresh). Tier 2 (Appendix C coverage gaps, cross-reference verification, pointer-block-to-`state.md` staleness) surfaces as proposals. Tier 3 (conceptual drift) surfaces as observations.

   ⛔ **GENERALIZED 2026-08-07 (measured twice in ONE wrap, from two different steps): the invariant is not about `/meta learn` — it is about ANY LATER STEP THAT MUTATES WHAT 7d COUNTS.** The clause below names `/meta learn` because that is where it was first measured, and a reader who runs 7d after Step 2 reasonably concludes they are done. Measured this wrap: (a) Step 2 `/meta learn` added four new lessons → re-drifted `maxL` 1115→1119; 7d re-run, clean. (b) **Step 7a `/me learn-session` then created one `feedback_*.md` file** → re-drifted `project-memory files` 231→232, and it was reported as `STEP 7d UNRUN/UNFIXED` at the close of a wrap where 7d had already run twice. **7d counts skills · agents · hooks · rules · commands · templates · project-memory · maxL · RULES-rows — so `/me learn-session` (new feedback file), `/meta corrections` (registry), any new rule/hook/skill, and Step 9's own follow-up commit ALL re-drift it.** Practical form: **run `architecture-counts.mjs check` as the LAST thing before the Step-11 gate, not as part of 7d** — it is ~1 s, and it is the only placement that sees every mutation the wrap made. The 7d slot stays where it is for the Tier-2/3 proposals; only the count-check moves late.

   **Ordering invariant — run 7d AFTER Step 2 `/meta learn`, and RE-RUN the count-fix if 7d was front-loaded (2026-06-08).** `/meta learn` (Step 2) can promote a NEW L# via watch-tier auto-promote — which re-drifts `maxL` (the lesson-number range refs) in architecture.md. If you batched 7d's count detection/fix EARLY in the wrap (a common efficiency move — running all mechanical scans up front), the fix ran BEFORE the new L# existed and left stale `maxL` narrative refs. So: after `/meta learn` adds any L#, **re-run `node scripts/architecture-counts.mjs fix`**, then confirm `node scripts/architecture-counts.mjs check` is clean BEFORE the Step 8 commit. A "clean tree" claim is invalid until re-checked post-`/meta learn` — this is the rule: don't assert clean from a check that ran before your own later edit. Evidence: 2026-06-08 wrap front-loaded 7d, `/meta learn` then added, and the Step 8 commit shipped with a stale `maxL 397` (5 narrative refs) — caught later, fixed in a follow-up commit.

   **Auto-fix rule (cumulative with Step 7b/7c):** Tier 1 mechanical edits land in Step 8's session-residual commit. Tier 2/3 surface as proposals in /wrap output — DO NOT block /wrap close. Owner addresses Tier 2/3 in a separate explicit invocation of `/meta architecture-audit`.

   **STAGE what 7d wrote (2026-07-18):** when `architecture-counts.mjs fix` applies any auto-fix, it prints each mutated path on its own line under `Mutated files — now DIRTY…` — `git add` EXACTLY those paths in the same turn (they then ride Step 8's residual commit). An unstaged sentinel write manufactures an orphan NO session ever opened: 2026-07-10, five sessions spent an hour hunting the "author" of a dirty comparison record that this script wrote as a Step 7d side effect — four disclaimed honestly and all four were right (the `wired-but-INVISIBLE` class, inverse of wired-but-inert; the ownership tree has no answer for a file no session Edit/Write'd). The stage is what closes the orphan; the per-path print is only the visibility half. One guard before the `git add`: `git add <path>` stages the WHOLE file — if `git diff <path>` shows anything BEYOND the count-sync `fix` just wrote (an unstaged peer co-edit), hunk-isolate per bare-commit sweeps the index instead of a bare add.

   **Skip rules:**
   - Zero new L# headers in meta MEMORY AND zero new infrastructure files this session → skip silently (no drift-eligible surface touched).
   - `.claude/docs/architecture.md` already staged by parallel session → skip silently (defer to next /wrap).
   - File `.claude/docs/architecture.md` does not exist → skip silently (doc may have been retired).

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7d — evidence basis and coordination** — READ IT before executing this step.

## Step 7e — memory-distill cadence surface — from `SKILL.md` § Process, lines 493–511

7e. **Memory-distill cadence surface (fires when any `.claude/skills/*/MEMORY.md` ≥46,000 BYTES at session-close).** Surfaces the `/meta distill <skill>` budget at session-close as an FYI. **⚠️ BYTES, not lines — the predicate was line-based (≥4000) until 2026-08-01 and was blind to 22 of 23 capped files** (these run 139-318 B/line, so a file busts a token cap thousands of lines under a line threshold). **The old "on-demand ⇒ no harness truncation cap" claim was FALSE** (measured 2026-08-01): a sub-agent's `Read` is capped like anyone's — the real cliffs are **~57.5 KB** (the one-Read band; past it a read truncates and 87.3% of dispatches never page the remainder) and **262,144 B** (hard error). 46,000 B warns with headroom below the first cliff. Distillation stays owner-judgment. Raised 3000→4000 lines 2026-06-09; converted to bytes 2026-08-01.

   **Detection (≤5 sec):**
   ```bash
   for f in .claude/skills/*/MEMORY.md; do
     bytes=$(wc -c < "$f" 2>/dev/null || echo 0)
     [ "$bytes" -ge 46000 ] && echo "$(basename $(dirname "$f")) ${bytes}B"
   done
   ```
   46,000 B = the warn budget. Informational FYI, not an alarm — but a file over ~57.5 KB IS past a real read cliff, so treat those as actionable rather than optional. Owner judges whether to distill. **✅ THE TWO SIBLING INSTRUMENTS ARE NOW BYTE-KEYED TOO (converted 2026-08-01)** — `.claude/hooks/check-memory-size.sh` (the 4000-LINE `URGENT` retired; now `SKILL_WARN_BYTES=46000` / `SKILL_CEILING_BYTES=57500` / `SKILL_HARD_BYTES=250000`) and `scripts/wrap-reconcile.mjs`'s 7e probe (`wc -c`, warn 46,000 / ceiling 57,500). Spec and enforcement now agree on one quantity and one number across all four surfaces (this step + those two + the two live gates). Proof the conversion was load-bearing: against the live cohort the retired line predicate surfaced **nothing**, while the byte predicate surfaces **6 files at 46-49 KB**. **Carve-out:** `meta/MEMORY.md` is excluded from the 7e probe — a cold body store with a separately-governed hot tier (`active-recall.md` / `RULES.md`) and its own governor lane (`/meta distill`); naming it every wrap would train the reader to skip the note. Same carve-out, same reason, in `check-memory-budget.sh` ARM 2.

   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 7e — procedure and auto-fix rule (fires when a MEMORY.md is ≥46,000 B)** — READ IT before executing this step.

   **Skip rules:**
   - Zero MEMORY files ≥46,000 B → skip silently (all within budget).
   - Owner already fired `/meta distill <same-skill>` this session AND the file is now <46,000 B → skip silently for THAT skill; still surface OTHER over-budget files.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7e — evidence basis and coordination** — READ IT before executing this step.

## Step 7f — meta-corrections registry sweep — from `SKILL.md` § Process, lines 512–533

7f. **Meta-corrections registry sweep (mandatory when current-session scan returns ≥1 candidate event).** Closes the gap where `scripts/meta-corrections-scan.py` had documented the registry workflow but zero session-end automation layer — relied on orchestrator remembering to invoke `--session <id>` after each session (lesson-propagation-lag territory). /wrap auto-detects new owner-pushback-correction events and surfaces them for inline triage so they land in `.claude/meta-corrections-registry.md` before session close.

   **Canonical invocation:** `/meta corrections --scan --current` (then `--add` per approved row). See `.claude/skills/meta/SKILL.md` "Process — Corrections" for the full subcommand surface. The bash commands below are the orchestrator's implementation (Claude Code skills can't invoke slash-commands from bash, so the orchestrator calls `scripts/meta-corrections-scan.py` directly — same script that `/meta corrections` dispatches to).

   **Detection (≤3 sec):**
   ```bash
   python3 scripts/meta-corrections-scan.py --current 2>&1 | grep "^Total candidate events:"
   # → "Total candidate events: N across 1 session(s)"
   ```
   If N = 0 → skip silently. If N ≥ 1 → continue to triage procedure.

   **Caveat — `scan=0` ≠ "no corrections."** The regex keys on canonical correction tokens ("are you sure" / "wrong" / "no, do X") and structurally under-matches two flavors: (a) **imperative-reframe** ("build it properly" / "not some X variant"); (b) **provenance-probe questions** ("where does this come from?" / "why is this relevant?"). So before trusting `N=0`: if you KNOW an owner-correction occurred this session — you cited/asserted something → owner probed/pushed → your position shifted — manually `--add` it anyway (the `--add-entry` flow in step 6 below). Do NOT widen the regex to chase these: provenance-probe questions are overwhelmingly benign, so the recall fix would explode the registry's ~20-30% FP rate — the orchestrator's manual-add habit is the robust mitigation (capture-layer, not enforce-layer). Codified two occurrences, 2026-06-03 and 2026-06-09; on the second a `/me` gate was dropped while the scan returned 0.

   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 7f — triage procedure and auto-fix rule (fires when the scan returns N ≥ 1)** — READ IT before executing this step.

   **Skip rules:**
   - Zero candidate events (N=0) → skip silently. Most "normal" coding sessions without owner pushback fall here. **BUT** apply the caveat above first — if you KNOW a correction occurred this session (cited/asserted → owner probed → position shifted) but the regex returned 0, manually `--add` it; `scan=0` ≠ "no corrections."
   - All current-session events already present in registry (e.g., owner manually triaged mid-session) → skip silently per de-dupe check in Procedure step 3.
   - Trivial session (<5 messages, no significant decisions per /wrap trivial-session gate) → 7f skips alongside the rest of Step 7.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7f — evidence basis and coordination** — READ IT before executing this step.

## Step 7g — forward-list tracker-home verification — from `SKILL.md` § Process, lines 534–554

7g. **Forward-list tracker-home verification (forward-pointer list = tracker-verify per item, mandatory whenever the closing session summary will include a "Pending / next session" / "what's next" / forward-pointer list).** Closes the forward-direction gap that Step 7c does NOT cover: 7c syncs SHIPPED work *backward* into trackers (archive-done / mark-closed / capture-ideas); 7g verifies the PENDING (work-to-come) list each item resolves to a durable home BEFORE it is presented to the owner as "tracked." Without this, the orchestrator free-composes the forward-list from conversation memory and asserts items are tracked when they are not — the recurring failure where the owner has to ask whether these are tracked and a floating item surfaces.

   **Cross-session delivery — a tracker home is necessary but NOT sufficient for a hand-off.** If a forward-list item ASSIGNS work to ANOTHER session (defer-to-peer / hand-off / "→ the owning session's wrap"), the durable home is PASSIVE — the named session won't SEE it. `mail-send --to <sid8|all>` the hand-off at wrap (free, no approval needed) so it doesn't ORPHAN when THIS session terminates (the dead-session-orphan failure — the deferral had to be dug out of a closed peer's transcript by hand). Both: a durable home AND a mail.

   **Procedure (per forward-list item, ≤30 sec each):**
   1. Resolve each item to a concrete durable home — `todo.txt:N` open task / `BACKLOG.md` row / `project_*.md` tracker line / `project_feature_audits.md` row. Grep/read to confirm the line exists; don't assume.
   2. Item resolves → keep it in the list (optionally cite the home).
   3. Item does NOT resolve (lives only in this conversation / a prior session's wrap-summary / a "queued for a future pass" note) → it is **FLOATING**. Create the durable entry FIRST (tracker-home at creation — declare tracker-home with a concrete trigger), THEN list it.
   4. Prefer building the forward-list FROM the tracker files over free-composing it from memory.

   **Behavioral guard:** the summary shape *"N of M were already tracked, 1 had a gap now fixed"* is the SYMPTOM of an unverified emission — the existence of the 1 gap proves the list was presented without per-item verification. Run 7g BEFORE emitting; the owner should never have to ask.

   **Auto-fix rule:** creating a floating item's durable entry is a ≤15-LOC tracker append → execute inline during /wrap; the new `todo.txt`/`BACKLOG.md` line lands in Step 8's session-residual commit (so the entry exists before the summary that references it ships). If a floating item needs a NEW BACKLOG P-tier slot or a tracker-row creation >15 LOC → surface as a proposal, don't free-compose.

   **Skip rules:**
   - Closing summary has no forward-list (nothing left pending) → skip silently.
   - Trivial session (<5 messages, no decisions per /wrap trivial-session gate) → 7g skips alongside the rest of Step 7.
   - Target tracker (`todo.txt` / `BACKLOG.md`) currently staged by a parallel session per Step 8 pre-stage check → create the entry but expect the parallel-session commit discipline (explicit pathspec) to keep it isolated; if the file is mid-write by a peer, the floating item's home may defer to the NEXT /wrap (note it explicitly rather than silently dropping).

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7g — evidence basis and coordination** — READ IT before executing this step.

## Step 7h — defer-trigger reconcile sweep — from `SKILL.md` § Process, lines 555–567

7h. **Defer-trigger reconcile sweep (deterministic; added 2026-06-22).** When this session has ≥1 commit, run the defer-trigger evaluator and surface its **RECONCILE bucket** — items whose `done-when` predicate just became TRUE (work shipped this session) but whose box is still `[ ]`:
   ```bash
   python3 scripts/defer-trigger-scan.py   # bare is COMPLETE for commit-touches since 2026-07-30 (blame-anchored default); add --run-exit-zero when the exit-zero predicates matter
   ```
   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7h — HISTORY: the bare-invocation window** — READ IT before executing this step.
   For each RECONCILE candidate: **verify the deliverable yourself** (the `done-when` is a heuristic — a narrow predicate can cry wolf; e.g. a 2026-06-22 over-narrow done-when falsely read "done"), then flip `[ ]`→`[x]` with a one-line evidence note. An item bundling a SEPARATE deferral stays surfaced — never auto-flip (the manual June-12 reconcile shipped 2 false-RESOLVED of 35). Edits land in Step 8's commit (`todo.txt`, explicit pathspec).
   - ⛔ **READ LINE 1 FIRST — THERE IS A FOURTH BUCKET AND IT VOIDS THE OTHER THREE.** If line 1 carries `⛔ N INSTRUMENT FAILURE(S) — THIS RUN IS VOID`, N predicates could not be EVALUATED (a git/grep/eval error, or a `--since` git cannot parse), so every bucket below it is computed over a partial evaluation and none of them is a reading. Fix the instrument and re-run; do NOT triage the buckets. Measured 2026-09-06: one malformed `--since` moved DOABLE-NOW 71 → 2 and STALE 0 → 79 while rc, the unevaluated count and the RECONCILE bucket all stayed identical — every number this spec tells you to read was invariant under a totally broken run. The `wrap-reconcile.mjs` gate reads this line for you and pushes a VOID finding into `findings[]`, so the tool will refuse `ok:true` — but it reads the scan it runs ITSELF, not one you ran by hand, so a hand-run here still needs your own eyes on line 1.
   - **DOABLE-NOW bucket → surface as a one-line COUNT only** — "N defers now doable — `/triggers` for the list" (since the 2026-07-30 blame-anchored default, the bare command reproduces the count; the general rule stands: a surfaced count's pointer must name the exact invocation that produced it — 2026-07-30, 17-vs-1); do NOT expand it. You act on doable-now at session START (when you have appetite), not at close. **STALE bucket** (a `meta:` predicate pointing at a missing path) → open each row first: one whose text names the printed STALE detail as its fire is a FIRE, surfaced to the owner and never re-pointed; otherwise surface + fix inline (≤5-LOC block edit).
   - **LATCHED bucket → surface as a one-line COUNT beside it** — "N latched — hot-path commit-touches rows that fired long ago; re-key, not work" (since 2026-09-07: a `commit-touches` row whose watched path has ≥ `LATCH_COMMITS` distinct commits since the row's own anchor leaves DOABLE-NOW for LATCHED — still on the bare scan, never behind a window; `scripts/defer-trigger-scan.py` prints the resolved threshold in the banner). They are NOT in the doable-now count, so a doable-now figure that fell across that date is re-labelling, not progress — `wrap-reconcile` reads the count from the same line 1 and says so. A latched row's disposition is a predicate RE-KEY (grep-present / file-exists / exit-zero on the thing it actually waits for), a ≤5-LOC block edit, the same shape as STALE below.
   - ⛔ **AT A RETIREMENT WRAP THE DOABLE-NOW COUNT IS NOT AN OWNER ITEM.** A retiring session takes in no new work. The bucket is FLEET backlog whose blockers happened to clear; it is not this session's scope and it is not a decision. A retiring session **hands off open loops and opens none** — put the count in the handoff broadcast or leave it for `/triggers`, and keep it out of the owner-facing close. **Tell: you are about to write a number under "Needs you" that no one asked for and that nothing bad happens to if it waits.** Measured: 71 was surfaced to the owner three times in one retirement close, each time correctly derived and none of it theirs.
   - **Skip when:** zero session commits; `todo.txt` currently staged by a parallel session (per Step 8 pre-stage check — reconcile next /wrap); trivial session (<5 messages).
   - **Coordination:** complements `/hanging-work` Check 12 (run at Step 1), which greps FREE-TEXT defer triggers (broad net, catches un-`meta:`-tagged items); 7h evaluates the structured `meta:` blocks deterministically (precise, the class-1 subset). As more defers get `meta:` blocks, 7h subsumes Check 12. On-demand twin = `/triggers`; session-START surface = `/orient` Step 8.
