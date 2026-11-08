---
name: instinct-sweep
description: Use when the owner asks what he keeps doing by hand with the meta system, or when /meta maintain reaches its instinct-sweep member. Reads his own typed messages and commands across every session transcript, finds repeats nothing has codified, proposes a command, flag, default, procedure or spec edit for each with evidence, and tracks how his use of the system changes week by week. Writes plans/instinct-sweep/; files nothing without his yes.
type: skill
metadata:
  version: 2.1.4
  shipped: 2026-05-18
  redefined: 2026-11-02
  source: an idea on record + the 2026-11-02 panel
---

# /instinct-sweep — what the owner keeps doing by hand, and what to build for it

**Purpose.** Measure the patterns of use the owner repeats, and after about 3 repetitions suggest a new command or
procedure, shown at some point in a session's lifetime (the end of a wrap, say). Search session history for how he
interacts with the meta system: which patterns repeat without being spotted or codified, which new commands and
procedures could be built, and how the interaction and the system itself evolve over time.

**The unit is one owner act**: a typed message, a slash command with its arguments, an answered question, an
interrupt. The system's logs and git history are context for those acts, never the subject.

**Not this command** (each has its own home; never re-derive here): system-log dormancy → `/meta telemetry` · log and
memory health → `/meta status` · one session's lessons → `/meta learn` · AI-error corrections → `/meta corrections`
(its registry is an INPUT here) · his codified working style → `/me`.

## Build status

The instrument is `scripts/instinct-sweep.py` (built 2026-11-02): `run [--since YYYY-MM-DD]` does steps 0-2 and 5 and
writes a DRAFT (`plans/instinct-sweep/<date>-draft.md`, committed: short phrases, counts and uuids only, re-scanned for
secrets before it is written) plus `.claude/state/instinct-sweep-candidates-<date>.json` (gitignored) for the judgment
steps; `maintain` is the `/meta maintain` member; `--self-test` runs planted fixtures and a mutation table (also run by
a unit test in the source project, not in this copy). `--workers N` sets the transcript-pass processes (default 4). Exit codes:
0 ok · 1 usage (a bad mode or flag) · 2 a control failed, nothing written · 3 the corpus search is void, only the owner
ledger written · 4 the secret gate refused the rendered output, only the owner ledger written. Both state files are
mode 600. The judgment steps 3, 4 and 6 turn a draft into the report `plans/instinct-sweep/<date>.md`; a draft never
counts as the newest report, and `maintain` runs steps 0-2 and 5 itself while no report exists. The prose-matching half
(step 3) is OFF: a read of the October sample found 1 of its 26 deciding groups worth any automation.

## Inputs

1. **His acts — primary.** Top-level transcripts `~/.claude/projects/<repo key>/*.jsonl`, read only through the shared
   classifier (`classify_record` in `scripts/post-compact-recovery-index.py`, as `scripts/owner-words.py` uses it), and
   split three ways: HIS PART (his answer), QUOTED (assistant text he pasted back), PASTED (`>` lines). Only HIS PART is
   ever counted as his. Never `*/subagents/**` (agents' records, not his) and never raw `type:user` records (most are
   tool results). A message that opens with a quote and has no clean split (UNSPLIT) is QUOTED whole. Two shapes the
   classifier does not label: an interrupt is the harness's `[Request interrupted by user…]` record (no promptSource),
   folded into a refusal it directly follows; a side-agent note arrives as `promptSource: typed`, its
   `Here is a note offered by a side agent:` header and `>` lines are PASTED, and his reply under them is HIS PART.
2. **His typed commands — secondary index.** `.claude/logs/skill-invocations.jsonl`, `source: user-prompt` only;
   session-keyed only from 2026-09, and it never records built-ins (`/model`, `/effort`, `/compact`, …), which come from
   transcripts.
3. **The system side.** `git log` over `.claude/skills/*/SKILL.md`, `.claude/commands/*.md` and `.claude/hooks/*`
   (the commands and hooks added, with dates; rules are not read), `todo.txt`, `BACKLOG.md`,
   `IDEAS.md`, `DECISIONS*.md`; `.claude/logs/subagent-dispatch.jsonl` (from 2026-09-04) for delegation.
4. **Previous runs.** `plans/instinct-sweep/*.md` and `plans/instinct-sweep/ledger.md`.

**Not inputs:** `memory-write-attempts.log` (saw ~2% of memory writes in October 2026), `subagent-memory-block.log`
(mostly hook-test fixtures), `compact-checkpoint.md` (over-counts real compactions). Their health is a `/meta status`
or `todo.txt` matter.

**Excluded from evidence:** every session that ran `/instinct-sweep` or a panel about it (each run's own session, listed
in its report).

## Window

