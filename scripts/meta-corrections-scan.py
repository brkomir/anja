#!/usr/bin/env python3
"""
meta-corrections-scan.py — detect owner-pushback-correction events across session jsonls

v0.7 (2026-06-04): closed 3 detection misses surfaced on one session (textbook
  owner-pushback the v0.6 path returned 0 candidates for — /wrap 2026-06-03 Step 7f):
    (a) direct-challenge phrasings (asking how the assistant could dispute the point, or
        saying it seemed to be over-justifying) — pure regex-coverage gap;
    (b)+(c) the owner's QUOTE-AND-REACT idiom ('"<pasted quote of my prior output>" -
        <short reaction>') where the reaction trails a long quoted block (c) or is buried
        in a giant slash-command arg past the 1500-char length gate (b: 18,925 chars).
  Fixes: (1) reaction_tail() isolates the trailing reaction after the LAST '" -' delimiter
  and scans it regardless of total message length; (2) PUSHBACK_REGEX extended with a Cat-G
  block (challenge / recurrence phrasings); (3) pushback_signals() unifies the per-message
  scan path so scan_session() AND the new --self-test share one code path. Run
  `python3 scripts/meta-corrections-scan.py --self-test` after any regex/filter edit — it
  regression-guards all three corpus events + neutral-approval FP guards. (5) made the
  drain-due gate PATTERN-AWARE: the old raw `non-yes >= 20` count cried wolf on a healthy
  registry (single-instance N=1 candidates can't be codified until a 2nd occurrence, so the
  raw count never drains); it now hard-warns only on a pattern at >=3 distinct sessions with
  NOTHING codified. 2026-06-04 drain pass reconciled 11 stale "pending L###-candidate" markers
  (those L#s had since landed — sometimes under a different number: the speculative
  panel-size candidate entries actually belonged to another lesson, because the number they
  carried had since become the parallelization-blindspot lesson), lifting codification 61.8% -> 71.8% with 0 uncovered >=3-session patterns.

v0.6 (2026-06-03): added scan_overrides() — soft-override detection (the capture-gap fix).
  Parses AskUserQuestion tool-call records; flags when the owner selected an option OTHER than
  the one the orchestrator marked recommended ("(Recommended)"/rec in the label). A soft override
  carries NO pushback string (green-lighting the non-recommended path reads as agreement), so
  PUSHBACK_REGEX was structurally blind to it. Surfaced alongside pushback candidates; feeds the
  same owner-triage -> --add-entry path (capture stays triage-gated, so it can't auto-bloat the
  registry — but DRAIN the backlog via --analyze before relying on it). DEPENDS on the orchestrator
  using the "(Recommended)" label convention + routing genuine recommendation-forks through
  AskUserQuestion. Mechanism modelled on wshobson/agents.
v0.5 (2026-05-25): added --add-entry CLI primitive that appends a standard-format entry
  to .claude/meta-corrections-registry.md from flags. Used by /wrap Step 7f auto-invocation
  to land owner-approved entries without manual markdown editing.
  Also added --current flag (resolves to the current session via
  CLAUDE_CODE_SESSION_ID, falling back to most-recently-modified jsonl only when
  that env var is absent; mtime alone mis-picks a hot peer under
  parallel sessions). Used by /wrap Step 7f to scan the active session.
v0.4 (2026-05-24): added --analyze subcommand that parses .claude/meta-corrections-registry.md
  and outputs pattern-frequency distribution + codification rate + activity-over-time.
  Use after batch-triage closes to surface cross-pattern themes.
v0.3 (2026-05-24): added --dig <sess-prefix>:<idx> subcommand for ambiguous-event triage —
  applies the same ARGUMENTS: split as scan path + dumps adjacent assistant context.
  Use whenever an event's scan-output excerpt is ambiguous (quote-and-react patterns,
  short prompts that need surrounding context). Pre-empts FP misclassification caused by
  using ad-hoc bash extracts that skip the ARGUMENTS: split.
v0.2 (2026-05-24): regex expanded with 16 new patterns across 6 categories
  (override directives / I-think assertions / verification demands / substantive critique /
  frustration markers / re-question); excerpt cap bumped 250 → 400 chars.
v0.1 (2026-05-24): initial — captured "are you sure / why not / but / isn't / actually" etc.

Surfaces moments where owner pushed back on orchestrator's proposal AND the response
shifted scope/framing. Useful for finding patterns in orchestrator blindspots that owner
has the position to see.

Usage:
  python3 scripts/meta-corrections-scan.py                  # scan all sessions, last 30 days
  python3 scripts/meta-corrections-scan.py --session <id>   # scan specific session
  python3 scripts/meta-corrections-scan.py --days 7         # scan last 7 days
  python3 scripts/meta-corrections-scan.py --all            # scan ALL sessions
  python3 scripts/meta-corrections-scan.py --verbose        # 600-char excerpt per event
  python3 scripts/meta-corrections-scan.py --dig <session-id>:2078   # show one event + context
  python3 scripts/meta-corrections-scan.py --analyze              # registry frequency analysis (all-time)
  python3 scripts/meta-corrections-scan.py --analyze --since 2026-06-09   # + windowed-vs-all-time comparison block
  python3 scripts/meta-corrections-scan.py --prime --render --window 14   # prime ranked on the last 14d (all-time in [])
  python3 scripts/meta-corrections-scan.py --current              # scan the CURRENT session (CLAUDE_CODE_SESSION_ID; mtime fallback)
  python3 scripts/meta-corrections-scan.py --add-entry --date 2026-05-25 --session <session-id> \\
      --topic "..." --proposal "..." --pushback "..." --correction "..." \\
      --new-ground "..." --pattern under-justification --codified "no"   # append entry

Output: per-session table of candidate owner-pushback events with signal tags.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

# Claude Code keys a project by its directory path with every non-alphanumeric character as "-".
PROJECT_KEY = re.sub(r"[^a-zA-Z0-9]", "-", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SESSIONS_DIR = os.path.expanduser('~/.claude/projects/' + PROJECT_KEY)

PUSHBACK_REGEX = re.compile(
    # v0.1 patterns ===
    r"\b("
    r"isn'?t|why not|but |you said|actually|wait\b|are you sure|are we sure|"
    # v0.9 (2026-09-02): two idioms from a MISSED strongest-correction-of-the-window —
    # a correction pointing out that the assistant tends to disregard the actual question
    # carried NO matching term while its softer neighbors matched; same term-coverage class as the v0.8 pair.
    r"my point is|you tend to|"
    # v0.8 IDIOM ADDITIONS. ⛔ CORRECTED at v0.8.1 after a review measured the original
    # rationale FALSE. It claimed every pre-v0.8 signal was question- or hedge-shaped and that the
    # instrument was therefore blind to a whole CATEGORY (flat declarative refutation). A reviewer
    # ran 13 flat declaratives against the PRE-v0.8 regex: 13/13 ALREADY MATCHED. There was no
    # missing category — the real gap was two IDIOMS, and mis-diagnosing it as a category is what
    # licensed a bare `degraded` token that measured 0 true positives all-time against 1 FP
    # (18 of its 19 corpus occurrences were harness boilerplate, compaction summaries and prose
    # ABOUT the incident — silent only because they exceed the 1500-char gate the self-test's own
    # NEG-CONTROL comment calls fragile). That token is removed; keep the specific multi-word
    # idioms, which are narrow enough to carry low FP risk.
    # ⛔ AND THE RECALL-OVER-PRECISION ARGUMENT THAT JUSTIFIED WIDENING IS REFUTED BY THE SAME
    # COMMIT THAT MADE IT. It claimed a miss here is PERMANENT because this scan is the only path
    # into the registry, so recall should win. `--add-entry` has existed since v0.5, and that very
    # commit used it to hand-add all four missed events. A miss is RECOVERABLE and was recovered,
    # so the asymmetry does not invert and the ordinary warn-only, precision-first default applies
    # (the defer-trigger-scan caution in tests-unit.md stands unamended).
    # ⚠️ STILL OPEN: these alternatives shipped with ZERO self-test arms — cmd_self_test came
    # back byte-identical, PASS 10 -> 10, the invariant-pass-count tell, in a file whose own
    # docstring mandates a self-test run after any regex edit. Not closed here.
    r"completely wrong|totally wrong|this is wrong|that'?s (?:just )?wrong|"
    r"how is (?:this|it|that) (?:a thing|possible|happening)|how is it possible|"
    r"when was (?:this|that|it) (?:established|decided|agreed|codified)|"
    r"why has (?:this|it|that)|"   # `why have` dropped: 0 matches anywhere
    r"shouldn'?t|why don'?t|what about|why is|fair |maybe a good place|"
    r"extend the audit|main reason|the only|just a bit|add just|"
    r"push(?:ed)? the solution|covered new ground|despite your|what if|"
    r"hold on|hmm|i'm not sure|i disagree|that doesn'?t|wait wait|"
    r"actually i think|isn'?t the risk|are these|too narrow|too small|"
    # v0.2 Cat A — override directives:
    r"let'?s do .{0,40}\bnow\b|let'?s .{0,40}\binstead\b|"
    r"let'?s analyze .{0,40}\bnow\b|let'?s address|"
    # v0.2 Cat B — I-think assertions:
    r"i think we (?:need|should|ought|could|must|have to)|"
    r"i'?d rather|i'?d prefer|i'?d lean|i lean (?:toward|to)|"
    # v0.2 Cat C — verification demands:
    r"double[- ]?check|did you (?:check|verify|look|read)|"
    r"can you (?:confirm|verify|check)|"
    # v0.2 Cat D — substantive critique:
    r"you (?:missed|forgot|overlooked)|you'?re missing|"
    r"the real (?:issue|problem|cause)|the root cause|the actual (?:issue|problem)|"
    # v0.2 Cat E — frustration markers (sniff-test):
    r"ffs\b|going in circles|fix it properly|you keep saying|"
    r"this seems wrong|that'?s wrong|that'?s not right|no no\b|"
    # v0.2 Cat F — re-question / tell-me-more:
    r"why did you|what makes you think|how does that|where does that come from|"
    r"tell me more|elaborate|"
    # v0.7 Cat G — direct-challenge + quote-and-react reaction phrasings:
    r"dispute me|can you dispute|how (?:can|could|do) you (?:dispute|defend|justify)|"      # (a)
    r"it seems (?:to me )?(?:like |that )?you(?:'?re| are)|"                                # (a)
    r"over-?(?:justif|defen|enginee)\w*|"                                                   # (a)
    r"you did ?n'?t (?:find|catch|see|notice|flag|spot|get)|"                               # (c)
    r"you did not (?:find|catch|see|notice|flag|spot|get)|did you not (?:find|catch|see|notice)|"  # (c)
    r"keeps? happening|again and again|over and over|"                                      # (b)
    # v0.9 Cat H — THE LEGIBILITY ASK. Measured 2026-08-12: 6 instances across 5 sessions in
    # 6 days where the owner had to ask what an owner-facing sentence MEANT, and this regex
    # matched ZERO of them (`what does this mean` -> 0, `can you explain` -> 0, `plainly` -> 0;
    # only `tell me more` -> 1, which is why the 2026-05-21 ancestor got captured and the two
    # 2026-08-12 ones had to be hand-added). So every population count for this class has been
    # a FLOOR produced by a blind instrument — which is exactly why, for this class, a direct
    # observation that it had happened many times outranks the registry count.
    # WHY THIS IS SAFE WHERE THE REMOVED `degraded` TOKEN WAS NOT: that token was one common
    # word, and 18 of its 19 corpus occurrences were prose ABOUT an incident. This is a 4-word
    # INTERROGATIVE idiom, and the word order is the FP guard — mention-form reads "asked what
    # this meant" / "what this means", neither of which contains "what does". Pinned by a
    # negative-control arm in cmd_self_test, because that property is the whole safety case.
    # HONEST RECALL: 5 of the 6 measured instances. The miss is a misspelled form of the same
    # question — a typo, and a pattern stretched to catch it would be fitted to one keystroke.
    r"what does (?:this|that|it|[\"'][^\"']{1,24}[\"']) (?:actually |even |really )?mean"    # (h)
    r")\b",
    re.I
)

# The Cat H idiom on its own, so the 20-char length floor in pushback_signals() can exempt it.
# Kept as a SEPARATE compile rather than reusing PUSHBACK_REGEX because the exemption must be
# narrow: only this idiom escapes the floor, never the whole pushback vocabulary (a short "but "
# or "hmm" genuinely IS noise, which is what the floor is for).
LEGIBILITY_ASK_REGEX = re.compile(
    r"\bwhat does (?:this|that|it|[\"'][^\"']{1,24}[\"']) (?:actually |even |really )?mean",
    re.I,
)

# Header markers that flag a skill-spec / doc paste rather than owner pushback (FP guard).
HEADER_MARKERS = [
    'base directory for this skill',
    '# the rule',
    '# how to use',
    'tracks every structural change',
    'use this tool',
]

# Owner quote-and-react idiom: '"<pasted quote of my prior output>" - <their short reaction>'.
# The pushback lives in the trailing reaction, which can sit past the 800-char scan window or
# past the 1500-char length gate (when the quoted block is a giant slash-command arg — see the
# v0.7 (b) case, an 18,925-char /meta arg). Delimiter = closing double-quote then a
# dash then whitespace (the owner's consistent separator); '\s+' after the dash avoids matching
# hyphens inside quoted strings like "well-known".
QUOTE_REACT = re.compile(r'"\s*[-–—]\s+')

def reaction_tail(text):
    """Return the trailing reaction after the LAST quote-and-react delimiter, or None.
    Capped at 400 chars so we capture a short reaction, not another quoted block. None when
    the message isn't a quote-and-react (no '" -' delimiter present)."""
    if '"' not in text:
        return None
    parts = QUOTE_REACT.split(text)
    if len(parts) < 2:
        return None
    tail = parts[-1].strip()
    return tail if 0 < len(tail) <= 400 else None

