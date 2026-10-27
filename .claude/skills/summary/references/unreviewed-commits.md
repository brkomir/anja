# /summary — §7 shipped-but-unreviewed, with its executable block

**Not loaded on an invocation.** `../SKILL.md` is the core that every run and every compaction carry; this file holds, with the copy's edits, Process §7 — the step's prose, THE EXECUTABLE BLOCK a run reads here and runs as written, and the bounds, triage table and non-git leg that follow it as they stood in `SKILL.md` before the 2026-10-25 slim. Beyond the copy's edits nothing was paraphrased: each `## §` heading below names the source line range, and the text under it is the cut-and-pasted original with those edits, so a phrase of the old spec usually greps here. **Where this file and the core disagree, the core wins.** Older incident records: `cases.md`.

## § 7 — the step, before the block (SKILL.md, lines 884-907, with the copy's edits)

### 7. Shipped-but-UNREVIEWED — what this seat committed that no reviewer has seen

⛔ **ADDED 2026-08-27, after a check of what was missing a review from the hub found TEN of
fourteen commits.** Nothing in this repo surfaced that
gap. `/hanging-work` Check 13 has a SENT-side arm — it flags a review you REQUESTED that never came
back — and that arm is structurally blind to the case where you never requested one. A request you
never sent produces no artifact to go looking for, so the absence is invisible to every net that
scans for stalled requests. This section is the missing half.

⛔ **STEP 1 ENUMERATES FROM THE jsonl CREATION-RECORD. NEVER FROM THE `Claude-Session:` TRAILER
— that spelling was this snippet's own instrument until 2026-08-30 and it read 1 of 41.** Measured
on one seat: its commits carried **three** trailer values — the 8-hex sid, plus two
DIFFERENT session URLs either side of a compaction — so the single-spelling grep returned ONE
commit where forty-one were shippable, and §7's failure direction is *"everything risk-bearing has
been sent"*. Fleet-wide the same day: **237 commits, 12+ distinct trailer values in TWO
incompatible formats** (8-hex AND full URL), plus **a `safe-commit` self-test FIXTURE
literal on five commits reachable from `main`.** No spelling catches both formats, and a
normalizer would have to recognise a fixture as not-a-session. ⛔ **AND DO NOT "FIX" IT BY ROUTING
STEP 1 THROUGH THE MAIL STORE**: step 2 already IS the mail store, so that replaces it with itself
— and the store holds no record of a commit that was never mailed, which is precisely the
population this section exists to find, so the empty set would read as clean. (Proposed and
withdrawn the same day, on this paragraph's own reasoning.)


⭐ **SINCE 2026-10-25 THE BLOCK SHIPS AS `scripts/summary-unreviewed.py` — RUN THAT, NOT THE BLOCK BELOW**. Reason: the slim left §7 a one-line "read it and run it as written" pointer to this file, and this project's one earlier split of that shape saw its side file opened 1 time in 251 runs. The script keeps every gate below (its docstring carries each one's intent) and adds three things the block lacked, each pinned by `scripts/summary-unreviewed-test.py`: the house commit tools' own `safe-commit: committed <sha>` / `private-index-commit: committed <sha>` lines (the seat's `| tail` / `| grep committed` output filters keep that last line and drop git's `[dev <sha>]` line, and `private-index-commit` builds with `git commit-tree`, which prints none — measured on one seat, the block's pattern found 12 of its 29 commits); a mail token counting when it is a PREFIX of the full sha (the block's substring test on git's current short sha missed a mail that named fewer characters); and a CRASH, exit 2, when neither `dev` nor `main` resolves. **This file is now the why and the history; the block below is the record of what shipped, never what a run executes.**

## § The block — the RECORD of what shipped, superseded by scripts/summary-unreviewed.py (SKILL.md, lines 908-1091, with the copy's edits)