Counts and the weekly trend always cover full history (a whole-history read takes seconds). "New since last time" is
measured from the `window-end:` line of the newest report (`plans/instinct-sweep/YYYY-MM-DD.md`; never a `-draft.md` or `ledger.md`); `--since=YYYY-MM-DD` overrides.

## Procedure (S = script, J = judgment)

0. **S — Coverage table, printed before anything else.** Per stream: span, rows, parse failures, coverage against its
   ground truth (typed-command log vs transcript commands; any count vs transcript records). Owner turns per week, the
   QUOTED share, sessions read vs sessions in the window. **Controls**, or stop: his record that first asked for
   this command must be found; a hook-directed AUTO `/pre-compact` must not count as his. A month with zero
   owner turns is a coverage gap, never "no pattern".
1. **S — Extract.** One gitignored ledger of his records, keyed by record uuid (resumed sessions copy records):
   `.claude/state/instinct-owner-ledger.jsonl` (mode 600). Transcript text goes into a tracked file only as the short
   quotes this spec allows (§ Each proposal carries; the draft's short phrases), never whole records.
2. **S — Exact counts.** Command pairs and triples within one session and 30 minutes, built-ins included · flags or
   arguments he types on most runs of a command, or appends as free text ("and re-arm …") · exact repeats of HIS PART ·
   re-explanation requests (`/summary`, `/eli5`, `/explain` whose argument is QUOTED text) — filed as a defect of the
   SYSTEM's readout, never as his habit. Every count names its population: weeks, sessions, records.
3. **J — Prose clusters (OFF, after a read of the October sample).** Not run; see § Build status. Cluster HIS PART asks over 40 bytes that
   step 2 did not cover, one agent per week of asks, members cited by uuid.
4. **J — Verify each candidate** in a fresh agent with a refute mandate. It must show ≥3 distinct sessions on ≥2
   calendar days. Read the owning command's spec before naming what an act means (`/pre-compact --disarm` parks the mail
   listener through a compaction he runs himself; it is not resistance to automation). Classify: done by hand → proposal
   · forced by the system's own output → defect for the owning command · needs a human turn by design (a resume after a
   limit, `/model`, `/compact`) → drop · a required gate doing its job (push, paid run, destructive database change) →
   drop, never "friction".
5. **S — New?** Search the whole codified corpus — skill specs and the command index, `IDEAS.md` (every state, rejected
   included), `BACKLOG.md`, `todo.txt` (open and closed), `DECISIONS*.md` (Rejected included), `.claude/project-memory/`,
   `.claude/meta-corrections-registry.md`, `.claude/skills/meta/` (the directory, never the router alone) and the ledger.
   Every area prints its file count, no required area may be empty, and a known-codified control (`/pre-compact` and
   `--disarm` on one line in a skill spec; planted in the self-test's fixture corpus) must hit, or the search is void.
   This command's own directory is left out: its spec names candidates as examples. A phrase match is a hint, never a
   verdict: it cannot see a paraphrase. A key the ledger marks "no" is not raised again unless its distinct-session
   count has doubled since.
6. **J — Cap.** At most 5 proposals, ranked by distinct sessions; the rest one line each with the reason held back.
7. **Write** `plans/instinct-sweep/YYYY-MM-DD.md` (committed) with `window-start:` / `window-end:`, the coverage table,
   the weekly trend, the proposals and the held-back list; append one row per proposal to `plans/instinct-sweep/ledger.md`
   (`| key | proposed | sessions | status | answered | his words | report |`, status pending, then yes or no).
   Secrets, checked at the SOURCE and again on the draft: an owner record whose text, command name, arguments, flags, quoted or pasted half or chosen option
   matches a credential shape is counted and cited by uuid but never quoted, and no matched value is printed anywhere;
   the finished draft and the candidates file are shape-grepped again before they are written. The report is hand-finished, so neither net has read it: `python3 scripts/instinct-sweep.py --gate <report>` before it is committed (exit 4 refuses, and it prints no text). The shapes are
   `SECRET_SHAPES` in the script, one entry per shape, kept in line with `.githooks/pre-push`'s push scan (`scripts/instinct-sweep-scan-diff.py`, run in the unit tier, feeds planted values for every name the scan holds, in 46 contexts, to the scan's own patterns and to this list, and fails if the scan catches one this list leaves; a hash of the scan's block reds on any edit, because a new alternative needs a new planted value): `eyJ`, and
   at a token start (an escape that ends in a letter or digit counts as one: `\n`, `\t`, `\r`, `\b`, `\f`, `\xNN`, `\uNNNN`, `%NN`) `sk-`, `pdl_`, `re_`, `sbp_`, `gh[pousr]_`, `AKIA…`, `phx_`;
   anywhere `sb_secret_`, `github_pat_`, `sntrys_`, `whsec_`, `X-Amz-`, `-----BEGIN … PRIVATE KEY`, a Discord webhook URL, `PGPASSWORD=` or `:` in any case, and each vendor key at its full length, as the push scan writes it;
   and a postgres, mysql, mongodb or redis URL, a `+driver` suffix included, from `user:pass` on, in any case, with or without its `@`, a password starting with `/` included, or with a `password=` in its query string. His messages
   can carry such strings.

## Each proposal carries

Name · kind (new command / flag / default / procedure / spec edit / system defect) · home (the file it would change, or
"needs harness support") · evidence (distinct sessions, first and last date, 3 record uuids, the script line that counted
it) · at most 3 quotes of HIS PART, each ≤200 characters · the codified-corpus search result · what it replaces · size in
lines and files.

## Trend

Week by week, owner turns as the denominator: command share, re-explanation requests and interrupts per 100 turns, compactions by
trigger, recovery after compaction (of the compactions he acted after, the share with a `/post-compact` run before the next
compaction), delegation per turn, commands and hooks added. A movement is a FINDING only when it holds for ≥2 consecutive
complete weeks outside the prior 4 weeks' mean ± 2 SD, no logging change in the instrument the metric is read from sits in
those weeks unless a second instrument agrees, a candidate cause is named as a candidate, and the decision it would change
is named. Everything else is a one-line observation. Usage of a command counts from its creation commit: a metric that
counts a command is held as an era change when that command was created inside the movement's baseline weeks. Never a
time-of-day or mood read: dates only.

## After his answer

Yes to a new command, flag or procedure → `/ideas add` (or `/backlog` when he says build) · yes to a change in an existing
command → that command's spec, through `/meta learn` Step 4 · a preference he keeps restating → `/session-memory` as a
`feedback_*` file · a broken instrument → a `todo.txt` row · no → a ledger row with his words and the date.

## Inside /meta maintain

`/meta maintain` runs this command's member (a `/wrap` step would also fit if cheap; `/wrap` simply carries no
reader today). The member
(`python3 scripts/instinct-sweep.py maintain`) writes no tracked file. It reads the newest report and the ledger and puts at most 3 pending
proposals into maintain's consolidated approval table; his answers go to the ledger. When the newest report is older than
30 days, or there is none, it runs the script's steps 0-2 and 5 (seconds) and lists any new command-sequence candidates; the judgment steps
stay with `/instinct-sweep`.