def pushback_signals(text):
    """Core per-message detection shared by scan_session() and --self-test. Returns up to 5
    sorted unique pushback signal strings ([] if none). Encapsulates length-gating, header
    FP-skip, quote-and-react reaction-tail extraction, and the PUSHBACK_REGEX scan so the
    detection logic has exactly ONE home (the v0.7 regression-guard surface)."""
    if not text:
        return []
    # ⛔ THE 20-CHAR FLOOR BELOW SILENTLY CANCELS THE HIGHEST-SIGNAL MESSAGE IN THIS CORPUS.
    # `"what does this mean?"` is EXACTLY 20 characters, so `<= 20` dropped the PUREST instance
    # of the legibility class — the bare ask, with no other words to push it over the floor.
    # Measured 2026-08-12: the bare 20-character ask fell under the floor while the same phrase
    # plus a follow-on demand cleared it. Adding Cat H to PUSHBACK_REGEX alone would have left the
    # headline case invisible and looked like it worked.
    # This is STRUCTURALLY the same defect as sniff-test's codified carve-out ("the sub-200-word
    # skip does NOT cancel trigger 9", added 2026-07-26 after the skip's own examples turned out
    # to BE the new trigger's tokens): a LENGTH skip cancelling a SPECIFIC detector on its own
    # headline case, in a different file.
    # The floor exists to drop "ok" / "yes" / "sure". A complete interrogative idiom is not that:
    # it carries its full meaning at 20 characters, so the floor does not apply to it.
    if len(text) <= 20 and not LEGIBILITY_ASK_REGEX.search(text):
        return []
    react = reaction_tail(text)
    if len(text) >= 1500:
        # Over-length (slash-command args / pasted docs): only the quote-and-react reaction
        # is a candidate. A giant block with no reaction tail is a doc paste — skip it.
        if not react:
            return []
        window = react
    else:
        if any(marker in text[:120].lower() for marker in HEADER_MARKERS):
            return []
        window = text[:800]
        if react and react not in window:
            window = window + "\n" + react  # reaction trailed past the 800-char head window
    matches = PUSHBACK_REGEX.findall(window)
    return sorted(set(m.strip().lower() for m in matches))[:5]

def extract_user_text(msg):
    """Extract user-typed content from a user message, handling slash-command wrapping."""
    content = msg.get('content') if isinstance(msg, dict) else None
    text = ''
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                text += c.get('text', '') + ' '
    if not text:
        return None
    # Slash-command wrapping: actual user text appears after "ARGUMENTS:"
    if 'ARGUMENTS:' in text:
        text = text.split('ARGUMENTS:', 1)[1].strip()
    # Skip system content
    if text.startswith('<') or text.startswith('['):
        return None
    if 'system-reminder' in text[:200] or 'command-name' in text[:200]:
        return None
    return text.strip()

def scan_session(jsonl_path, verbose=False, include_queued=False):
    """Scan one session jsonl for pushback events. Returns list of events.

    QUEUED-SHAPE INTAKE (include_queued, default OFF). An owner keystroke sent WHILE the
    orchestrator is working lands as a `queue-operation` record with the text at `.content`
    and NO `type=="user"` wrapper, so the gate below drops it. That miss is PERMANENT, not
    delayed -- this registry is the sole feeder for /meta learn promotion and --analyze, so
    an unseen event never becomes a lesson. The bias is severity-shaped: queued messages are
    interruptions, i.e. the urgent ones.

    THE CHANNEL HAS NO AUTHOR DISCRIMINATOR -- `.content` also carries task-notifications and
    assistant prose (measured on one transcript: 236 queue-operation records, 190 with string
    .content, task-notification payloads among them). So this is a CONJUNCTION, never a
    widening: a queued record is admitted ONLY when its text independently trips
    PUSHBACK_REGEX. The signal itself is the discriminator -- a task-notification does not flatly
    declare the work wrong. Admitted events are tagged shape='queued' so triage can weigh
    them against the ~20-30% baseline FP rate separately rather than blending the two."""
    events = []
    if not os.path.exists(jsonl_path):
        return events
    with open(jsonl_path) as f:
        for idx, line in enumerate(f):
            try:
                d = json.loads(line)
            except Exception:
                continue
            rtype = d.get('type')
            if rtype == 'user':
                shape = 'user'
                text = extract_user_text(d.get('message', {}))
            elif include_queued and rtype == 'queue-operation':
                # MEASURED, not reasoned (2026-08-12, this session's own transcript):
                #   operation values = enqueue 119 / dequeue 46 / remove 72 -> the SAME owner
                #   message recurs under multiple operations, so an un-keyed admit DOUBLES every
                #   event. Key on 'enqueue' (the arrival) and the duplicates vanish.
                #   .content prefixes = <task-notification> x156 -> harness payloads ride this
                #   exact channel, and they DO trip weak PUSHBACK_REGEX signals ('the only'),
                #   so the pushback conjunction alone is NOT a sufficient author discriminator.
                # Both filters are mechanical and lossless for owner speech: an owner keystroke
                # is an 'enqueue' and does not begin with a harness tag.
                if d.get('operation') != 'enqueue':
                    continue
                shape = 'queued'
                text = d.get('content')
                if not isinstance(text, str):
                    continue
                if text.lstrip().startswith('<'):
                    continue
            else:
                continue
            signals = pushback_signals(text)
            if signals:
                excerpt = text[:600] if verbose else text[:400]
                # For over-length quote-and-react msgs the head is the pasted quote, not the
                # pushback — show the recovered reaction so the excerpt is intelligible.
                if len(text) >= 1500:
                    rt = reaction_tail(text)
                    if rt:
                        excerpt = f"[reaction-tail of {len(text)}-char msg] {rt}"
                events.append({
                    'idx': idx,
                    'signals': signals,
                    'text': excerpt,
                    'shape': shape,
                })
    return events

# Soft-override detection (v0.6) — the capture-gap fix. A "soft override" is the owner
# selecting an AskUserQuestion option OTHER than the one the orchestrator marked recommended.
# It carries NO pushback string, so PUSHBACK_REGEX is blind to it. We compare the selected
# option against the recommendation-marked option per the "(Recommended)" label convention.
REC_MARKER = re.compile(r"\(recommended\)|recommend|\brec\b|rec for", re.I)

def scan_overrides(jsonl_path):
    """Return soft-override events: owner chose a non-recommended AskUserQuestion option.
    Each: {idx, question, recommended, selected}. Only fires when an option carries a
    recommendation marker AND a DIFFERENT option was selected (neutral questions with no
    marked recommendation produce no signal — there's nothing to override)."""
    events = []
    if not os.path.exists(jsonl_path):
        return events
    with open(jsonl_path) as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        try:
            d = json.loads(line)
        except Exception:
            continue
        m = d.get('message', {})
        c = m.get('content') if isinstance(m, dict) else None
        if not isinstance(c, list):
            continue
        for blk in c:
            if not (isinstance(blk, dict) and blk.get('type') == 'tool_use'
                    and blk.get('name') == 'AskUserQuestion'):
                continue
            tuid = blk.get('id')
            questions = blk.get('input', {}).get('questions', [])
            # The selection comes back in a tool_result as ="<selected label>"
            result_text = None
            for j in range(i, min(i + 6, len(lines))):
                try:
                    d2 = json.loads(lines[j])
                except Exception:
                    continue
                m2 = d2.get('message', {})
                c2 = m2.get('content') if isinstance(m2, dict) else None
                if isinstance(c2, list):
                    for b2 in c2:
                        if (isinstance(b2, dict) and b2.get('type') == 'tool_result'
                                and b2.get('tool_use_id') == tuid):
                            rc = b2.get('content', '')
                            result_text = rc if isinstance(rc, str) else json.dumps(rc)
                if result_text:
                    break
            if not result_text:
                continue
            for q in questions:
                labels = [o.get('label', '') for o in q.get('options', [])]
                rec = next((l for l in labels if REC_MARKER.search(l)), None)
                if not rec:
                    continue  # neutral question — no recommendation to override
                selected = next((l for l in labels if f'="{l}"' in result_text), None)
                if selected and selected != rec:
                    events.append({
                        'idx': i,
                        'question': q.get('question', '')[:80],
                        'recommended': rec,
                        'selected': selected,
                    })
    return events

def list_sessions(days_window=None, all_sessions=False, specific_session=None, current_only=False):
    """List session jsonl paths to scan."""
    pattern = os.path.join(SESSIONS_DIR, '*.jsonl')
    paths = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    if current_only:
        # Prefer the deterministic CLAUDE_CODE_SESSION_ID (set by Claude Code)
        # over the racy most-recently-modified heuristic: under parallel
        # sessions a hot peer's jsonl is newer at call-instant, so mtime
        # mis-identifies the current session (observed once: /wrap Step 7f scanned a
        # peer's session instead of the current one). Mirrors
        # session-manifest.py own_session_path(). Fall back to mtime only in
        # headless/cron contexts where the env var is absent.
        env_sid = os.environ.get('CLAUDE_CODE_SESSION_ID', '')
        if env_sid:
            # env set: MY jsonl, or [] if it's not on disk yet — NEVER fall through to a
            # PEER (the SessionStart most-recent-jsonl misroute). Mirrors
            # session-manifest.py own_session_path()'s Option-B no-fall-through.
            return [p for p in paths if os.path.basename(p).startswith(env_sid)][:1]
        return paths[:1]  # env absent (headless/cron): mtime fallback
    if specific_session:
        match = [p for p in paths if specific_session in os.path.basename(p)]
        return match[:1]
    if all_sessions:
        return paths
    if days_window:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_window)
        return [p for p in paths
                if datetime.fromtimestamp(os.path.getmtime(p), timezone.utc) >= cutoff]
    return paths[:10]  # default: 10 most recent

def cmd_dig(target):
    """Resolve a single event with proper ARGUMENTS: split + adjacent assistant context.
    Format: <session-prefix>:<idx> (e.g., '<session-id>:2078')."""
    if ':' not in target:
        print(f"Invalid --dig target: {target!r}. Format: <session-prefix>:<idx>", file=sys.stderr)
        sys.exit(2)
    sess_prefix, idx_str = target.rsplit(':', 1)
    try:
        idx = int(idx_str)
    except ValueError:
        print(f"Invalid idx: {idx_str!r}. Must be integer.", file=sys.stderr)
        sys.exit(2)

    pattern = os.path.join(SESSIONS_DIR, f'{sess_prefix}*.jsonl')
    matches = sorted(glob.glob(pattern))
    if not matches:
        print(f"No session jsonl matching prefix {sess_prefix!r}", file=sys.stderr)
        sys.exit(1)

    fpath = matches[0]
    with open(fpath) as f:
        lines = f.readlines()
    if idx >= len(lines):
        print(f"idx {idx} out of range (file has {len(lines)} lines)", file=sys.stderr)
        sys.exit(1)

    mtime = datetime.fromtimestamp(os.path.getmtime(fpath)).strftime('%Y-%m-%d %H:%M')
    print(f"=== {sess_prefix} ({mtime}) idx={idx} ===\n")

    # Last assistant message before idx
    for i in range(idx - 1, max(-1, idx - 20), -1):
        try:
            d = json.loads(lines[i])
            if d.get('type') == 'assistant':
                msg = d.get('message', {})
                content = msg.get('content', '')
                if isinstance(content, list):
                    text = ''.join(
                        c.get('text', '') if isinstance(c, dict) else ''
                        for c in content
                        if isinstance(c, dict) and c.get('type') == 'text'
                    )
                else:
                    text = str(content)
                if text:
                    print(f"[PRIOR ASSISTANT idx={i}, len={len(text)}]")
                    tail = text[-1000:] if len(text) > 1000 else text
                    print(f"TAIL: {tail}\n")
                    break
        except Exception:
            pass
    else:
        print("[no prior assistant message found in window]\n")

    # Target message — DISPATCH ON THE RECORD SHAPE, exactly as scan_session does.
    #
    # ⛔ THIS BLOCK ASSUMED type=='user' AND `.message.content` FOR EVERY CANDIDATE, WHICH MADE
    # --dig STRUCTURALLY BLIND TO THE ONE SHAPE scan_session GOES OUT OF ITS WAY TO ADMIT.
    # A queued owner keystroke is a `queue-operation` record carrying its text at `.content`
    # with NO `message` key at all, so the old code read `d.get('message', {})` -> {} ->
    # extract_user_text({}) -> None, and printed "(extract_user_text returned None — likely
    # system/tag/empty after filtering)". That parenthetical is a WRONG DIAGNOSIS, not a
    # description: the text is present and intact one key over. The reader is told the record
    # is junk, so the documented ambiguity-resolution path is unavailable for exactly the
    # events the scan tags shape='queued' — and those are interruptions, i.e. the urgent ones
    # (scan_session's own docstring says the bias is severity-shaped).
    # Measured 2026-09-08 on one session: of the first three live candidates, idx=352 and
    # idx=1779 are queue-operation and BOTH returned None; idx=1983 is type=='user' and
    # resolved fine. So the failure tracks the SHAPE, never the index, and the 'attachment'
    # mechanism the defect was first filed under was a hypothesis read off the warning text.
    try:
        d = json.loads(lines[idx])
        t = d.get('type', '?')
        shape = None
        if t == 'user':
            shape = 'user'
            user_text = extract_user_text(d.get('message', {}))
        elif t == 'queue-operation':
            # Mirror scan_session's intake: 'enqueue' is the arrival (dequeue/remove re-carry
            # the SAME text and would double every event), and a leading '<' is a harness tag.
            op = d.get('operation')
            raw_q = d.get('content')
            shape = 'queued'
            if op != 'enqueue':
                # ⛔ THE EXTRACTION IS GATED ON THIS, NOT MERELY ANNOUNCED BY IT.
                # The first version printed this NOTE and then FELL THROUGH to the
                # resolved-text path, so a `dequeue` record was told it is not a candidate and
                # displayed as one in the same breath — in the path this fix added to repair a
                # trust problem. **A loop's `continue` has no straight-line equivalent: copying
                # the CONDITION into linear code copies the test and drops the effect.**
                # `scan_session` uses `continue` here; the mirror has to route to the no-text
                # branch instead, which is what `user_text = None` does.
                print(f"[NOTE: idx={idx} is a queue-operation with operation={op!r}, not 'enqueue' — "
                      f"scan_session admits only 'enqueue' (the arrival), so this is NOT a candidate "
                      f"record and its text is deliberately not resolved below]")
                user_text = None
            else:
                user_text = raw_q if isinstance(raw_q, str) and not raw_q.lstrip().startswith('<') else None
        else:
            print(f"[WARNING: idx={idx} type={t} — neither 'user' nor 'queue-operation', so no "
                  f"scan_session intake path produces a candidate at this index]")
            user_text = extract_user_text(d.get('message', {}))
        msg = d.get('message', {})
        _lbl = ("QUEUED RECORD — EXCLUDED, not a candidate" if shape == 'queued' and user_text is None and t == 'queue-operation' and d.get('operation') != 'enqueue'
                else "QUEUED OWNER MESSAGE" if shape == 'queued' else "USER MESSAGE")
        print(f"[{_lbl} idx={idx}, shape={shape or t}]")
        if user_text:
            print(f"USER TEXT (post-ARGUMENTS: split, len={len(user_text)}):")
            print(user_text[:2000])
        else:
            print("(no text recovered at this index — see the shape note above; for a 'user' record "
                  "this means system/tag/empty after filtering, for a queued record it means the "
                  "content was absent or harness-tagged)")
            content = d.get('content') if isinstance(d.get('content'), str) else msg.get('content', '')
            if isinstance(content, list):
                raw = ''.join(c.get('text', '') if isinstance(c, dict) else '' for c in content)
            else:
                raw = str(content)
            print(f"\nRAW (debug, len={len(raw)}):")
            print(raw[:800])
    except Exception as e:
        print(f"ERROR reading idx={idx}: {e}")

