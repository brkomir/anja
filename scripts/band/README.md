# Band-compression instruments

One-shot tools from the 2026-09-07 always-loaded-band compression pass.
Nothing wires them — no hook, no test, no CI job calls them. They are here because the pass that
built them promised them, and because the next band pass would otherwise rebuild them from scratch.

| file | what it answers |
|---|---|
| `narrative-mass.py <repo-root>` | how many bytes of INCIDENT NARRATIVE the gated plane carries, per file. An UPPER BOUND — a directive can carry a date too, so hand-read a sample before believing the yield. Measured 27% real yield against this predicate on the founding pass. |
| `displace.py <spec.py>` | performs ONE displacement: copies the original verbatim into its archive under a dated heading, then replaces it in the live rules file. Every check runs BEFORE any write. `BAND_SID` / `BAND_DATE` env vars stamp the archive heading. |
| `blockcheck.py` | `check(base_text, old_line, new_line)` — the parity guard. Returns the anchors that `band-directive-preservation.mjs` would stop extracting from UNTOUCHED lines of the same block after your swap, across ALL THREE of the guard's channels (code spans, bold spans, lesson ids). `python3 blockcheck.py --self-test` runs six arms including the retired line-scoped check failing on a case the block-scoped one catches; a bare invocation exits non-zero. |

## Why `blockcheck.py` exists — the defect it compensates for

`scripts/band-directive-preservation.mjs:248` extracts bold spans with
`/\*\*([^*\n]+)\*\*/g`. The character class excludes `*`, so `**A *B* C**` is not matched as one
span, and the `**` markers re-pair sequentially across the whole soft-joined block. Consequence:
dropping ONE emphasis marker in a rewritten line makes the guard report N lost anchors on lines
you never touched, and those N are phantoms. Measured on the founding pass: 11 reported lost,
1 real defect; after restoring the dropped italic, lost went to 0.

`displace.py` calls `blockcheck.check()` before every write, so a move that would shift the
pairing aborts instead of shipping a false-RED guard run. That check is the reusable part.

**Reviewed 2026-09-07** — APPROVED-WITH-FINDINGS, one serious finding and two
moderate ones. All three are folded here, plus four minor ones and the review's ruling on `parity.py`, which is DELETED — its
line-scoped check now lives inside `blockcheck.py`'s self-test as the arm that demonstrates it
failing, because a standalone file whose docstring never said it was wrong is a trap for whoever
greps this directory for a parity check. What is NOT folded,
named rather than left to be discovered: `block_of` still takes the whole blank-line block rather
than the narrower span the guard actually joins, and the two committed tools still disagree in one
place about what a unit is (`narrative-mass.py` splits on more prefixes than `displace.py` accepts).
Neither changes a verdict on today's corpus; both are real.

## Operating notes the founding pass paid for

**The guard measures the WORKTREE, not a commit — and since 2026-09-07 it TELLS YOU which kind of
loss you are looking at, so this is no longer yours to work out by hand.** An uncommitted peer edit
to a rules file is a "lost anchor" that no commit of yours can clear, and it re-fires on every run
until somebody commits or reverts it; a committed reword is a real change you can name. Each lost
anchor now prints `<- WORKTREE-ONLY (uncommitted; NO sha exists…)` or `<- COMMITTED <sha>`, with the
removing commit resolved per anchor where the pickaxe can reach it and a chase set where it cannot.
⛔ **A resolved sha is VERIFIED, not merely pickaxed.** `-S` is count-based and matches SUBSTRINGS,
so a commit touching unrelated prose that happens to contain the anchor can be the single hit while
the real removing commit leaves the count unchanged and never appears — 1,011 of 3,672 band-wide
anchors are a substring of another (re-derive; the figure drifts). So each candidate is re-extracted
either side of itself and kept only if the count actually dropped there. When nothing verifies, the
line says WHICH of the four reasons applies — empty anchor, no count change, several verified
commits, or count-changing but unverified — rather than blaming normalisation for all of them.
⚠️ **Only in worktree mode.** With `--head <ref>` both sides are commits, the question does not
arise, and the code returns before doing any git work — which is how `.githooks/pre-push` calls it,
so the push gate's output is byte-identical to before. Verified on a range that does REAL work
(`--base <commit-id>^ --head HEAD`, 19 lines / 3,650 bytes, rc=1 both) — an earlier control ran on a
range where no band file had changed, so both scripts refused identically and the match proved
nothing. **The old manual tell — your own sentence names a sha for one lost anchor and nothing for
another — is now what the tool prints for you.** Measured cost of not having it: 15 guard runs and
3 re-adjudications over 54 minutes.

**Re-baseline to your own first parent, never `origin/main`.** On a live fleet the guard is
routinely already RED at `origin/main` from other seats' rewords — measured 45 lost anchors across
11 files while `--self-test` returned 41/41 PASS.

**A move must earn its archive bytes.** Displacement moves the WHOLE original into the archive
plus a preamble, while the yield is only original-minus-replacement, so the repo grows about
twentyfold per unit. Measured: −816 B on the gated plane for +16,494 B of archive. The founding
pass reverted six moves under a working floor of roughly 100 B of yield.

**Trigger cells are byte-frozen in both guard modes** — the first cell of every table row. No
reword mapping can adjudicate one away, because the archive is not a place a trigger can live.
Compress the ACTION cell and restore the trigger cell verbatim. That rule exists only as a comment
in the guard's own source.

**A non-negative byte delta on the source file of a displacement pass is a RED**, whatever the
guard says. It is the only tell for the corruption case: duplicated text loses no anchors, so the
guard reads a half-written file as fully preserved.

**Write the ARCHIVE before the RULES file, and write both atomically.** The founding version did
the opposite, non-atomically, and any failure between the two writes deleted the displaced
directive from BOTH files — measured: with the archive read-only, the original grepped 0 in the
rules file and 0 in the archive. `git show HEAD:<file>` is the only recovery and this tool runs
exactly when a rules file is mid-edit and uncommitted, so there is frequently nothing to recover
from. Archive-first fails toward duplication, which the note above says loses no anchors; atomic
writes (temp + `os.replace`) mean a partial write cannot truncate either file. ⚠️ One behaviour
change comes with it: an archive DIRECTORY that is not writable now refuses the run, where the old
code would have written the archive file in place. It refuses before touching the rules file, so
nothing is lost — but it is a refusal where there used to be a success.

**The protected-file hook cannot see this tool.** `block-subagent-always-loaded-write.sh` is
registered for `Edit`, `Write` and `MultiEdit` and keys on `tool_input.file_path`. A Bash-invoked
`python3 scripts/band/displace.py spec.py` carries no `file_path` and names no band path in the
command string, so the one net that would stop a hand-edit of `.claude/rules/*.md` is structurally
blind to this script. That is why its checks raise `SystemExit` rather than `assert`: `python3 -O`
strips every assert, and the whole safety model cannot live in statements a flag removes.

**Neither sanctioned commit route can take a displacement commit.** `private-index-commit.sh`
refuses any deletion and a displacement is all deletions; `safe-commit.sh` GATE 1 refuses while any
peer holds any path staged. Use the documented exit: read `git diff -U0 HEAD` on every declared
path, commit with `-o`, and say in the body that no gate sanctioned it.