## Self-test

`python3 scripts/instinct-sweep.py --self-test` on planted fixture transcripts: a command sequence in 3 sessions on 2 days
is found; the same in 2 sessions, or in 3 sessions on 1 day, is not; a phrase quoted back 5 times is not counted as his; a
sidechain record is not his; a duplicated record uuid counts once; a session that ran this command is excluded; a planted
credential reaches neither the ledger nor the draft, including one in a command's name, its arguments, a quoted or pasted half or a chosen option, each
shape in `SECRET_SHAPES` trips both nets (and each dropped alone lets its planted value leak), and near misses
(`task-list`, `pre_compact`, a URL with neither password nor port) do not, while a bare `host:port` URL is withheld (the shape cannot tell a port from a cut-off password; `user@host:port` can be told, and passes); a ledger "no" holds until sessions double, not merely grow; an argument on half the runs is no habit; maintain lists at most 3 pending and re-runs the
steps only past 30 days of elapsed time from the report's window-end (an unreadable one runs them, marked undated), and a draft or a -draft-v2 re-roll never counts as the newest report; both controls and the
corpus control can fail, and `run` then stops (before any write on a failed control, after the owner ledger on a void
corpus); the second net alone refuses a draft or a candidates body and `run` exits 4 with only the ledger written; a bad
or missing mode exits 1; a trend moves only on 2 weeks outside its baseline, and a logging change or a new command holds
it. The mutation table turns its named case red for 27 of these cases; the rest carry no row (the `run` stops, the
args-and-quoted-half case, and the eight `_once_cases` that run outside the per-mutation loop) and were mutated out by
hand at review, so a unit test in the source project pins every case name and both counts. Never a list of expected live
findings.

## Must never

Run as a hook · file or edit any skill, rule, memory, hook or tracker without his per-item yes · count
QUOTED or PASTED text, sub-agent records or hook-made records as his · write transcript text into a tracked file beyond
the short quotes above · report a count without its population · read a shift across a logging change on one
instrument · call a command unused from one channel's count · emit a confidence score · group by hour of day.

## Retire

After 3 consecutive runs in which he accepts none of the proposals, ask him whether to retire the command. Never loosen
the gate to get a proposal through.

## Provenance

v1 (2026-05-18) mined four system logs for lesson candidates with ECC-style confidence bands; its first logged run
(2026-11-02) found two of those logs unusable and its built-in self-test anchored on hook-test fixtures. The 7-seat panel
of 2026-11-02 redefined it, keeping the name, with the idea that asked for it as its basis, output committed under
`plans/`, and proposals through `/meta maintain`.