# ANCHOR TO THE SCRIPT, NOT THE CWD.
# This was a bare relative path while both siblings (session-manifest.py:61, session-lifecycle.py:40)
# were already `__file__`-anchored. Anchoring the INVOCATION does not anchor the CALLEE: with
# session-start.sh:102 correctly resolving "$DIR/scripts/meta-corrections-scan.py", the registry read
# still resolved against whatever cwd the Bash tool happened to hold. Measured from `.claude/hooks`:
# 3 lines -> 0 lines WITH `CLAUDE_PROJECT_DIR` set. It fails by SILENT early-return, so the symptom is
# an empty recurring-blindspot prime — the very instrument that warns about wrong instruments.
_REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_REGISTRY = os.path.join(_REPO_DIR, '.claude', 'meta-corrections-registry.md')
_UNTIL = None  # --until: closed upper bound for a pre-registered read (set in main)

def _parse_entries(registry_path):
    """Shared registry parser. Returns list of {date, session, topic, pattern_tags, codified, position}.
    Used by cmd_analyze (full frequency report) AND cmd_prime (session-start surface)."""
    entries = []
    current = None
    header_re = re.compile(r'^## (\d{4}-\d{2}-\d{2}) (\w+) — (.+)$')

    with open(registry_path) as f:
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('## '):
                if current and current.get('topic'):
                    entries.append(current)
                m = header_re.match(line)
                current = {
                    'date': m.group(1),
                    'session': m.group(2),
                    'topic': m.group(3),
                    'pattern_tags': [],
                    'pattern_tags_full': [],
                    'codified': '',
                    'position': '',
                    'evidence': '',
                } if m else {'topic': None}
            elif current and current.get('topic'):
                if line.startswith('**Pattern tag:**'):
                    tags = re.findall(r'`([^`]+)`', line)
                    full = [t for t in tags if not t.startswith('<')]
                    # `family:sub` sub-tags (taxonomy split 2026-07-02): every consumer
                    # counts by FAMILY (pattern_tags is prefix-normalized) so a split
                    # never fragments the prime/analyze/gate counts; the full sub-tagged
                    # strings live in pattern_tags_full (--analyze breakdown only).
                    current['pattern_tags_full'] = full
                    current['pattern_tags'] = [t.split(':', 1)[0] for t in full]
                elif line.startswith('**Codified as L#?**'):
                    after = line.split('**Codified as L#?**', 1)[1].strip()
                    current['codified'] = after[:120]
                elif line.startswith('**Session-position:**'):
                    current['position'] = line.split('**Session-position:**', 1)[1].strip()[:40]
                elif line.startswith('**Evidence at claim time:**'):
                    # What the erroneous claim RESTED ON when
                    # made — the EVIDENCE_VOCAB set (choices=-enforced on the write path;
                    # hand-filed off-vocabulary values still parse here, surfaced by the
                    # --analyze distribution rather than dropped). Forward-only capture;
                    # makes the recall-vs-derived split measurable per entry.
                    current['evidence'] = parse_evidence_field(line)
    if current and current.get('topic'):
        entries.append(current)
    return [e for e in entries if not _UNTIL or e['date'] <= _UNTIL]


# Counter-action map for `--prime --render` — SINGLE SOURCE shared by the
# SessionStart hook (.claude/hooks/session-start.sh) AND /orient Step 9. Edit
# HERE, not in orient SKILL.md (which now emits this script's render verbatim).
# Keys = pattern-tags from the registry taxonomy.
PRIME_COUNTER_ACTIONS = {
    'under-justification': 'verify the claim THIS turn before asserting it — one clean exhaustive command, not recall',
    'minimum-viable-scope': 'default SHIP full scope; a deferral needs a concrete trigger, not "cheaper"/"later"',
    'over-narrowing': 'split-lens the scope (engineering AND UX); do not narrow on one lens',
    'over-scope': 'Rule of Three — build the concrete version now; generalize only at the 3rd REAL instance, and name the flexibility it buys TODAY',
    'cost-rationalization': 'do not justify scope by tokens/time; correctness is the rationale',
    'sycophancy-flip': 'do not flip a verdict under pushback without NEW evidence',
    'option-splitting': 'do not manufacture 2+ options for a one-right-answer question — pick + execute',
    'oscillation-between-extremes': 'hold the grounded middle with evidence; do not swing between extremes',
    'tracking-system-discipline': 'declare the tracker-home at item creation',
    'system-gap-identification': 'surface the gap explicitly + declare its tracker-home',
    'parallel-session-coordination': 'git status + log before editing shared trackers; stage explicit paths',
    'parallelization-blindspot': 'ask "can this fan out?" before serial execution',
    'use-case-expansion': 'consider the broader use-case before narrowing the design',
    'agent-quality-feedback': 'verify agent output against source before trusting it',
    'preference-violation': 're-scan the project MEMORY.md Trigger Index before composing — the preference was already loaded; this is an application gap',
}


# Decision-moment gates shipped for specific blindspot tags. Maps tag ->
# (ship_date 'YYYY-MM-DD', gate label). The gate-effectiveness block in
# cmd_analyze measures whether the tag's registry SHARE falls AFTER its gate
# ships — the effectiveness loop the sniff-test FAIL log never populated
# (2026-06-20). It reads owner-pushback ground truth (this registry) instead of
# self-reported catches. EXTEND this when a new sniff-test check / Hot-Tier
# decision-moment gate ships for a tag (e.g. over-narrowing crossing 10%).
GATE_SHIP_DATES = {
    # Re-keyed: Check 14
    # targets the COST-FRAMING justification shape, which lives in the
    # `cost-rationalization` family — the under-justification corpus is
    # ~all VERIFY-shaped (0/15 sampled entries cost-framing), so the prior
    # 'under-justification' keying diluted the gate ~14:1 and laundered the
    # verify-family's decline into a false "Check-14 fires" ✅.
    # under-justification's honest gate anchor = the verify-before-assert
    # Hot-Tier row (2026-06-08) — an ENSEMBLE PROXY (sibling rows
    # shipped on other dates), so read its Δ as the verify-layer read, not one
    # gate's.
    'cost-rationalization': ('2026-06-20', 'sniff-test Check 14'),
    'under-justification': ('2026-06-08', 'Hot-Tier row (verify-ensemble proxy)'),
    # preference-violation had NO gate until 2026-07-26 (`/meta` full review): it was the
    # FASTEST-RISING tag (+0.37-0.39/session — top mover in BOTH control readings) precisely
    # because every sub-mode already had an always-loaded row and none reached the decision
    # moment (possession != application). Gate = sniff-test trigger 9 + Check 15.
    # ⚠️ CORRECTED 2026-07-26 (a review's fold-verify residual — this comment SURVIVED the
    # first two withdrawals because I swept SKILL.md and missed a further surface,
    # in the very file I was editing; sweep-ALL-surfaces). It used to read "modeled on the
    # Check-14 shape that measurably dropped under-justification 1.19->0.64/session" — FALSE,
    # and falsified by THIS dict two lines up: the 1.19->0.64 drop is keyed to the Hot-Tier
    # row (a PASSIVE row), while Check 14 gates `cost-rationalization`, which reads VERDICT
    # WITHHELD. The header comment above already warns about exactly this mis-keying; the claim
    # was written anyway. The sniff-test layer is UNPROVEN — Check 15 is a MEASURED EXPERIMENT,
    # not a replication of a proven shape. Judge it on the rate Δ at quorum, nothing else.
    # NOTE the gate is DRAFT-shaped, so it covers the prose sub-modes only
    # (peer-state-attribution / verify-before-assert / execute-authority-boundary /
    # code-review-gate / agent-workflow-routing ~ 27 of 63). `mail-listen-arm` (7) is an
    # ACTION omission a pre-emission check structurally cannot see — its PreToolUse
    # escalation is tracked separately. Read the Δ with that in mind:
    # a partial-coverage gate cannot zero the tag, so judge it on the covered sub-modes.
    # ⚠️ ATTRIBUTION CAVEAT for whoever reads this Δ: a
    # Check-15-ALONE fire (short draft, trigger-9 surface only) and a FULL-rubric fire are
    # INDISTINGUISHABLE in the registry — nothing records which path ran. So this Δ cannot
    # separate them: do NOT attribute a movement here to "the 15-check rubric" as a whole,
    # and do NOT read a null here as evidence against the other 14 checks. It measures the
    # trigger-9/Check-15 pair only.
    'preference-violation': ('2026-07-26', 'sniff-test trigger 9 + Check 15'),
    'minimum-viable-scope': ('2026-06-19', 'sniff-test trigger 8b'),
}
# Quorum the post-ship sample must clear before the Δ verdict is trustworthy.
# AND-gated: tag-EVENTS (the numerator IS the signal — gating on TOTAL entries was
# the bug that let the MVS "+22pp not firing" verdict render off 13 events),
# distinct SESSIONS (defeats the single-session-storm), and DAYS post-ship
# (defeats work-surface clustering — a 3-day window catches one audit cluster).
# Per-session RATE (tag-events / all-sessions-in-window) is the PRIMARY Δ: it is
# composition-COUPLING-immune (when one gate suppresses its own events every other
# tag's SHARE rises mechanically, but its per-session RATE does not move unless
# behavior changed). Residual confound the quorum mitigates (not removes): an
# audit-dense window has more defer-decisions/session than the all-history
# baseline — hence days≥N forces work-variety before a read.
GATE_MIN_TAG_EVENTS = 15   # post-ship entries carrying the measured tag (numerator)
GATE_MIN_SESSIONS = 8      # distinct sessions in the after-window
GATE_MIN_DAYS = 10         # days from ship to the latest registry entry
GATE_SHARE_BAND = 8.0      # pp; |share Δ| below this = "no clear move"
GATE_RATE_FLAT = 0.15      # events/session; |rate Δ| below this = rate didn't move

# Deferred decisions whose revisit condition is a COUNT — logged as prose, but
# nothing actively watched it (a passive defer can sit past
# its trigger). --analyze renders the count-based half so it surfaces the moment
# it crosses. Each: (primary tag, since 'YYYY-MM-DD', threshold, what it gates).
# Any QUALITATIVE half (a judgment call) stays named in `what`. EXTEND when a
# count-revisit defer lands; DELETE the row once the defer is resolved.
# (2026-06-21 — the umbrella-split deferral.)
# The umbrella-split row ('minimum-viable-scope', since 2026-06-21, threshold 20) was deleted: the split
# it gated landed on 2026-07-12 — the registry header's `minimum-viable-scope:*` sub-tag row records it —
# so the trigger had read "COUNT-TRIGGER MET (160/20) — revisit the defer" at every --analyze for a defer
# already resolved.
DEFERRED_TRIGGERS = []


def _resolve_since(args):
    """Resolve the windowed-view lower bound from --since / --window into an ISO
    'YYYY-MM-DD' string (or None = all-time). The two flags are argparse-mutually-
    exclusive. --window N anchors on TODAY (a 'last N days' view), so its output
    shifts daily by design. Bad --since exits 2."""
    if getattr(args, 'since', None):
        try:
            datetime.fromisoformat(args.since)
        except ValueError:
            print(f"--since must be YYYY-MM-DD (got {args.since!r})", file=sys.stderr)
            sys.exit(2)
        return args.since
    if getattr(args, 'window', None) is not None:
        if args.window <= 0:
            print(f"--window must be a positive integer (got {args.window})", file=sys.stderr)
            sys.exit(2)
        return (datetime.now() - timedelta(days=args.window)).strftime('%Y-%m-%d')
    return None