```bash
# STEP 1 — this seat's commits, from git's own `[main <sha>]` confirmation lines in the
# transcript. Spelling-independent, and it is the instrument §1 already prescribes for the
# same split. The jsonl IS the session boundary, so no BASE has to be chosen.
MINE=$(mktemp)
python3 - > "$MINE" <<'PY'
import re, os
p = f"{os.environ['HOME']}/.claude/projects/<project-key>/{os.environ['CLAUDE_CODE_SESSION_ID']}.jsonl"
seen = set()
for line in open(p, encoding='utf-8', errors='replace'):
    # ⛔ NOT `\[main (...)\]` ALONE. git's confirmation line opens with the CURRENT branch —
    # measured in a scratch repo, and independently in a review: `[main 3b6c6c4]`,
    # `[feature 951e22a]`, `[detached HEAD 8525491]`, `[main (root-commit) 3b6c6c4]`. A
    # main-only pattern returns ZERO on a detached HEAD, and zero here reads as "all reviewed"
    # — the false-clean this whole section exists to remove, reproduced by its own fix.
    # ⛔ AND NOT THE OBVIOUS GENERALISATION `\[[^ \]]+(?: HEAD)? (hex)\]` EITHER — it fails in
    # BOTH directions at once, which is what makes it the wrong approach rather than a near
    # miss. It OVER-matches ordinary bracketed prose (`[BAND-O-DIGEST <digest>]`, `[word
    # deadbeef]`), and — the half a review found and neither author had named — it
    # UNDER-matches a real confirmation line, `[main (root-commit) 3b6c6c4]`, which the form
    # below catches. Both branch states that can occur here are named explicitly instead;
    # `feature-*` is excluded on purpose: sessions commit on `dev` (the
    # dev-branch policy; `main` for older transcripts; a hotfix worktree commits as
    # `[hotfix/<topic> <sha>]`, /push --emergency's branch) and review worktrees run DETACHED.
    # `dev` was MISSING until 2026-10-11, so every session's commits read as none and the
    # unreviewed slot came back clean (found 2026-10-11).
    # ⚠️ The prose over-matches are NOISE, not corruption: the reachability filter below drops
    # them. This comment claimed for ~10 minutes that two of them SURVIVED the filter on an
    # 8-hex collision — that was RETRACTED 2026-08-30 and was never measured. It was inferred
    # from a row count moving 43 -> 45 between two runs, and the +2 was the author's own two
    # commits landing in between. `<digest>`, `<digest>` and `deadbeef` all fail
    # `git rev-parse --verify -q <sha>^{commit}` here. Kept because the inference
    # shape — reading a delta on a tree that moves every few minutes as if it were a
    # measurement — is the one this file warns about three sections up.
    for m in re.finditer(r'\[(?:main|dev|hotfix/[^\] ]+|detached HEAD)(?: \([^)]*\))? ([0-9a-f]{7,40})\]', line):
        seen.add(m.group(1))
print("\n".join(sorted(seen)))
PY
rc=$?
# ⛔ GATE THE INSTRUMENT, LOUDLY — WITHOUT THIS THE SECTION FAILS TO "EVERYTHING REVIEWED".
# Measured with a bad session id: python exits 1, `$MINE` is 0 bytes, the loop emits nothing,
# and the closing line below tells the reader an empty set is a good answer.
# `bash-environment.md` § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE —
# breached in the one snippet whose whole purpose is catching an absence. EVERY other step-1
# failure mode (wrong pattern, moved transcript, renamed field) terminates at this same silent
# zero, which is why this gate outranks any pattern fix. Found 2026-08-30.
if [ "$rc" -ne 0 ]; then
  echo "STEP 7 STEP 1 FAILED (rc=$rc) — INSTRUMENT FAILURE, NOT 'everything risk-bearing has" >&2
  echo "been sent'. Do not report §7 at all. Commonest cause: the transcript path is wrong." >&2
  rm -f "$MINE"; exit 1
fi
# ⛔ THREE STATES, NOT TWO. rc!=0 is a CRASH. rc==0 with zero rows is a session that COMMITTED
# NOTHING — legitimate and common — and telling that reader "instrument failure" is a false
# alarm that trains them to ignore the real one. Do not fold them into one condition.
# ⛔ COUNT LINES, NOT BYTES: `[ -s ]` IS THE WRONG INSTRUMENT and reads as right —
# `print("\n".join(...))` on an empty set still emits a bare newline, so the file is 1 byte and
# `-s` is TRUE. Measured: the zero-commit arm sailed straight into the normal branch.
# ⛔ AND NO `|| echo 0` ON `grep -c` — it prints `0` AND exits 1, so the fallback fires too and
# `$rows` becomes `0\n0`, which THROWS in the `-gt` ("integer expression expected"). Codified in
# `bash-environment.md`; shipped here anyway and caught only because the arm printed the error.
rows=$(grep -c . "$MINE" 2>/dev/null); rows=${rows:-0}
[ "$rows" -gt 0 ] || echo "(no commits from this session — §7 is empty for THAT reason, which is not the same as everything having been sent)"
SID8=${CLAUDE_CODE_SESSION_ID%%-*}

# STEP 2 — the mail store, ONE PASS. `*__<me>.md*` is mail FROM me; the trailing `*` keeps
# `.read`. Walk the store ONCE, collect the hex tokens each request-marked mail names, then
# intersect per sha below.
# ⛔ THE PASS IS OUTSIDE THE SHA LOOP ON PURPOSE — NESTING IT INSIDE TIMES OUT AND THE TIMEOUT
# READS AS A RESULT. Until 2026-09-04 this `find` ran once PER SHA: 227 shas x 148 mails is
# ~34k greps, and it was MEASURED dying at the Bash tool's 2-minute cap (exit 143) on this very
# seat — twice, because the first death was read as "the store is quiet" rather than as an
# instrument failure. A per-sha loop is O(shas x mails) and every heavy session grows BOTH
# factors, so this fails precisely on the sessions with the most to review. Single pass is
# O(shas + mails) and finishes in seconds.
#
# ⛔ TWO-PART PREDICATE: is this mail a review REQUEST, and does it name this sha (anywhere)?
# Neither half alone works, and THREE single-half versions have shipped and failed.
#
# v1 — whole-file `grep -rlF "$h" …` matched any mail that merely MENTIONED the sha, and a
# fleet broadcast quoting your own commit list is exactly that. MEASURED on one
# seat: 5 of 5 commits read `sent:1`; THREE had never been sent to anyone.
#
# v2 — subject-only, sha in subject. Fixed the above and introduced a WORSE, SYSTEMATIC blind
# spot. MEASURED against the RECEIVING side (104 real review requests held
# there): sha in SUBJECT 92, sha in BODY ONLY 12 — and ALL TWELVE ARE BATCH REQUESTS. A subject
# cannot hold nine shas, so a batch NECESSARILY puts them in the body: subject-only misses 100%
# of batches, and a batch is the shape carrying the most commits per request.
#
# v3 — REQUEST-MARKER on the subject, sha ANYWHERE. Verified on the sending side: 8 of 8
# sha-quoting broadcasts carry no request marker; the requests carry `--code`/`request`.
#
# v4 (this one) — SUBJECT MARKER **OR** FRONTMATTER `signal:` IN THE REQUEST/FOLD ALLOWLIST.
# v3's marker list is three literals, and a fold report whose subject reads `FOLD <sha>` matches
# none of them — the hyphenated `fold-verify` is not the word `FOLD`. MEASURED on one seat's
# own outbound corpus, 2026-09-04: of 148 sent mails, 20 hit on subject with NO signal at all
# (so the subject arm is load-bearing and this is a UNION, never a replacement —
# an archived shell-environment note, not in this copy: the fix for an incomplete sweep is routinely incomplete in the OPPOSITE
# direction), and 5 carried a fold signal their subject missed. Both arms over the same 227-sha
# creation-record set, 223 reachable from main: v3 called 148 UNSENT, v4 calls 141, and ALL SEVEN
# recovered commits are `fix(...)` — the risk-bearing class this section exists to catch, each
# one already sent inside a FOLD mail. The failure v4 removes is the SAFE direction (over-report),
# but 7 false alarms in the one class that matters is what teaches a reader to skim the section.
#
# ⛔ THE ALLOWLIST IS AN ALLOWLIST AND MUST STAY ONE — AND THIS IS THE OPPOSITE OF THE
# CONVENTION NEXT DOOR, so someone will "fix" it for consistency. `session-manifest.py`'s wake
# decision is a DENYLIST, correctly, because there an unrecognised signal must still WAKE you.
# HERE the safe direction is inverted: an unrecognised signal reading as NOT-a-request only
# over-reports a commit as unsent (safe), while reading as a request marks work reviewed that
# nobody reviewed — the exact false-clean v1 and v2 both shipped. A new signal type therefore
# gets ADDED here deliberately, never admitted by default.
# ⛔ `review-verdict` / `review-finding` / `review-ack` STAY OUT: on the SENDING side those are
# you reviewing SOMEBODY ELSE, so a verdict you write that happens to quote your own sha would
# read as "sent" — v1's bug by another route. `review-ack` is confirmed correct to exclude (hub
# store, 6 of 6 genuine acknowledgements of a verdict, none of them work sent for review).
#
# ⛔ BUT `deploy-review` IS IN THE ALLOWLIST, AND THE REASONING THAT EXCLUDED IT WAS WRONG.
# v4 shipped excluding it, arguing the cost was "zero" because all 5 of THIS seat's
# `deploy-review` sends are `--code request`s the subject arm already catches. That argument was
# weak by construction and a review broke it from the RECEIVING side, the corpus a
# sender's own store cannot see: at least one seat uses `deploy-review` as its REQUEST signal,
# 7 times, including an amendment to a QUEUED request that the subject arm misses. Corroborated
# here on a wider population — the WHOLE store rather than one inbox — 19 of 62 `deploy-review`
# mails carry a request-class subject. A seat's own outbound cannot answer "how do OTHER seats
# signal a request", so do not re-derive this exclusion from your own sends.
#
# ⚠️ KNOWN UNDER-REPORT, MEASURED, DELIBERATELY NOT FIXED HERE: `review-verdict` IS OVERLOADED.
# Four seats use it for "I folded your verdict, here is my commit" — which IS work exposed to a
# reviewer — as well as for "I reviewed you". The receiving side's deciding set: 9 of 9 were FOLD reports.
# Whole store: 33 of 163 `review-verdict` mails carry a FOLD-class subject. So excluding it
# leaves a real hole and INCLUDING it re-opens v1. An allowlist cannot fix a token that means
# two opposite things — the fix is a convention (`fold-report` already exists, 10 in store), not
# a predicate. Recorded so the next seat does not re-derive it and close it the wrong way.
#
# ⛔ AND DO NOT REACH FOR A SUBJECT-ANCHORED `^FOLD` MARKER AS THE CLEVER FIX — MEASURED AND
# REJECTED 2026-09-04. It looks like it dissolves the overload, since fold reports announce
# themselves in the subject. It admits 231 store mails, and among them `FOLD-VERIFIED` (the
# REVIEWER confirming a fold) is a VERDICT sitting two letters from `FOLD-VERIFY` (the author
# requesting one). That near-miss is the same shape as the bug v4 exists to fix.
#
# ⛔ `find`, NOT a glob — zsh `nomatch` ABORTS the whole command on an empty store, BEFORE the
# loop body, so a `[ -e "$f" ] || continue` guard inside it is UNREACHABLE BY CONSTRUCTION.
# Measured both shells with a positive control: empty store, zsh -> `no matches found` and the
# command dies; bash -> reaches the end with n=0. The Bash tool runs /bin/zsh, so a bash test
# PASSES WITH THE BUG PRESENT — which is how it shipped. Hits any seat whose store holds no
# mail it sent, i.e. a fresh session running /summary.
V=$(mktemp)
find .claude/state/session-mail -maxdepth 1 -name "*__${SID8}.md*" -type f 2>/dev/null \
  | while IFS= read -r f; do
      # ⛔ SCOPE THE FIELD READ TO THE FRONTMATTER BLOCK. `grep -m1 '^signal:'` over the WHOLE
      # file takes the first match anywhere, so on a mail with no frontmatter signal a BODY line
      # beginning `signal:` is read as the header — the exact whole-file-regex hazard
      # `session-manifest.py` warns about beside its own `_parse_mail` ("a body-planted `signal:`
      # line must not be" trusted). awk stops at the closing `---`.
      fm=$(awk 'NR==1{next} /^---$/{exit} {print}' "$f" 2>/dev/null)
      hit=0
      printf '%s\n' "$fm" | grep -m1 '^subject:' \
        | grep -qiE -e '--code' -e 'review request' -e 'fold-verify' && hit=1
      [ "$hit" -eq 1 ] || printf '%s\n' "$fm" | grep -m1 '^signal:' \
        | grep -qiE '^signal: *(review-request|review-fold|fold-verify|fold-report|fold|deploy-review) *$' && hit=1
      [ "$hit" -eq 1 ] || continue
      grep -oE '[0-9a-f]{7,40}' "$f"
    done | sort -u > "$V"

while read -r s; do
  [ -n "$s" ] || continue
  # Drops amended / reset shas — AND is what makes the pattern above safe: a bracketed
  # `[word deadbeef]` in ordinary prose is discarded here because it is not a real commit.
  # ⛔ ANCHOR ON A SHARED REF (`dev`, THEN `main`), NEVER `HEAD`. `HEAD` resolves in the CURRENT checkout, and this box has
  # 38 worktrees of which 27 are DETACHED (`git worktree list`) — measured, as was the effect:
  # from a real detached worktree pinned to an older base, a genuine main commit is DROPPED
  # under `HEAD` and KEPT under `main`. That is not the branch-reachability caveat it looks
  # like — it discards perfectly reachable commits whenever the reader's own HEAD is behind,
  # which is the normal state of a worktree, and tells them their work was reviewed. `main` is
  # a shared ref resolving the same from every worktree; so is `dev`, where sessions commit
  # (dev-branch policy), and a dev commit reaches `main` only at a promote.
  { git merge-base --is-ancestor "$s" dev || git merge-base --is-ancestor "$s" main; } 2>/dev/null || continue
  h=$(git rev-parse --short "$s")
  # Lookup against the one pass above. `grep -F` is a SUBSTRING match on purpose: `$h` is the
  # short sha, and a mail naming the full 40-char form must still count.
  grep -qF "$h" "$V" && n=1 || n=0
  printf '%s  sent:%s  %s\n' "$h" "$n" "$(git show -s --format='%s' "$s" | cut -c1-60)"
done < "$MINE"
rm -f "$MINE" "$V"
```

## § 7 — after the block: cross-check, triage, bounds, the non-git leg (SKILL.md, lines 1092-1216, with the copy's edits)


**Cross-check before trusting a low number.** The retired trailer method is still a valid SECOND
instrument once you take the UNION of every spelling your own commits carry — different failure
mode, so agreement is real corroboration. Measured on the run that found this: creation-record
**42 shas, 41 reachable from `main`**; trailer-union **41**. A creation-record count that lands far
under the union's is the tell that a `-q`, a `tail`, or a redirect ate your confirmation lines
(§1 documents all three).

**Report the UNSENT set, then triage it — do not report a raw count.** Most commits in a heavy
session are tracker rows and plan prose, and listing those as "unreviewed" buries the two that
matter. Per `behavioral-anti-patterns.md` #9, LOC is a proxy for EFFORT, never for
RISK/blast-radius, so triage on what the diff TOUCHES:

| touches | disposition |
|---|---|
| a WIRED hook, a guard predicate, a gate, `settings.json` | **OWED — name it in the readout; `/wrap` or your next ordinary turn sends it** — failure is fleet-wide and silent |
| an ALWAYS-LOADED file (`.claude/rules/`, the project index, a band) | **OWED — name it in the readout; `/wrap` or your next ordinary turn sends it** — every session and sub-agent loads it, and lost meaning greps to nothing |
| `src/`, a migration, a new or edited test | **OWED — name it in the readout; `/wrap` or your next ordinary turn sends it** |
| tracker rows, plan prose, a memory router re-index | skip — say you skipped them and why, in one clause |

⛔ **THE DISPOSITION IS *CLASSIFY AND SURFACE*, NEVER *SEND* — `/summary` DOES NOT MAIL, AND THE
SUCCESSOR IS NAMED SO THERE IS NOTHING TO DECIDE HERE.** Settled after
a restatement of the class rule shipped and was reverted.
**Name what is owed and TO WHOM — sha, what it touches, which hub** — so the
successor re-derives nothing: `/wrap`'s own review step, or your next ordinary turn, whichever you
reach first. *(This read **send** at first, which collided head-on with this command writing nothing but
the plan. The collision was real as written — this table's two categories are OWED and skip, skip's
gloss prescribes only what the READOUT says about a skip, and the reason column prices NOT SENDING —
so it was resolved by naming a successor, not by carving an exception.)*

⭐ **WHY A SUCCESSOR RATHER THAN A CARVE-OUT, because the next reader will want to re-litigate it.**
Mail IS a disk write — `session-manifest.py` creates one file per message — so the rule that these
commands touch nothing but the plan was never wrong about mail; it was **underspecified about what
happens next**. A commit already had a named successor for exactly this shape (`post-compact/references/post-compact-detail.md` (not in this copy) § Step 6 — full text:
*"the commit belongs to `/wrap` Step 8 or the next ordinary commit, and this step's job is to SURFACE
that it is owed"*) and mail did not.

⛔ **WHAT NAMING A SUCCESSOR BUYS — REWRITTEN 2026-09-07, WHEN THE ANSWER FLIPPED BACK.** This paragraph has now held three
positions, and the history is written in because the flip is the instructive part. (1) It first read *"Naming one REMOVES the decision instead
of relocating it"*. (2) A review broke that within minutes: the successor did not send either — `/wrap` 5e was *"SURFACE (never block,
never auto-run)"* and 8a was *"⛔ ASK, NEVER SEND … it does not mail the hub on its own"* — so the chain ended at **the owner decides**, and this
paragraph was corrected to say a successor merely RELOCATES. (3) Both clauses were then struck: the seat judges
whether a review is warranted, sends it, and says in the closing message that it sent it and what it was, so the owner keeps the visibility and
stops being asked. So 5e and 8a now DECIDE and SEND, and naming a successor removes the decision after all — position (1), by a mechanism it did not
have when it was written. **This also re-agrees with the disposition table twelve lines up**, which said `OWED — name it in the readout; /wrap or
your next ordinary turn sends it` throughout; the table was right and the paragraph beneath it was wrong for one commit's life.

⛔ **AND THE WORDS "Verified at source" ARE WHY THIS ONE HAD TO BE HUNTED RATHER THAN NOTICED.** Position (2) carried them, honestly and correctly
at the time — and they are exactly what stops the next reader re-checking. A citation that rots UNDER them is worse than a bare one, and this was a
load-bearing premise in a design argument rather than a footnote, so the argument inherited the falsity and licensed *"the owner decides"* in an
owner-facing readout. ⛔ **The pointer to this paragraph was INSIDE the sentence being deleted:** the struck `/wrap` 8a text carried
*"(also cited at summary/SKILL.md:1010)"*, and the strike still missed it, because the edit happened in `wrap/SKILL.md` and nothing re-read the
condemned sentence for its own outbound pointers. Found, in a file neither commit touched. **Check, whenever you strike a cited
claim: grep the TEXT YOU ARE DELETING for pointers to siblings, before you delete it — it is the last moment that list exists.**

What naming a successor actually buys is unchanged by all three positions, so it survives the rewrite: the handoff becomes **DURABLE and
LEGIBLE** — the owed item lands somewhere with a named next reader instead of in a readout that scrolls, nothing collides with the class rule,
and no seat has to judge anything mid-command.

⚠️ **BOUNDS, both load-bearing.** The creation-record is sound in ONE DIRECTION ONLY (§1, at
length): PRESENT ⇒ strong evidence you ran that commit; **ABSENT ⇒ NOTHING** — 16% of unpushed
commits carry no creation record in any transcript, and a `-q` / `tail` / redirect on your own
`git commit` deletes yours. **So this is a FLOOR, never a total, and it enumerates commits you
RAN — the right population for "did I send my own work for review" and the wrong one for
authorship.** And a sha absent from your sent mail is exact only because the grep keys on the sha
itself: if you described a commit to the hub without naming its sha, this reads it as unsent. That
direction is SAFE (it over-reports), and over-reporting is the correct failure for a net whose
whole purpose is catching an absence. ⚠️ **It fires in practice, so read the set before you act on
it:** one commit, measured 2026-08-30, was reported unsent while the seat HAD told the hub its
reasoning in a fold-verify — without the sha. The commit still needed sending (the hub had been
left holding an open fork), so the over-report was right for a reason the grep could not see.

⛔ **AND THE OVER-REPORT RATE GROWS WITH COMMIT AGE, BECAUSE THIS INTERSECTS A PERMANENT SET WITH
AN EXPIRING ONE.** Step 1 enumerates from the transcript, which never decays; Step 2 checks the
mail store, which is PRUNED — `scripts/session-manifest.py` `MAIL_READ_TTL_HOURS = 24` and
`MAIL_UNREAD_TTL_HOURS = 72`. A review request a LIVE hub reads promptly flips to `.read` in
minutes and is deleted a day later, **so the better the review, the faster its evidence
disappears** — and the commit it covered reads `sent:0` forever. *(The 24h figure is the READ
TTL; a `deploy-*`-signalled mail keeps 72h, and `_is_verdict_mail` keys on the PREFIX, so
`deploy-review` REQUESTS inherit that carve-out too — 48 store files carry the signal. Erring
toward over-alarm, so a nit rather than a defect in the argument.)* Measured 2026-09-05: 238 shas
reachable, 149 `sent:0`, and a whole-store grep at 8 AND 9 characters found no surviving review
REQUEST for either risk-bearing sha — both of which had in fact been reviewed. ⚠️ *That sentence
said "ZERO mail naming either sha" until it was checked: two broadcasts naming both shas were
sitting in the store the whole time, one of them mine. The conclusion held; the prose overran the
bytes, which is the exact split named three paragraphs down.*

⭐ **SO BEFORE TREATING AN AGED `sent:0` AS A FINDING, ASK GIT — THE GIT PLANE OUTLIVES THE MAIL
PLANE.** `git log --all --grep='<sha>' --format='%h %s'` (never capped): a fold commit names the
verdict it folded, so `fold(<peer> verdict on <sha>)` IS the review record. ⛔ **BUT IT REACHES
FOLDED REVIEWS ONLY, AND A CLEAN APPROVAL IS THE LARGER CLASS — SO THE BEST-REVIEWED COMMITS ARE
THE ONES THIS REMEDY PERMANENTLY FAILS.** An APPROVED-no-findings verdict produces no fold commit,
so nothing on the git plane ever names its sha, and past the TTL the row reads `sent:0` with the
dismissal-burden clause below forbidding you to clear it. Measured 2026-09-05, uncapped: three
clean approvals returned **0 hits each**, against **6 / 3 / 3** for three fold-carrying shas. **So at fold-verify time write the verdict sha into a `todo.txt`
row — that row is the only durable record a clean approval ever gets**; the three that do clear,
clear through exactly such rows. ⛔ **This is not
licence to dismiss the row — a dismissal of your own instrument carries the same evidence burden
as the finding, so NAME THE ARTIFACT that proves it reviewed.** A dismissal without an artifact is
memory wearing an instrument's clothes, and it is worse than ignoring the row: ignoring leaves it
for the next reader, explaining it away spends the finding and hands the owner a false all-clear.

**An empty unsent set is a good answer** — "everything risk-bearing has been sent" — but say which
BASE you measured from, because the boundary is the whole claim.

⛔ **AND A FILE WRITTEN OUTSIDE THE REPO HAS NO COMMIT, SO BOTH STEPS ABOVE ARE BLIND TO IT —
RUN THE NON-GIT LEG EVERY TIME.**

```bash
python3 scripts/non-git-writes.py        # (not in this copy) EXACT = an Edit/Write outside the repo; POSSIBLE = a shell write naming such a path
```

Measured on one session: this section read "nothing unreviewed" while a ~700-line
file written outside the repo sat unreviewed, and a review then found real defects in
it. **Each listed path is either REVIEWED** (a frozen
dated copy plus its sha256 mailed to the hub, and the verdict named) **or carries a stated reason
on its own line** — a backup copy, a cache, a file only read. A review covers the sha256 it was
sent with: if the file's current sha256 differs, it is unreviewed again. ⛔ **A POSSIBLE row is a
heuristic over the command text — read the command before calling it a write; one that IS a write
owes exactly what an EXACT path owes**; rc 2 means no session id or not exactly one transcript
(or a transcript with no parseable record), an instrument failure and never an empty set. An empty set prints its own
`NONE` line; quote it. **And the closability verdict counts this leg**: an EXACT path, or a POSSIBLE
row read as a write, with neither a review nor a reason is a `ready to /wrap: no`.