def _print_window_comparison(all_entries, since):
    """Windowed-vs-all-time pattern comparison — answers 'is a primed blindspot
    actually receding?'. The all-time --analyze share is a LAGGING cumulative
    blend (old events never leave the denominator), so it understates recent
    movement; this block splits pre-window / window / all-time and reports the
    per-session RATE Δ (pre→window), which is composition-COUPLING-immune — the
    honest firing signal, same epistemics as the gate-effectiveness block.
    `since` = ISO 'YYYY-MM-DD'."""
    before = [e for e in all_entries if e['date'] < since]
    win = [e for e in all_entries if e['date'] >= since]
    na, nb, nw = len(all_entries), len(before), len(win)
    sa = len({e['session'] for e in all_entries})
    sb = len({e['session'] for e in before})
    sw = len({e['session'] for e in win})

    def _pc(es):
        c = {}
        for e in es:
            if e['pattern_tags']:
                t = e['pattern_tags'][0]
                c[t] = c.get(t, 0) + 1
        return c

    c_a, c_b, c_w = _pc(all_entries), _pc(before), _pc(win)
    print(f"Windowed comparison — entries on/after {since}:")
    print(f"  window: {nw} entries / {sw} sessions   ·   pre-window: {nb} / {sb}   ·   all-time: {na} / {sa}")
    if nw == 0:
        print(f"  (no entries in window — nothing to compare)\n")
        return
    print(f"  PRIMARY = per-session RATE Δ (pre→window, coupling-immune); SHARE is coupling-sensitive.")
    print(f"  all-time SHARE lags (old events never leave the denominator) — it understates recent movement.")
    if nw < GATE_MIN_TAG_EVENTS:
        print(f"  ⚠️ small window (n={nw} < {GATE_MIN_TAG_EVENTS}) — read the Δ as DIRECTIONAL, not a verdict.")
    print()
    tags = sorted(set(c_a) | set(c_w), key=lambda t: -c_a.get(t, 0))[:12]
    print(f"  {'tag':38s} {'pre-window':>13s} {'window':>13s} {'all-time':>9s} {'Δrate':>9s}")
    for t in tags:
        a, b, w = c_a.get(t, 0), c_b.get(t, 0), c_w.get(t, 0)
        a_sh = 100 * a / na
        w_sh = 100 * w / nw
        b_rate = (b / sb) if sb else 0.0
        w_rate = (w / sw) if sw else 0.0
        d_rate = w_rate - b_rate
        glyph = '↓' if d_rate <= -GATE_RATE_FLAT else ('↑' if d_rate >= GATE_RATE_FLAT else '~')
        pre_cell = f"{100 * b / nb:4.1f}%({b:3d})" if nb else "—"
        win_cell = f"{w_sh:4.1f}%({w:3d})"
        print(f"  {t:38s} {pre_cell:>13s} {win_cell:>13s} {a_sh:7.1f}% {d_rate:+7.2f}{glyph}")
    print()


def cmd_prime(registry_path, top_n=3, min_pct=10.0, render=False, since=None):
    """Compact session-start priming surface for /orient: the top-N recurring
    blindspot patterns (primary tag) at or above min_pct of all events. Stable
    tab-separated output `PCT<TAB>COUNT<TAB>TAG` so /orient consumes it without
    parsing the human-formatted --analyze table. Degrades silently (stderr note,
    no rows) if the registry is absent/empty — /orient skips the block.

    Why this exists: --analyze is a monthly/ad-hoc deep read; --prime is the
    cheap session-START spotlight that loads the dominant blindspot into context
    BEFORE composition (enforce-gap intervention for the under-justification
    family, ~43% of all events as of 2026-06-01)."""
    if not os.path.exists(registry_path):
        print("PRIME_UNAVAILABLE: registry not found", file=sys.stderr)
        return
    all_entries = _parse_entries(registry_path)
    if not all_entries:
        print("PRIME_UNAVAILABLE: no entries parsed", file=sys.stderr)
        return
    # since=None → all-time (the SessionStart hook + /orient default; output stays
    # byte-identical to pre-window behavior). With --since/--window, rank on the
    # window AND annotate each line with the all-time share so the lagging-
    # cumulative gap (window 32% vs all-time 37%) is visible in the prime itself.
    entries = [e for e in all_entries if e['date'] >= since] if since else all_entries
    if since and not entries:
        print(f"PRIME_UNAVAILABLE: no entries in window >= {since}", file=sys.stderr)
        return
    all_total = len(all_entries)
    all_counts = {}
    for e in all_entries:
        if e['pattern_tags']:
            p = e['pattern_tags'][0]
            all_counts[p] = all_counts.get(p, 0) + 1
    counts = {}
    sessions = set()
    for e in entries:
        sessions.add(e['session'])
        if e['pattern_tags']:
            primary = e['pattern_tags'][0]
            counts[primary] = counts.get(primary, 0) + 1
    total = len(entries)
    ranked = []
    for tag, count in sorted(counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / total
        if pct < min_pct or len(ranked) >= top_n:
            break
        ranked.append((tag, pct, count))

    if render:
        # Human-readable, labeled spotlight: #1 in full + a compact secondary
        # line for every OTHER tag >= min_pct. Emitted verbatim by the
        # SessionStart hook + /orient. Labeling pct + count explicitly prevents
        # the PCT-vs-COUNT column transpose that the raw TSV invited (2026-06-09).
        if not ranked:
            print("PRIME_UNAVAILABLE: no pattern above threshold", file=sys.stderr)
            return

        def _action(t):
            return PRIME_COUNTER_ACTIONS.get(t, f'see active-recall.md / registry row for {t}')

        def _alltime(t):
            return f" [all-time {100 * all_counts.get(t, 0) / all_total:.0f}%]" if since else ""

        lead_t, lead_p, lead_c = ranked[0]
        win_note = f" · window ≥{since}, all-time in []" if since else ""
        print(f"⚠️ Recurring-blindspot prime ({total} events / {len(sessions)} sessions{win_note}) — load BEFORE composing:")
        print(f"  #1 {lead_t} — {lead_p:.0f}% ({lead_c} events){_alltime(lead_t)} — {_action(lead_t)}")
        if len(ranked) > 1:
            extras = "; ".join(f"{t} {p:.0f}%{_alltime(t)} — {_action(t)}" for t, p, _ in ranked[1:])
            print(f"  also active ≥{min_pct:.0f}%: {extras}")
        return

    print(f"# corrections-prime: {total} events / {len(sessions)} sessions"
          + (f" (window >= {since})" if since else ""))
    for tag, pct, count in ranked:
        print(f"{pct:.0f}\t{count}\t{tag}")
    if not ranked:
        print("# no pattern above threshold")


def _control_series(before, after, b_sess, a_sess, gated, min_events=15, top_n=3):
    """Untreated-tag per-session Δrate over the same before/after split, top-N by |Δrate|.
    ⚠️ SELF-TEST-ONLY: the live --analyze caller was removed when the share/rate verdict
    machinery was retired (a scoped retire). The :824-825 gated-tag exclusion defect
    is therefore moot on the live path; do not re-wire without first reading why it was retired.
    A treated tag's Δrate is only interpretable against tags with NO gate over the same
    window — per-session rate is immune to share-COUPLING but NOT to work-mix drift /
    observer sensitization / a non-stationary baseline."""
    if not b_sess or not a_sess:
        return []
    tags = {t for e in (before + after) for t in ((e['pattern_tags'] or [])[:1])}
    out = []
    for ct in tags:
        if ct in gated:
            continue
        cb = sum(1 for e in before if e['pattern_tags'] and e['pattern_tags'][0] == ct)
        ca = sum(1 for e in after if e['pattern_tags'] and e['pattern_tags'][0] == ct)
        if cb + ca < min_events:
            continue
        out.append((ct, (ca / a_sess) - (cb / b_sess)))
    out.sort(key=lambda kv: -abs(kv[1]))
    return out[:top_n]


def cmd_analyze(registry_path, since=None):
    """Parse meta-corrections-registry.md and emit frequency analysis. The main
    report is always all-time; with `since` ('YYYY-MM-DD') a windowed-comparison
    block is inserted up top (window vs pre-window vs all-time + per-session rate
    Δ) so a primed blindspot's recent movement is legible against the lagging
    cumulative aggregate. since=None → output is unchanged from pre-window."""
    if not os.path.exists(registry_path):
        print(f"Registry not found: {registry_path}", file=sys.stderr)
        print(f"  (run from repo root or pass --registry-path)", file=sys.stderr)
        sys.exit(1)

    entries = _parse_entries(registry_path)

    if not entries:
        print("No entries parsed. Check registry file format.", file=sys.stderr)
        sys.exit(1)

    pattern_primary_counts = {}
    pattern_any_counts = {}
    codification_split = {'yes': 0, 'no': 0, 'pending': 0, 'other': 0}
    date_counts = {}
    session_counts = {}
    position_counts = {}
    evidence_counts = {}

    for e in entries:
        if e['pattern_tags']:
            primary = e['pattern_tags'][0]
            pattern_primary_counts[primary] = pattern_primary_counts.get(primary, 0) + 1
            for tag in e['pattern_tags']:
                pattern_any_counts[tag] = pattern_any_counts.get(tag, 0) + 1
        cod = e['codified'].lower()
        if cod.startswith('yes'):
            codification_split['yes'] += 1
        elif cod.startswith('no'):
            codification_split['no'] += 1
        elif 'pending' in cod:
            codification_split['pending'] += 1
        else:
            codification_split['other'] += 1
        date_counts[e['date']] = date_counts.get(e['date'], 0) + 1
        session_counts[e['session']] = session_counts.get(e['session'], 0) + 1
        if e.get('position'):
            position_counts[e['position']] = position_counts.get(e['position'], 0) + 1
        if e.get('evidence'):
            evidence_counts[e['evidence']] = evidence_counts.get(e['evidence'], 0) + 1

    total = len(entries)
    print(f"=== Meta-Corrections Registry Analysis ===\n")
    print(f"Registry: {registry_path}")
    print(f"Total entries: {total}")
    print(f"Date range: {min(date_counts)} → {max(date_counts)}")
    print(f"Distinct sessions: {len(session_counts)}\n")

    if since:
        _print_window_comparison(entries, since)

    print("Pattern-tag distribution (primary tag per entry):")
    max_count = max(pattern_primary_counts.values()) if pattern_primary_counts else 1
    for tag, count in sorted(pattern_primary_counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / total
        bar = '#' * max(1, int(count * 28 / max_count))
        print(f"  {count:3d} ({pct:4.1f}%) {tag:42s} {bar}")
    print()

    sub_break = {}
    for e in entries:
        for ft in e.get('pattern_tags_full', []):
            if ':' in ft:
                fam, sub = ft.split(':', 1)
                sub_break.setdefault(fam, {})
                sub_break[fam][sub] = sub_break[fam].get(sub, 0) + 1
    if sub_break:
        print("Sub-tag breakdown (family:sub — primary+secondary occurrences):")
        for fam in sorted(sub_break):
            for sub, c in sorted(sub_break[fam].items(), key=lambda x: -x[1]):
                print(f"  {c:3d} {fam}:{sub}")
        print()

    print("Secondary/co-occurring tags (any-position count):")
    any_only = {t: c for t, c in pattern_any_counts.items() if c > pattern_primary_counts.get(t, 0)}
    if any_only:
        for tag, count in sorted(any_only.items(), key=lambda x: -x[1]):
            primary_share = pattern_primary_counts.get(tag, 0)
            print(f"  {count:3d} total ({primary_share} primary + {count - primary_share} secondary) {tag}")
    else:
        print("  (no secondary tags — all uses are primary)")
    print()

    print("Codification status:")
    for status in ('yes', 'no', 'pending', 'other'):
        c = codification_split[status]
        if c > 0:
            pct = 100 * c / total
            print(f"  {c:3d} ({pct:4.1f}%) {status}")
    print()

    print("Activity over time (entries per date, last 10 dates):")
    for date in sorted(date_counts, reverse=True)[:10]:
        bar = '#' * date_counts[date]
        print(f"  {date}: {date_counts[date]:3d} {bar}")
    print()

    print("Top 5 patterns by frequency (codification-watch candidates):")
    print("  (codify standalone if N>=3 distinct-sessions AND no existing L# family covers)\n")
    for tag, count in sorted(pattern_primary_counts.items(), key=lambda x: -x[1])[:5]:
        # Distinct sessions for this tag
        sessions_with = sum(1 for e in entries if e['pattern_tags'] and e['pattern_tags'][0] == tag)
        codified_with = sum(1 for e in entries
                            if e['pattern_tags'] and e['pattern_tags'][0] == tag
                            and e['codified'].lower().startswith('yes'))
        print(f"  - {tag} (N={count}, codified: {codified_with}/{count})")

    # Session-position distribution (forward-only — field added 2026-06-09; existing
    # entries lack it, so report coverage explicitly).
    pos_total = sum(position_counts.values())
    print(f"\nSession-position distribution ({pos_total}/{total} entries carry position data):")
    if pos_total == 0:
        print("  (none yet — capture begins on entries added from 2026-06-09; enables the")
        print("   context-decay clustering test once ~5-10 entries carry a bucket)")
    else:
        for pos, c in sorted(position_counts.items(), key=lambda kv: -kv[1]):
            print(f"  {c:>3} ({100*c//pos_total:>2}%) {pos}")

    # Evidence-at-claim-time distribution (forward-only — field added 2026-08-17; makes
    # recall-vs-derived measurable instead of narrated).
    ev_total = sum(evidence_counts.values())
    print(f"\nEvidence-at-claim-time distribution ({ev_total}/{total} entries carry evidence data):")
    if ev_total == 0:
        print("  (none yet — capture begins on entries added from 2026-08-17; vocabulary:")
        print("   tool-derived | recall | relayed | count-only)")
    else:
        for ev, c in sorted(evidence_counts.items(), key=lambda kv: -kv[1]):
            print(f"  {c:>3} ({100*c//ev_total:>2}%) {ev}")

    # Gate-effectiveness: does a blindspot RECEDE after its decision-moment gate
    # ships? Closed loop the sniff-test FAIL log never populated — reads
    # owner-pushback ground truth (this registry), not self-reported catches.
    # Two signals: SHARE (% of all events) is intuitive but composition-COUPLED
    # (when one gate suppresses its own events every other tag's share rises
    # mechanically); per-session RATE (tag-events / all-sessions) is coupling-
    # IMMUNE → it is the PRIMARY Δ. A verdict renders ONLY when the post-ship
    # sample clears the AND-quorum (events/sessions/days); the MVS "+22pp not
    # firing" call was an artifact of a 13-event / 2-day / audit-dense window.
    # (2026-06-20; quorum + coupling-immune rate added 2026-06-21)
    latest = max(e['date'] for e in entries)  # data-driven "now" (deterministic per registry)
    def _days(a, b):
        return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days
    print(f"\nGate-effectiveness (does the blindspot recede AFTER its decision-moment gate ships?):")
    print(f"  PRIMARY = per-session RATE Δ (coupling-immune). SHARE is secondary (coupling-sensitive).")
    print(f"  Verdict WITHHELD until AND(tag-events ≥{GATE_MIN_TAG_EVENTS}, sessions ≥{GATE_MIN_SESSIONS}, days ≥{GATE_MIN_DAYS}).")
    # Sessions-that-RAN denominator.
    # The registry `*_sess` denominator counts only sessions that produced >=1 logged
    # correction — conditioned on the numerator's own detection event, so a clean
    # session is invisible and no gate can improve via clean stretches. Derive the
    # detection-INDEPENDENT denominator from the transcript corpus: first "timestamp"
    # date in a 32KB head window (transcripts open with ts-less `last-prompt` records)
    # through file mtime. Printed per gate as a direction read; thresholds NOT
    # recalibrated for this scale — the verdict arms above stay registry-denominated.
    _spans = []
    _tx_dir = SESSIONS_DIR
    if os.path.isdir(_tx_dir):
        for _p in sorted(glob.glob(os.path.join(_tx_dir, '*.jsonl'))):
            try:
                with open(_p, errors='replace') as _f:
                    _head = _f.read(32768)
                _m = re.search(r'"timestamp":"(\d{4}-\d{2}-\d{2})', _head)
                _last = datetime.fromtimestamp(os.path.getmtime(_p)).strftime('%Y-%m-%d')
                _spans.append((_m.group(1) if _m else _last, _last))
            except OSError:
                continue
    _first_entry = min(e['date'] for e in entries)
    for tag, (ship, label) in sorted(GATE_SHIP_DATES.items(), key=lambda kv: kv[1][0], reverse=True):
        before = [e for e in entries if e['date'] < ship]
        after = [e for e in entries if e['date'] >= ship]
        b_tag = sum(1 for e in before if e['pattern_tags'] and e['pattern_tags'][0] == tag)
        a_tag = sum(1 for e in after if e['pattern_tags'] and e['pattern_tags'][0] == tag)
        b_sess = len({e['session'] for e in before})
        a_sess = len({e['session'] for e in after})
        days_post = _days(ship, latest)
        print(f"\n  {tag} — gate: {label} (shipped {ship})")
        if not before:
            print(f"    before: — (gate predates the registry; no pre-gate baseline)")
            continue
        b_share = 100 * b_tag / len(before)
        b_rate = b_tag / b_sess if b_sess else 0.0
        # Numerator and denominator must cover the
        # SAME window — pre-floor registry events over post-floor transcripts
        # inverted the sign 16/16 (worst printed 31.25 corrections/session from
        # 125 events over 4 transcripts). Events are floored to the corpus floor;
        # a gate shipping before the floor gets a LEVEL read, not a delta; and
        # every mode prints (three of four gates used to print NOTHING here,
        # indistinguishable from no-data).
        _floor, _ran_b, _ran_a, _mode = _ran_windows(_spans, ship, latest, _first_entry)
        if _mode == 'no-transcripts':
            print(f"    sessions-that-RAN rate: NO COVERAGE — transcript corpus empty for a window "
                  f"(before={_ran_b}, after={_ran_a} transcripts); absence explicit by design")
        elif _mode == 'no-before-coverage':
            _a_tag_w = sum(1 for e in after if e['pattern_tags'] and e['pattern_tags'][0] == tag and e['date'] >= _floor)
            _lvl = (_a_tag_w / _ran_a) if _ran_a else 0.0
            print(f"    sessions-that-RAN LEVEL: {_lvl:.3f} /session over {_ran_a} transcripts "
                  f"(gate shipped {ship}, BEFORE the corpus floor {_floor} — no before-window "
                  f"denominator exists, so a delta is unavailable; compare successive LEVEL reads)")
        else:
            _b_tag_w = sum(1 for e in before if e['pattern_tags'] and e['pattern_tags'][0] == tag and e['date'] >= _floor)
            _a_tag_w = sum(1 for e in after if e['pattern_tags'] and e['pattern_tags'][0] == tag and e['date'] >= _floor)
            _tr_b, _tr_a = _b_tag_w / _ran_b, _a_tag_w / _ran_a
            print(f"    sessions-that-RAN rate: {_tr_b:.3f} -> {_tr_a:.3f} /session (Δ {_tr_a - _tr_b:+.3f}; "
                  f"window-matched at corpus floor {_floor}; denominators {_ran_b}->{_ran_a} transcripts "
                  f"vs {b_sess}->{a_sess} in-registry) — detection-independent; read the DIRECTION, "
                  f"thresholds uncalibrated at this scale")
        # ── SHARE/RATE VERDICT MACHINERY RETIRED (SCOPED) ───────────
        # The block used to compute before/after registry share+rate per gated tag and print a
        # ✅/⚠️/➖ verdict. Retired because the measure cannot answer "does this gate work": a
        # working gate reads LOW (no pushback) exactly like a dead detector, so the verdicts
        # measured triage throughput while wearing efficacy labels — and the ⚠️ arm said
        # "escalate". SCOPED retire: the sessions-that-RAN lines above SURVIVE deliberately —
        # transcript-denominator, detection-independent, and the exact instrument the
        # pre-registered keep/kill read names. The
        # retired code, its 2026-07-26 rate-keying fix, the denominator diagnostic, and the
        # _control_series consumer live in this file's git history; _control_series itself
        # remains for the self-test.
        print(f"    [share/rate verdicts retired — registry share/rate cannot")
        print(f"     answer gate efficacy (a working gate reads LOW like a dead detector). The")
        print(f"     sessions-that-RAN line above is the pre-registered instrument.]")

    # Deferred-decision triggers — the COUNT-based half of a logged defer, made
    # observable so a passive defer can't silently sit past its condition. The
    # qualitative half (if any) stays a judgment call, named in `what`.
    if DEFERRED_TRIGGERS:
        print(f"\nDeferred-decision triggers (count half active; qualitative half = judgment):")
        for d_tag, since, thresh, what in DEFERRED_TRIGGERS:
            n = sum(1 for e in entries
                    if e['date'] >= since and e['pattern_tags'] and e['pattern_tags'][0] == d_tag)
            status = (f"✅ COUNT-TRIGGER MET ({n}/{thresh}) — revisit the defer"
                      if n >= thresh else f"⏳ {n}/{thresh} (not yet)")
            print(f"\n  {what}")
            print(f"    {d_tag} since {since}: {status}")

# Closed vocabulary for --evidence-at-claim (the
# free-text sibling field ran 26% out-of-vocabulary, including "652" — a
# choices= on the write path is the whole fix; the READ path stays permissive).
EVIDENCE_VOCAB = ['tool-derived', 'recall', 'relayed', 'count-only']


def parse_evidence_field(line):
    """Shared by the registry reader AND the self-test arm — never a replica."""
    return line.split('**Evidence at claim time:**', 1)[1].strip()[:60]


def _ran_windows(spans, ship, latest, first_entry):
    """Window-match the sessions-that-RAN denominator: the registry reaches back months before the transcript corpus
    exists, so an unfloored numerator over a floored denominator inverted the
    sign on 16/16 swept ship dates. Returns (corpus_floor, ran_b, ran_a, mode);
    mode ∈ {'ok', 'no-before-coverage', 'no-transcripts'} — every mode PRINTS
    (absence explicit, never a silent skip)."""
    if not spans:
        return (None, 0, 0, 'no-transcripts')
    floor = min(s for s, _t in spans)
    ran_b = sum(1 for s, t in spans if s < ship and t >= max(first_entry, floor))
    ran_a = sum(1 for s, t in spans if s <= latest and t >= ship)
    if ship < floor:
        return (floor, ran_b, ran_a, 'no-before-coverage')
    if not (ran_b and ran_a):
        return (floor, ran_b, ran_a, 'no-transcripts')
    return (floor, ran_b, ran_a, 'ok')


_RULE_NAME_RE = re.compile(r'\bfeedback_[a-z0-9_]+')


def _rule_repeats(registry_text, known=()):
    """PURE: registry markdown -> {rule: [(date, session), …] in date order}, one row per entry
    that NAMES the saved rule (`feedback_<name>`, with or without `.md`) anywhere in its body.
    The first row is NOT usually the entry that wrote the rule: on 2026-10-26, 76 of the 103
    named rules with a file were added to git BEFORE their first naming entry, so
    `_rule_repeat_rows` counts from the rule file's creation date when it has one. This counts MENTIONS, not proven breaks: the registry has
    a structured `**Violated existing rule:**` field, but it takes an L# and 4 entries use it,
    while the rule names sit in free text.
    `known` = bare rule names (`use_available_tooling`): an entry naming one WITHOUT the
    `feedback_` prefix counts for `feedback_<name>` too (43 entries across 24 rules did). A truncated name (`feedback_stage_decisions`) still
    counts as its own row."""
    bare_res = [(f'feedback_{b}', re.compile(rf'(?<![a-z0-9_])(?:feedback_)?{re.escape(b)}(?![a-z0-9_])'))
                for b in known]
    out = {}
    for block in re.split(r'(?m)^(?=## \d{4}-\d{2}-\d{2} )', registry_text):
        m = re.match(r'## (\d{4}-\d{2}-\d{2}) (\w+) — ', block)
        if not m or (_UNTIL and m.group(1) > _UNTIL):
            continue
        names = set(_RULE_NAME_RE.findall(block))
        names.update(rule for rule, rx in bare_res if rx.search(block))
        for rule in sorted(names):
            out.setdefault(rule, []).append((m.group(1), m.group(2)))
    for rows in out.values():
        rows.sort()
    return out


def _rule_repeat_rows(reps, since=None, created=None):
    """PURE: `_rule_repeats` output -> [(window, later, sessions, last, rule)], window count first.
    `later` = the entries dated AFTER `created[rule]` (the day its file was added; a same-day entry
    may be the one that wrote it, so it is not counted); with no creation date, every entry after
    the first. The window filters `later` only, never the entry that wrote the rule."""
    created = created or {}
    rows = []
    for rule, ents in reps.items():
        c = created.get(rule)
        later = [e for e in ents if e[0] > c] if c else ents[1:]
        if not later:
            continue
        recent = [e for e in later if not since or e[0] >= since]
        rows.append((len(recent), len(later), len({s for _, s in later}), later[-1][0], rule))
    rows.sort(key=lambda r: (-r[0], -r[1], r[4]))
    return rows


def _rule_created_dates(repo_dir=_REPO_DIR):
    """rule -> the date its `.claude/project-memory/<rule>.md` was first added, from ONE git call.
    The log is newest-first, so the last date written per name is its oldest add. A git failure
    returns {} and the rows fall back to "after the first entry"."""
    p = subprocess.run(['git', '-C', repo_dir, 'log', '--diff-filter=A', '--format=%x01%as',
                        '--name-only', '--', '.claude/project-memory/'], capture_output=True, text=True)
    created, date = {}, None
    for line in p.stdout.splitlines() if p.returncode == 0 else []:
        if line.startswith('\x01'):
            date = line[1:]
        elif date and os.path.basename(line).startswith('feedback_') and line.endswith('.md'):
            created[os.path.basename(line)[:-3]] = date
    return created


def cmd_rule_repeats(registry_path, since=None, top=15, repo_dir=_REPO_DIR):
    """Saved rules the corrections registry names again after the rule was written —
    candidates for rules broken while loaded — mentions, not proven breaks (a later entry may be where a
    new clause was written into the rule). Read by `/meta maintain` (patterns step 7)."""
    known = sorted(os.path.basename(f)[len('feedback_'):-3] for f in
                   glob.glob(os.path.join(repo_dir, '.claude', 'project-memory', 'feedback_*.md')))
    with open(registry_path, encoding='utf-8') as f:
        reps = _rule_repeats(f.read(), known=known)
    created = _rule_created_dates(repo_dir)
    rows = _rule_repeat_rows(reps, since=since, created=created)
    scope = f'since {since}' if since else 'all-time'
    print(f'=== Saved rules named again in later corrections ({scope}; mentions, not proven breaks) ===')
    print(f'{"window":>6} {"later":>5} {"sessions":>8}  {"last":10}  rule')
    for recent, later, sessions, last, rule in rows[:top]:
        if since and not recent:
            continue
        print(f'{recent:>6} {later:>5} {sessions:>8}  {last}  {rule}')
    inwin = sum(1 for r in rows if r[0])
    win = f'; {inwin} in the window, {min(top, inwin)} shown' if since else f'; {min(top, len(rows))} shown'
    print(f'({len(rows)} rules named again at least once, all-time{win}; counted from the rule file\'s '
          f'creation date for {sum(1 for r in reps if r in created)} of {len(reps)} named rules, '
          f'else after the first naming entry; "sessions" is all-time)')


def cmd_self_test():
    """Regression guard for detection (v0.7). Asserts the 3 textbook events match
    and neutral approvals don't. Returns a process exit code (0 pass / 1 fail). Run after
    ANY edit to PUSHBACK_REGEX / reaction_tail / pushback_signals."""
    cases = [
        # (label, text, expect_match) — the 3 events /wrap 2026-06-03 Step 7f missed:
        ("(a) over-justify + 'dispute me' direct challenge",
         "it seems you are over-justifying a feature that no longer needs to exist, when "
         "the simple fix is to remove it and move on. how can you dispute me on that?",
         True),
        ("(b) quote-and-react recurrence (short)",
         '"...staging the listed paths:" - the same thing keeps happening over and over', True),
        ("(b-long) reaction trailing a >1500-char slash-command arg",
         '"' + ('blah blah ' * 200) + 'the listed paths:" - the same thing keeps happening over and over',
         True),
        ("(c) quote-and-react 'you did not find'",
         '"  - follow-ups: (1) gate (2) cleanup (3) redundancy review." '
         '- so you did not find any of them?', True),
        # v0.9 arms (2026-09-02) — the rider above the alternation demands the PASS count MOVE
        # on any regex edit; these two are the idioms the v0.9 edit added, the first modelled
        # on the correction the pre-v0.9 regex measurably missed:
        ("(v0.9) 'my point is' — the missed strongest correction, paraphrased",
         "my point is that the actual question gets passed over in favour of a quick answer",
         True),
        ("(v0.9) 'you tend to' in reaction shape",
         '"the sitemap works now" - you tend to answer a different question than the one i asked',
         True),
        # FP guards — neutral approvals/acks MUST NOT register as pushback:
        ("FP guard: neutral approval", "ok looks good, ship it when ready", False),
        ("FP guard: neutral ack", "thanks, that works for me", False),
        # NEGATIVE CONTROL (2026-07-10) — the compaction-summary echo class.
        # A harness continuation summary is a type:"user" record that quotes the owner's PAST
        # pushback verbatim. If it registered, every compaction would re-count old corrections
        # and inflate the --prime percentages every session reads at start. It does not:
        # measured 773 real summaries in, 0 owner-quote echoes out.
        #
        # The immunity is NOT a summary-aware filter — there is none. It is the >=1500
        # over-length branch, which scans only reaction_tail(). The paired case below is the
        # proof: the SAME phrases fire under 1500 chars and go silent above it.
        # reaction_tail() is the one path through that gate, and it was added deliberately to
        # reach past it. Widening reaction_tail(), or lowering 1500, REOPENS this class silently.
        # Whoever does either: keep both cases below green, or you are corrupting memory.
        ("NEG-CONTROL: compaction summary quoting owner pushback in its BODY (>=1500)",
         "This session is being continued from a previous conversation that ran out of context. "
         "Summary: the user asked 'can you confirm that?', said the same thing keeps happening "
         "over and over, and pushed back with 'you did not find any of them'. " + ("context detail. " * 120),
         False),
        # ── v0.8.1 arms. The v0.8 idiom alternatives shipped with ZERO arms and
        # cmd_self_test came back byte-identical (PASS 10 -> 10) — the invariant-pass-count
        # tell, in a file whose own docstring mandates a self-test run after any regex edit.
        # Each arm is modelled on a real utterance from the corpus, rather than a phrasing
        # invented to match the pattern I just wrote.
        ("v0.8 idiom: flat declarative refutation",
         '"the session cannot dispatch agents" - that is completely wrong', True),
        ("v0.8 idiom: incredulity (how is ... possible)",
         "how is it possible that the session degraded this much?", True),
        ("v0.8 idiom: incredulity (how is this a thing)",
         "how is this a thing at all, and why has it gone unnoticed?", True),
        ("v0.8 idiom: provenance challenge",
         "and when was that decided, and by whom?", True),
        # Documented rather than fixed. The mechanism is NOT that approving language
        # matches — it is that the SIGNAL LIVES IN THE QUOTED TEXT while the reaction is
        # approving, and under 1500 chars nothing separates the two. Fixing it properly needs speaker
        # attribution inside one message, which the scanner does not have; the >=20-30% FP
        # rate is the accepted cost of an owner-triaged surface. This arm PINS the behaviour
        # so a future reader meets a documented limit rather than a surprise.
        ("KNOWN FP (accepted): signal in the QUOTE, approval in the reaction",
         '"and why is the cap set where it is?" - exactly, that is the right question to ask', True),
        ("NEG-CONTROL paired: identical phrases UNDER the gate must still fire",
         "can you confirm that? the same thing keeps happening over and over", True),
        # === v0.9 Cat H — the legibility ask. The pass-count rider is honoured: the PASS count MUST move,
        # or these arms do not exist (v0.8 shipped regex alternatives with zero arms and a
        # byte-identical self-test, which is the invariant-pass-count tell).
        ("H-1 bare legibility ask",
         "what does that mean?", True),
        ("H-2 with a follow-on demand",
         "what does that mean, and whose job is the fix?", True),
        ("H-3 intensified form",
         "'what does it actually mean??'", True),
        ("H-4 quoting the offending clause first",
         '"the change cannot be undone once applied" - what does that mean', True),
        ("H-5 quoted-token variant",
         'in a sentence like that one, what does "exit 0" mean', True),
        # ⛔ THE ARMS THAT MATTER MOST — the word-order FP guard IS the safety case for Cat H.
        # If either of these starts matching, Cat H has become the `degraded` token (0 TP / 1 FP,
        # removed at v0.8.1) and must be reverted, not widened.
        ("H-NEG-1 MENTION not use: prose ABOUT the incident must NOT fire",
         "the owner asked what this meant, so I unpacked the sentence", False),
        ("H-NEG-2 MENTION not use: indirect-question word order must NOT fire",
         "I could not tell what this means without re-reading the session", False),
    ]
    failures = 0
    print("=== meta-corrections-scan --self-test (v0.7 detection regression) ===\n")
    for label, text, expect in cases:
        sigs = pushback_signals(text)
        got = bool(sigs)
        ok = (got == expect)
        if not ok:
            failures += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        print(f"         expect_match={expect} got_match={got} signals={sigs}")

    # --- windowing regression (--since / --window date filter) ---
    print()
    _synth = [
        {'date': '2026-06-01', 'session': 's1', 'pattern_tags': ['under-justification']},
        {'date': '2026-06-09', 'session': 's4', 'pattern_tags': ['under-justification']},  # exact boundary — inclusive >=
        {'date': '2026-06-10', 'session': 's2', 'pattern_tags': ['under-justification']},
        {'date': '2026-06-20', 'session': 's3', 'pattern_tags': ['minimum-viable-scope']},
    ]
    _win = [e for e in _synth if e['date'] >= '2026-06-09']
    _ok = (len(_win) == 3 and {e['session'] for e in _win} == {'s2', 's3', 's4'})
    if not _ok:
        failures += 1
    print(f"  [{'PASS' if _ok else 'FAIL'}] windowing filter (>=2026-06-09 inclusive → 3 of 4, s2+s3+s4)")

    # --- sessions-that-RAN window-matching ---
    # Synthetic corpus floored 2026-06-26. A gate shipping BEFORE the floor must
    # take the no-before-coverage (LEVEL) branch — the silent-skip + mismatched-
    # populations defect had no arm, and --self-test came back 26/26 byte-
    # identical while both new features shipped unexercised.
    _rw_spans = [('2026-06-26', '2026-07-10'), ('2026-07-01', '2026-08-01'), ('2026-08-02', '2026-08-16')]
    _f1, _rb1, _ra1, _m1 = _ran_windows(_rw_spans, '2026-05-27', '2026-08-16', '2026-04-23')
    _ok = (_m1 == 'no-before-coverage' and _f1 == '2026-06-26')
    if not _ok:
        failures += 1
    print(f"  [{'PASS' if _ok else 'FAIL'}] _ran_windows: pre-floor ship → LEVEL branch, never a silent skip (mode={_m1}, floor={_f1})")
    _f2, _rb2, _ra2, _m2 = _ran_windows(_rw_spans, '2026-07-15', '2026-08-16', '2026-04-23')
    _ok = (_m2 == 'ok' and _rb2 == 2 and _ra2 == 2)
    if not _ok:
        failures += 1
    print(f"  [{'PASS' if _ok else 'FAIL'}] _ran_windows: post-floor ship → window-matched counts (mode={_m2}, before={_rb2}, after={_ra2})")
    _f3, _rb3, _ra3, _m3 = _ran_windows([], '2026-07-15', '2026-08-16', '2026-04-23')
    _ok = (_m3 == 'no-transcripts')
    if not _ok:
        failures += 1
    print(f"  [{'PASS' if _ok else 'FAIL'}] _ran_windows: empty corpus → explicit no-transcripts (mode={_m3})")

    # --- evidence-at-claim field: shared parse + closed vocabulary ---
    _ev = parse_evidence_field('**Evidence at claim time:** tool-derived')
    _ok = (_ev == 'tool-derived' and _ev in EVIDENCE_VOCAB and len(EVIDENCE_VOCAB) == 4)
    if not _ok:
        failures += 1
    print(f"  [{'PASS' if _ok else 'FAIL'}] evidence field: shared parser round-trips + vocabulary closed at 4 (got '{_ev}')")

    # --- untreated-control series ---
    _cs_before = ([{'date': '2026-06-01', 'session': f'b{i}', 'pattern_tags': ['minimum-viable-scope']} for i in range(20)]
                  + [{'date': '2026-06-01', 'session': f'b{i}', 'pattern_tags': ['preference-violation']} for i in range(4)])
    _cs_after = ([{'date': '2026-07-01', 'session': f'a{i}', 'pattern_tags': ['minimum-viable-scope']} for i in range(20)]
                 + [{'date': '2026-07-01', 'session': f'a{i}', 'pattern_tags': ['preference-violation']} for i in range(30)])
    _ctrl = _control_series(_cs_before, _cs_after, 20, 30, {'minimum-viable-scope'})
    # gated MVS excluded; ungated preference-violation moved 4/20=0.20 → 30/30=1.00 = +0.80
    _cs_ok = (len(_ctrl) == 1 and _ctrl[0][0] == 'preference-violation' and abs(_ctrl[0][1] - 0.80) < 1e-9)
    if not _cs_ok:
        failures += 1
    print(f"  [{'PASS' if _cs_ok else 'FAIL'}] untreated-control series (gated MVS excluded; ungated pref-violation +0.80) got={_ctrl}")

    # ---- QUEUED-SHAPE INTAKE arms (2026-08-12). These exercise the REAL scan_session over a
    # fixture jsonl rather than pushback_signals, because the thing under test is RECORD-LEVEL
    # admission, which no text-level case can reach. One RED control per claim class: without
    # the corresponding filter each arm below flips, which is what makes them non-decorative.
    import tempfile as _tf
    _recs = [
        # (1) a genuine queued owner pushback -> MUST be admitted
        {"type": "queue-operation", "operation": "enqueue",
         "content": "how is this a thing at all, and why has it gone unnoticed?"},
        # (2) the SAME message under a second operation -> MUST NOT double-count.
        #     Measured: enqueue 119 / dequeue 46 / remove 72 on one transcript; an un-keyed
        #     admit doubled every event.
        {"type": "queue-operation", "operation": "dequeue",
         "content": "how is this a thing at all, and why has it gone unnoticed?"},
        # (3) a harness payload that TRIPS the regex on a weak signal -> MUST NOT be admitted.
        #     This is the discriminating fixture: .content has no author discriminator, so the
        #     pushback conjunction ALONE is insufficient. Measured live on 'the only'.
        {"type": "queue-operation", "operation": "enqueue",
         "content": "<task-notification> the only remaining task is why is this failing </task-notification>"},
        # (4) an ordinary user record -> admitted on the unchanged path (control that the
        #     existing behaviour is untouched by the new branch)
        {"type": "user", "message": {"role": "user", "content": "that is completely wrong"}},
    ]
    with _tf.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as _fh:
        for _r in _recs:
            _fh.write(json.dumps(_r) + "\n")
        _fx = _fh.name
    try:
        _off = scan_session(_fx, include_queued=False)
        _on = scan_session(_fx, include_queued=True)
        _shapes = [e.get("shape") for e in _on]
        _checks = [
            ("queued intake OFF by flag leaves the user path untouched (1 event, no queued)",
             len(_off) == 1 and all(e.get("shape") == "user" for e in _off)),
            ("queued pushback IS admitted when the flag is on",
             _shapes.count("queued") == 1),
            ("dequeue twin does NOT double-count (operation-keyed)",
             _shapes.count("queued") == 1 and len(_on) == 2),
            ("harness payload REJECTED even though it trips the regex",
             not any("task-notification" in e["text"] for e in _on)),
        ]
        for _lbl, _ok in _checks:
            if not _ok:
                failures += 1
            print(f"  [{'PASS' if _ok else 'FAIL'}] {_lbl}")
    finally:
        os.unlink(_fx)

    # ── cmd_dig RESOLVE-SIDE ARM (2026-09-08) ────────────────────────────────────────────
    # The four arms above test INTAKE (scan_session). They all passed while --dig, the
    # documented way to resolve an ambiguous candidate, was structurally blind to the queued
    # shape intake goes out of its way to admit: it read `.message.content` unconditionally,
    # so a queue-operation record (text at `.content`, NO `message` key) printed
    # "(extract_user_text returned None)" and the reader concluded the record was junk.
    # An intake-only self-test cannot see that — the two halves have to agree about the
    # record shape, and nothing was checking that they did.
    # These arms go RED under the pre-fix code: it cannot print the queued text at all.
    import io as _io, contextlib as _ctx
    _dg = _tf.mkdtemp()
    _pfx = "selftestdig"
    with open(os.path.join(_dg, f"{_pfx}-0000.jsonl"), "w") as _fh:
        _fh.write(json.dumps({"type": "assistant",
                              "message": {"content": [{"type": "text", "text": "prior turn"}]}}) + "\n")
        _fh.write(json.dumps({"type": "queue-operation", "operation": "enqueue",
                              "content": "QUEUEDNEEDLE that is completely wrong"}) + "\n")
        _fh.write(json.dumps({"type": "user",
                              "message": {"role": "user", "content": "USERNEEDLE that is completely wrong"}}) + "\n")
        # Fixture: the SAME text under a non-admitting operation.
        _fh.write(json.dumps({"type": "queue-operation", "operation": "dequeue",
                              "content": "DEQUEUENEEDLE that is completely wrong"}) + "\n")
    _saved_dir = globals().get("SESSIONS_DIR")
    try:
        globals()["SESSIONS_DIR"] = _dg
        def _dig_out(i):
            _b = _io.StringIO()
            with _ctx.redirect_stdout(_b):
                cmd_dig(f"{_pfx}:{i}")
            return _b.getvalue()
        _q, _u, _d = _dig_out(1), _dig_out(2), _dig_out(3)
        _checks2 = [
            # THE arm the fix exists for. ⛔ IT MUST KEY ON THE RECOVERY PATH, NOT ON THE
            # NEEDLE APPEARING ANYWHERE IN STDOUT — `"QUEUEDNEEDLE" in _q` ALONE IS VACUOUS
            # and was MEASURED passing under a mutant with the dispatch reverted, because the
            # RAW-debug fallback prints `.content` too. The needle is in the output either
            # way; what the fix changes is WHICH LABEL it appears under. Assert the extraction
            # label and the absence of the failure line, or this arm certifies nothing.
            ("--dig RESOLVES a queued owner message (the shape intake admits)",
             "QUEUEDNEEDLE" in _q and "USER TEXT (post-ARGUMENTS" in _q
             and "no text recovered" not in _q and "returned None" not in _q),
            ("--dig labels the queued shape rather than warning it is not 'user'",
             "shape=queued" in _q and "expected 'user'" not in _q),
            # Control in the other direction: the ordinary path must not regress.
            ("--dig still resolves an ordinary user message (no regression)",
             "USERNEEDLE" in _u and "shape=user" in _u),
            # Negative control: silence would pass arm 1 vacuously if dig printed nothing.
            ("the two shapes resolve to DIFFERENT text (neither arm is reading the other)",
             "QUEUEDNEEDLE" not in _u and "USERNEEDLE" not in _q),
            # A non-enqueue record must be ANNOUNCED as excluded AND not RESOLVED.
            # The first four arms all used 'enqueue', so nothing exercised the exclusion and the
            # fall-through shipped: the NOTE printed and the resolved text printed under it.
            # ⛔ KEY ON THE LABEL, NOT ON THE NEEDLE — FOR THE SECOND TIME ON THIS FILE, AND IN
            # THE OPPOSITE DIRECTION. Arm 1's first version read `"QUEUEDNEEDLE" in _q` and was
            # too WEAK (the RAW-debug fallback prints the same text, so it passed under a
            # reverted fix). This arm's first version read `"DEQUEUENEEDLE" not in _d` and was
            # too STRICT — it FAILED against a correct fix, because routing to the RAW-debug
            # path is exactly what the remedy prescribes and that path legitimately shows the
            # content for debugging. Both errors came from reaching for the needle instead of
            # the label. What distinguishes resolved from excluded is which BLOCK the text
            # appears under, so that is what both arms now assert.
            ("a non-enqueue queue-operation is announced as excluded AND its text is NOT resolved",
             "not 'enqueue'" in _d
             and "USER TEXT (post-ARGUMENTS" not in _d
             and "no text recovered" in _d
             and "EXCLUDED" in _d),
        ]
        for _lbl, _ok in _checks2:
            if not _ok:
                failures += 1
            print(f"  [{'PASS' if _ok else 'FAIL'}] {_lbl}")
    finally:
        if _saved_dir is not None:
            globals()["SESSIONS_DIR"] = _saved_dir
        import shutil as _sh
        _sh.rmtree(_dg, ignore_errors=True)

    # --violated: one L# or exit 2 BEFORE the append.
    import subprocess as _sp, tempfile as _tf
    with _tf.TemporaryDirectory() as _vd:
        _reg = os.path.join(_vd, "reg.md")
        with open(_reg, "w") as _fh:
            _fh.write("# r\n")
        _cmd = [sys.executable, os.path.abspath(__file__), "--add-entry", "--registry-path", _reg, "--session", "abcd1234",
                "--topic", "t", "--proposal", "p", "--pushback", "b", "--correction", "c", "--new-ground", "n", "--pattern", "x"]
        for _v, _rc in (("9990", 2), ("", 2), ("L9990,L9991", 2), ("L9990", 0)):
            _r = _sp.run(_cmd + ["--violated", _v], capture_output=True, text=True)
            _body = open(_reg).read()
            _ok = _r.returncode == _rc and (("**Violated existing rule:** L9990\n" in _body) if _rc == 0 else _body == "# r\n")
            failures += 0 if _ok else 1
            print(f"  [{'PASS' if _ok else 'FAIL'}] --violated {_v!r} -> exit {_rc}, registry {'appended' if _rc == 0 else 'untouched'}")

    # A fresh copy has no registry: --add-entry creates it and appends one entry; --analyze still refuses a missing path.
    with _tf.TemporaryDirectory() as _nd:
        _absent = os.path.join(_nd, "sub", "absent.md")
        _r = _sp.run([sys.executable, os.path.abspath(__file__), "--add-entry", "--registry-path", _absent,
                      "--date", "2026-01-02", "--session", "abcd1234", "--topic", "t", "--proposal", "p",
                      "--pushback", "b", "--correction", "c", "--new-ground", "n", "--pattern", "x"],
                     capture_output=True, text=True)
        _ents = _parse_entries(_absent) if os.path.exists(_absent) else []
        _ok = _r.returncode == 0 and len(_ents) == 1 and _ents[0]["session"] == "abcd1234"
        failures += 0 if _ok else 1
        print(f"  [{'PASS' if _ok else 'FAIL'}] --add-entry on a missing registry -> created, exit 0, 1 entry parsed")
        _r2 = _sp.run([sys.executable, os.path.abspath(__file__), "--analyze", "--registry-path",
                       os.path.join(_nd, "still-absent.md")], capture_output=True, text=True)
        _ok = _r2.returncode == 1 and not os.path.exists(os.path.join(_nd, "still-absent.md"))
        failures += 0 if _ok else 1
        print(f"  [{'PASS' if _ok else 'FAIL'}] --analyze on a missing registry -> exit 1, nothing created")
        _add = ["--add-entry", "--date", "2026-01-02", "--session", "abcd1234", "--topic", "t", "--proposal", "p",
                "--pushback", "b", "--correction", "c", "--new-ground", "n", "--pattern", "x"]
        _r3 = _sp.run([sys.executable, os.path.abspath(__file__)] + _add + ["--registry-path", "bare.md"],
                      capture_output=True, text=True, cwd=_nd)
        _ok = _r3.returncode == 0 and len(_parse_entries(os.path.join(_nd, "bare.md")) if os.path.exists(os.path.join(_nd, "bare.md")) else []) == 1
        failures += 0 if _ok else 1
        print(f"  [{'PASS' if _ok else 'FAIL'}] --add-entry on a missing bare filename -> created in the working directory, exit 0")
        _r4 = _sp.run([sys.executable, os.path.abspath(__file__)] + _add
                      + ["--registry-path", os.path.join(_nd, "sub2", "absent.md"), "--violated", "nope"], capture_output=True, text=True)
        _ok = _r4.returncode == 2 and not os.path.exists(os.path.join(_nd, "sub2"))
        failures += 0 if _ok else 1
        print(f"  [{'PASS' if _ok else 'FAIL'}] --add-entry refused (bad --violated) on a missing registry -> exit 2, no file or directory created")

    # --rule-repeats: per-entry, per-rule counting.
    _fx = ("# header naming feedback_header_only\n"
           "## 2026-06-01 aaaa1111 — wrote it\n**Codified as L#?** yes — feedback_x.md (new)\n"
           "## 2026-07-01 bbbb2222 — broke it\nbody names feedback_x and feedback_x.md twice\n"
           "## 2026-08-01 cccc3333 — broke it again\n**Codified as L#?** feedback_x (existing); feedback_y\n")
    _rr = _rule_repeats(_fx)
    _saved_until, globals()['_UNTIL'] = _UNTIL, '2026-07-01'
    _rr_until = _rule_repeats(_fx)
    globals()['_UNTIL'] = _saved_until
    for _lbl, _ok in (
        ("rule-repeats: --until drops entries dated after it, as _parse_entries does",
         _rr_until.get("feedback_x") == [("2026-06-01", "aaaa1111"), ("2026-07-01", "bbbb2222")]),
        ("rule-repeats: one row per ENTRY, not per mention (feedback_x named 3x in one entry)",
         _rr.get("feedback_x") == [("2026-06-01", "aaaa1111"), ("2026-07-01", "bbbb2222"),
                                   ("2026-08-01", "cccc3333")]),
        ("rule-repeats: a name above the first entry heading belongs to no entry",
         "feedback_header_only" not in _rr),
        ("rule-repeats: a rule named once has no later rows",
         _rr.get("feedback_y") == [("2026-08-01", "cccc3333")]),
        ("rule-repeats: a bare rule name (no feedback_ prefix) counts for the rule, a longer name does not",
         _rule_repeats("## 2026-08-01 aaaa — a\nbroke use_tool again; see use_tools_more\n",
                       known=["use_tool"]).get("feedback_use_tool") == [("2026-08-01", "aaaa")]
         and "feedback_use_tools_more" not in _rule_repeats("## 2026-08-01 aaaa — a\nuse_tools_more\n",
                                                            known=["use_tool"])
         and _rule_repeats("## 2026-08-01 aaaa — a\nuse_tools_more\n", known=["use_tool"]) == {}
         # the real prefix pair is model_routing / model_routing_policy: an underscore continuation
         # and an underscore lead are longer names too
         and _rule_repeats("## 2026-08-01 aaaa — a\nuse_tool_more and x_use_tool\n", known=["use_tool"]) == {}),
        ("rule-repeats: entries are date-sorted whatever the file order",
         _rule_repeats("## 2026-09-01 bbbb — b\nfeedback_z\n## 2026-08-01 aaaa — a\nfeedback_z\n")
         .get("feedback_z") == [("2026-08-01", "aaaa"), ("2026-09-01", "bbbb")]),
        # rows: (window, later, sessions, last, rule)
        ("rule-repeat rows: the first entry is not counted, the second is",
         _rule_repeat_rows(_rr) == [(2, 2, 2, "2026-08-01", "feedback_x")]),
        ("rule-repeat rows: --since is inclusive and never counts the first entry",
         _rule_repeat_rows(_rr, since="2026-06-01") == [(2, 2, 2, "2026-08-01", "feedback_x")]
         and _rule_repeat_rows(_rr, since="2026-08-01") == [(1, 2, 2, "2026-08-01", "feedback_x")]),
        ("rule-repeat rows: with a creation date, an entry after it counts and a same-day one does not",
         _rule_repeat_rows({"feedback_q": [("2026-05-01", "s1"), ("2026-06-01", "s2")]},
                           created={"feedback_q": "2026-04-01"}) == [(2, 2, 2, "2026-06-01", "feedback_q")]
         and _rule_repeat_rows({"feedback_q": [("2026-05-01", "s1"), ("2026-06-01", "s2")]},
                               created={"feedback_q": "2026-05-01"}) == [(1, 1, 1, "2026-06-01", "feedback_q")]),
        ("rule-repeat rows: sorted by the window count before the all-time count",
         [r[4] for r in _rule_repeat_rows(
             {"feedback_a": [("2026-01-01", "a0")] + [("2026-02-0%d" % i, "a%d" % i) for i in range(1, 4)],
              "feedback_b": [("2026-01-01", "b0"), ("2026-03-01", "b1"), ("2026-03-02", "b2")]},
             since="2026-03-01")] == ["feedback_b", "feedback_a"]),
    ):
        failures += 0 if _ok else 1
        print(f"  [{'PASS' if _ok else 'FAIL'}] {_lbl}")

    # --rule-repeats wiring: cmd_rule_repeats reads the known names and the creation dates from
    # repo_dir, and the footer counts what it shows.
    import io as _io2, contextlib as _ctx2
    with _tf.TemporaryDirectory() as _rd:
        _env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        _env.update(GIT_AUTHOR_DATE='2026-05-01T12:00:00Z', GIT_COMMITTER_DATE='2026-05-01T12:00:00Z',
                    GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
        os.makedirs(os.path.join(_rd, '.claude', 'project-memory'))
        open(os.path.join(_rd, '.claude', 'project-memory', 'feedback_use_tool.md'), 'w').write('x\n')
        for _g in (['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'r']):
            _sp.run(['git', '-C', _rd] + _g, env=_env, capture_output=True)
        # deleted and re-added later: the OLDEST add is the creation date
        for _d, _g in (('2026-05-20', ['rm', '-q', '.claude/project-memory/feedback_use_tool.md']),
                       ('2026-05-20', ['commit', '-q', '-m', 'd']), ('2026-06-15', None)):
            if _g is None:
                os.makedirs(os.path.join(_rd, '.claude', 'project-memory'), exist_ok=True)
                open(os.path.join(_rd, '.claude', 'project-memory', 'feedback_use_tool.md'), 'w').write('y\n')
                _gs = (['add', '-A'], ['commit', '-q', '-m', 'a'])
            else:
                _gs = (_g,)
            _env.update(GIT_AUTHOR_DATE=_d + 'T12:00:00Z', GIT_COMMITTER_DATE=_d + 'T12:00:00Z')
            for _g2 in _gs:
                _sp.run(['git', '-C', _rd] + _g2, env=_env, capture_output=True)
        _reg = os.path.join(_rd, 'reg.md')
        open(_reg, 'w').write("## 2026-06-01 aaaa — a\nfeedback_use_tool and feedback_other\n"
                              "## 2026-07-01 bbbb — b\nbroke use_tool again; feedback_other\n")
        _buf = _io2.StringIO()
        with _ctx2.redirect_stdout(_buf):
            cmd_rule_repeats(_reg, since='2026-06-01', top=1, repo_dir=_rd)
        _out = _buf.getvalue()
        _buf2 = _io2.StringIO()
        with _ctx2.redirect_stdout(_buf2):
            cmd_rule_repeats(_reg, top=1, repo_dir=_rd)
        _out2 = _buf2.getvalue()
    _ok = ("     2     2        2  2026-07-01  feedback_use_tool\n" in _out and "feedback_other" not in _out
           and "2 in the window, 1 shown" in _out and "creation date for 1 of 2 named rules" in _out
           and "(2 rules named again at least once, all-time; 1 shown;" in _out2)
    failures += 0 if _ok else 1
    print(f"  [{'PASS' if _ok else 'FAIL'}] rule-repeats wiring: bare names + creation dates read from repo_dir, footer counts what it shows")

    print(f"\n{'OK' if failures == 0 else 'FAILED'}: passed with {failures} failure(s)")
    return 1 if failures else 0

def cmd_add_entry(args):
    """Append a standard-format entry to the registry."""
    secondary = f" (+`{args.pattern_secondary}` secondary)" if args.pattern_secondary else ""
    entry = (
        f"\n## {args.date} {args.session} — {args.topic}\n"
        f"**My proposal:** {args.proposal}\n"
        f"**Owner pushback signal:** \"{args.pushback}\"\n"
        f"**Correction shape:** {args.correction}\n"
        f"**New ground covered:** {args.new_ground}\n"
        f"**Pattern tag:** `{args.pattern}`{secondary}\n"
        f"**Codified as L#?** {args.codified}\n"
    )
    if getattr(args, 'session_position', None):
        entry += f"**Session-position:** {args.session_position}\n"
    if getattr(args, 'violated', None) is not None:   # an empty value is refused too, never silently dropped
        if not re.fullmatch(r'L\d{1,5}', args.violated):
            print(f"--violated takes one L# in the form L<digits>, got {args.violated!r}", file=sys.stderr)
            sys.exit(2)
        entry += f"**Violated existing rule:** {args.violated}\n"
    if getattr(args, 'evidence_at_claim', None):
        entry += f"**Evidence at claim time:** {args.evidence_at_claim}\n"
    if not os.path.exists(args.registry_path):
        # A fresh copy ships no registry; the first approved correction creates it. Created only once the
        # entry is valid, so a refused call (a bad --violated) leaves no file and no directory behind.
        os.makedirs(os.path.dirname(args.registry_path) or '.', exist_ok=True)
        with open(args.registry_path, 'w') as f:
            f.write("# Corrections registry\n\nOne entry per correction, appended by "
                    "`meta-corrections-scan.py --add-entry` (run from /wrap).\n")
        print(f"Created {args.registry_path}", file=sys.stderr)
    with open(args.registry_path, 'a') as f:
        f.write(entry)
    print(f"Appended entry to {args.registry_path}:")
    print(f"  {args.date} {args.session} — {args.topic}")
    print(f"  pattern={args.pattern} codified={args.codified}")

def main():
    parser = argparse.ArgumentParser(description='Scan session jsonls for owner-pushback events.')
    parser.add_argument('--session', help='Specific session ID (substring match)')
    parser.add_argument('--current', action='store_true', help='Scan only the CURRENT session: CLAUDE_CODE_SESSION_ID when set (never falls through to a peer), the most-recently-modified jsonl only when it is absent')
    parser.add_argument('--days', type=int, default=None, help='Scan sessions within last N days')
    parser.add_argument('--all', action='store_true', help='Scan ALL session jsonls')
    parser.add_argument('--scan', action='store_true', help='No-op scan-mode alias (scanning is the DEFAULT action). Lets the documented "--scan [--current|--session|--days|--all]" + /wrap Step 7f invocation parse instead of erroring on an unrecognized flag.')
    parser.add_argument('--verbose', action='store_true', help='Show full message text per event')
    parser.add_argument('--include-queued', dest='include_queued', action='store_true', default=True,
                        help="(DEFAULT ON since 2026-08-12; kept for explicitness/back-compat — see --no-queued.) "
                             "Also admit `queue-operation` records (owner keystrokes sent WHILE the orchestrator works, "
                             "which carry no type=='user' wrapper and are otherwise LOST PERMANENTLY). CONJUNCTION, not a "
                             "widening: admitted only when the text independently trips PUSHBACK_REGEX, because .content "
                             "also carries task-notifications and assistant prose. Tagged shape=queued in the output. "
                             "MEASURED before the default flip: per-session (--current, a 2-day session) 7 admitted, "
                             "0 harness payloads, 7/7 genuine owner utterances; corpus-wide (--all) 268 admitted, "
                             "0 harness payloads. The inflation fear is refuted at the per-session level, which is "
                             "what /wrap Step 7f actually runs.")
    parser.add_argument('--no-queued', dest='include_queued', action='store_false',
                        help='Opt OUT of queued-shape intake (restores the pre-2026-08-12 type==user-only scan).')
    parser.add_argument('--dig', help='Resolve one event: <session-prefix>:<idx> (e.g., <session-id>:2078)')
    parser.add_argument('--analyze', action='store_true', help='Analyze registry frequency + codification rate')
    parser.add_argument('--rule-repeats', dest='rule_repeats', action='store_true',
                        help='Saved rules (feedback_*) the registry names again in later entries — mentions, not proven breaks; with --since/--window, sorts by the window count (read by /meta maintain, patterns step 7)')
    parser.add_argument('--prime', action='store_true', help='Compact top-N recurring blindspot patterns for /orient session-start priming (PCT<TAB>COUNT<TAB>TAG)')
    parser.add_argument('--render', action='store_true', help='With --prime: human-readable labeled spotlight (pct + count + counter-action) instead of raw TSV — used by the SessionStart hook + /orient')
    _win = parser.add_mutually_exclusive_group()
    _win.add_argument('--since', help='With --analyze/--prime: windowed view = entries on/after YYYY-MM-DD (shows window vs pre-window vs all-time + per-session rate Δ). Default off = all-time. The all-time cumulative share LAGS recent movement — use this to read whether a primed blindspot is actually receding.')
    _win.add_argument('--window', type=int, metavar='N', help='With --analyze/--prime: windowed view = last N days (anchored on today). Convenience alias for --since (today − N days).')
    parser.add_argument('--until', help='With --analyze/--prime: drop every entry dated after YYYY-MM-DD before any computation, so a pre-registered window is CLOSED (late-filed or later-dated entries cannot enter it).')
    parser.add_argument('--self-test', dest='self_test', action='store_true', help='Run detection regression tests (the three corpus events a/b/c + FP guards); exit 1 on any failure')
    parser.add_argument('--registry-path', default=DEFAULT_REGISTRY,
                        help=f'Registry file path (default: {DEFAULT_REGISTRY})')
    # --add-entry primitive (used by /wrap Step 7f auto-invocation)
    parser.add_argument('--add-entry', action='store_true', help='Append a standard-format entry to the registry (requires --date --session --topic --proposal --pushback --correction --new-ground --pattern; optional --pattern-secondary --codified)')
    parser.add_argument('--date', default=datetime.now().strftime('%Y-%m-%d'), help='Entry date (default: today)')
    parser.add_argument('--topic', help='One-line topic')
    parser.add_argument('--proposal', help='What I recommended')
    parser.add_argument('--pushback', help='Owner pushback signal (verbatim quote)')
    parser.add_argument('--correction', help='How the answer shifted')
    parser.add_argument('--new-ground', dest='new_ground', help='What we learned that wasn\'t in scope before')
    parser.add_argument('--pattern', help='Primary pattern tag (e.g., under-justification)')
    parser.add_argument('--pattern-secondary', dest='pattern_secondary', help='Optional secondary pattern tag')
    parser.add_argument('--codified', default='no', help='Codification status (default: no)')
    parser.add_argument('--session-position', dest='session_position', help='OPTIONAL: where in the session the event fired (early|mid|late|post-compact) — forward-only capture for the context-decay test')
    parser.add_argument('--evidence-at-claim', dest='evidence_at_claim', choices=EVIDENCE_VOCAB, help='OPTIONAL: what the erroneous claim rested on when made — forward-only capture for the recall-vs-derived split. Closed vocabulary (the free-text sibling field drifted 26%% out-of-vocabulary, incl. "652")')
    parser.add_argument('--violated', help='OPTIONAL: the one L# (in the form L<digits>) of an ALREADY-codified rule this event violated — forward-only capture, kept apart from --codified, which records what the event LED to')
    args = parser.parse_args()
    global _UNTIL
    _UNTIL = args.until

    if args.self_test:
        sys.exit(cmd_self_test())

    if args.dig:
        cmd_dig(args.dig)
        return

    since = _resolve_since(args)

    if args.prime:
        cmd_prime(args.registry_path, render=args.render, since=since)
        return

    if args.analyze:
        cmd_analyze(args.registry_path, since=since)
        return

    if args.rule_repeats:
        cmd_rule_repeats(args.registry_path, since=since)
        return

    if args.add_entry:
        required = ['session', 'topic', 'proposal', 'pushback', 'correction', 'new_ground', 'pattern']
        missing = [f for f in required if not getattr(args, f, None)]
        if missing:
            print(f"--add-entry requires: {', '.join('--' + f.replace('_','-') for f in missing)}", file=sys.stderr)
            sys.exit(2)
        cmd_add_entry(args)
        return

    sessions = list_sessions(
        days_window=args.days,
        all_sessions=args.all,
        specific_session=args.session,
        current_only=args.current,
    )

    if not sessions:
        print("No session jsonls matched.", file=sys.stderr)
        sys.exit(1)

    print(f"Scanning {len(sessions)} session(s)\n")
    total_events = 0
    for path in sessions:
        events = scan_session(path, verbose=args.verbose, include_queued=args.include_queued)
        overrides = scan_overrides(path)
        if not events and not overrides:
            continue
        total_events += len(events) + len(overrides)
        sid = os.path.basename(path).replace('.jsonl', '')
        mtime = datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d %H:%M')
        print(f"=== Session {sid[:8]} ({mtime}) — {len(events)} pushback + {len(overrides)} soft-override ===")
        for i, e in enumerate(events, 1):
            _sh = e.get('shape', 'user')
            _tag = '' if _sh == 'user' else f" shape={_sh}"
            print(f"  [{i}] idx={e['idx']} signals={e['signals']}{_tag}")
            print(f"      {e['text'].strip()[:350]}")
        for o in overrides:
            print(f"  [SOFT-OVERRIDE] idx={o['idx']} — owner picked the NON-recommended option")
            print(f"      Q: {o['question']}")
            print(f"      recommended: {o['recommended']!r}")
            print(f"      selected:    {o['selected']!r}")
        print()

    print(f"\nTotal candidate events: {total_events} across {len(sessions)} session(s)")
    print(f"Note: false-positive rate ~20-30% from skill-spec headers; eyeball-triage required.")
    # Drain-due gate (v0.7 — pattern-aware): the meaningful trigger is a RECURRING pattern
    # (>=3 distinct sessions) with NOTHING codified — NOT the raw non-yes count. The raw count
    # permanently includes single-instance (N=1) novel candidates that CANNOT be codified yet
    # (they await a 2nd occurrence), so the old `>= 20` gate cried wolf on a healthy registry
    # (2026-06-04 drain pass: 31 non-yes but 0 uncovered >=3-session pattern — every high-
    # frequency family was already codified). Hard-warn only on a genuinely-uncovered recurring
    # pattern; soft-note a large raw backlog (curation hygiene, not urgent). Raw counts stay
    # fully visible via `--analyze` (Codification status block).
    try:
        _reg = _parse_entries(args.registry_path) if os.path.exists(args.registry_path) else []
        from collections import defaultdict as _dd
        _sess, _cod = _dd(set), _dd(int)
        for _e in _reg:
            if not _e['pattern_tags']:
                continue
            _t = _e['pattern_tags'][0]
            _sess[_t].add(_e['session'])
            if _e['codified'].lower().startswith('yes'):
                _cod[_t] += 1
        _uncovered = sorted(t for t in _sess if len(_sess[t]) >= 3 and _cod[t] == 0)
        _uncod = sum(1 for e in _reg if not e['codified'].lower().startswith('yes'))
        if _uncovered:
            print(f"\n⚠️  DRAIN DUE: {len(_uncovered)} recurring pattern(s) at >=3 distinct sessions with "
                  f"NOTHING codified: {', '.join(_uncovered)}. Run `--analyze` + codify before relying on more.")
        elif _uncod >= 35:
            print(f"\nℹ️  {_uncod} non-yes entries (of {len(_reg)}), but 0 uncovered >=3-session pattern — "
                  f"mostly N=1 candidates awaiting a 2nd occurrence. Periodic `--analyze` review suffices.")
    except Exception:
        pass

if __name__ == '__main__':
    main()
