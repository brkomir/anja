#!/usr/bin/env python3
"""limit-recovery.py — find the sub-agents of a session that died at an API usage limit (or the
auth errors a limit hit cascades into), decide for each whether to RESUME it, WAIT for its own model's
reset, or seat a FRESH agent over its transcript, and write the digest a fresh agent takes over from.

The procedure: a death at a limit is detected automatically, and after the reset the work is picked up
from the point where the agent left off, by a resume or by a fresh agent reading its transcript. It began
with a cold seat with a large context replaced rather than resumed (thought cheaper than a resume); a room
rule (resume a cold agent unless it sat within 300,000 tokens of its compaction point) replaced that, and
the room line was then DROPPED: always resume, except for a model change or a failed resume. The table
below is that rule.

What a death looks like (measured on four readers, one transcript each): the LAST
record of `~/.claude/projects/<key>/<sid>/subagents/agent-<id>.jsonl` is an `assistant` record
with `isApiErrorMessage: true`, `message.model` `<synthetic>` and one text block carrying the
harness's error line ("You've hit your session limit · resets …", "You've reached your Fable
limit…", "Not logged in · Please run /login", "API Error: OAuth token has been revoked…",
"rate_limit"). A seat that handed back ends with a `SubagentHandback` tool_use instead, and a
resumed seat gets new records after the error, so the detector self-clears on a resume.

The decision table (`decide()`):
  BANKED  — a SubagentHandback tool_use exists anywhere in the transcript: the work was handed
            back before the error; collect the hand-back, nothing to recover.
  RESUME  — every other death, warm or cold, whatever its size: a resume keeps the agent's own work
            and measured cheaper than a fresh seat re-reading its way back (the measurement is
            beside CACHE_WARM_MINUTES below). The reason says whether the cache is warm (within
            CACHE_WARM_MINUTES: the resume pays only the increment) or cold (it rewrites the cache once).
  WAIT    — the agent died at its OWN model's limit (an Opus wording such as "You have used your Opus weekly
            limit" is a self-test fixture; the Opus weekly deaths recorded on this machine (four agents whose
            limit reset the next evening, and three more on claude-opus-5) read the account-wide
            "You've hit your weekly limit · resets …", which names no model and
            so reads as RESUME, like a session limit): it cannot run on
            that model until that limit resets (on Opus no other model has room for it; on any other model only
            a Fable agent moves at once), so nothing resumes it now. After the reset: resume it if a resume would run on that model, else seat a fresh one ON it.
            No clock is read, so the row stays WAIT after the reset; its reason quotes the error, which names
            the reset. A FABLE agent at Fable's own limit is never WAIT: see MODEL_LIMIT_MOVES (FRESH on Opus).
  FRESH   — the context does not fit ("Prompt is too long"): a resume re-sends the same context and fails the
            same way, and in 4 of the 6 such deaths measured on this machine (all on 200,000-token
            windows) the system prompt and tools alone overflowed, so a fresh seat of the same type on the same
            model fails too. Seat the fresh one ON A MODEL WITH A LARGER CONTEXT WINDOW.
  FRESH   — the one-model exception: the agent ran on a model a resume would not run on. A resume runs on
            the model the DISPATCH named (the Agent call's `model`, recorded in the agent's meta.json and read
            as the row's `dispatched`; read from older transcripts on this machine: two security seats
            dispatched on Fable, whose definition then pinned opus, died at the session limit and were resumed
            while their session ran Opus, and both answered on Fable 5.1), else
            on the model its definition pins (a sonnet-pinned agent in an Opus session answered on Sonnet
            before and after a resume), else on the session's CURRENT model (an agent dispatched with no model
            resumed from Fable 5.1 onto Opus 5.5). So an agent that ran on that model RESUMEs; one that ran on
            another would finish on a different one: seat a fresh agent of the same type ON THE AGENT'S MODEL.
            An unreadable session model counts as no change, and the reason says so.
  FRESH   — the failed-resume exception: the agent was marked `resumed` for an earlier death and has
            made no live model call since that death, so the resume did not take. A new death at a logout is
            never a failed resume (a logout happens during an account switch while the agent is running),
            nor one at a limit or on a server-side transient (an overload, a 500) — on the same reasoning:
            dying of those says nothing about whether the resume works — so it RESUMEs again after the reset,
            the re-login or the overload.
  For a FRESH row: brief the fresh agent with this tool's digest (the original brief verbatim + every
  text block and tool call), then mark the dead one `fresh` here so the detector stops naming it.

Subcommands:
  scan   [--sid SID] [--json] [--hook] [--all]  list the unrecovered deaths since DETECTION_EPOCH, with
                                           the decision per agent; --all adds the marked and the older ones
  SID is the full session id or any prefix naming one session (the 8-hex form); none or several → exit 2
  digest <agent-id> [--sid SID] [--out P]  write the takeover digest for one dead agent
  mark   <agent-id>... --as fresh|dropped|resumed [--sid SID] [--note TEXT]
  --self-test                              synthetic transcripts for every row of the table

`--hook` prints ONE UserPromptSubmit hookSpecificOutput document when something is unrecovered,
nothing otherwise (`.claude/hooks/limit-recovery-check.sh` wraps it). Reads: the session's
subagents directory, the per-agent meta.json, `.claude/state/limit-recovery-<sid8>.json` (what was
already handled). Writes: that state file on `mark`, the digest file on `digest`. Never git.
Agent ids appear in this tool's output, which reaches the orchestrator only — never in a message
to the owner or a committed file.

Env for tests: LIMIT_RECOVERY_SUBAGENTS_DIR (the transcript dir), LIMIT_RECOVERY_STATE_DIR,
LIMIT_RECOVERY_NOW (epoch seconds), LIMIT_RECOVERY_SESSION_MODEL (the session's current model),
LIMIT_RECOVERY_AGENTS_DIR (the agent definitions read for a `model:` pin), LIMIT_RECOVERY_PROJECT_DIR (the
directory holding each session's transcript and its subagents directory, for the --sid prefix arms).
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import sys
import tempfile
import time

CACHE_WARM_MINUTES = 5
# Resume or replace a dead agent. The rule: always resume, except for a model change or a failed resume
# (the docstring). Measured over this repository's transcripts, counting
# each model call once: a cold resume rewrites the dead agent's whole context once (two live resumes wrote
# 398,815 and 261,204 tokens and read none; the second is 24% more than its last live call carried, cause
# not found — not trailing tool results, not a grown dispatch payload), at 1.25 cost units per token; the
# four fresh readers that took over dead ones spent 1.75-2.2 units per token of their predecessor's context
# re-reading their way back to it, so a resume came out roughly 30-45% cheaper at a 0.1 cache-read weight
# (write 1.25; per token the dead agent carried, the rewrite cost 1.25-1.55, so about 10-45%; at a 0.05 read
# weight, the read price recorded for Opus 5.5, about 17-34% per token of the predecessor's context and
# from about break-even to a third per token the dead agent carried; the subscription
# meter's weights are unmeasured). Quality was not compared. A room line (resume only below the compaction
# point less 300,000) stood briefly and was dropped: all four fresh takers ended LARGER than
# the agent they replaced (378k -> 486k, 714k -> 719k, 450k -> 487k, 399k -> 450k context tokens; all eight
# on Fable 5.1 at effort high), so a fresh seat re-grows to the same size and buys no room — only cost.
# Revisit if a fresh takeover ever finishes clearly SMALLER than the agent it replaced.


def session_model(sid: str) -> str | None:
    """The model the session runs now — the one a resume runs on: LIMIT_RECOVERY_SESSION_MODEL, else the
    newest real model in the tail of the session's own transcript (`<sid>.jsonl` beside its subagents dir).
    None when unreadable; the caller reads None as no change and says so."""
    env = os.environ.get("LIMIT_RECOVERY_SESSION_MODEL")
    if env is not None:
        return env or None
    p = os.path.dirname(subagents_dir(sid)) + ".jsonl"
    # a session's tail can hold one record larger than TAIL_BYTES after its last reply (the SessionStart
    # injection is ~95 KB; a large tool result), so a miss widens the read once before reading as unread
    for n in (TAIL_BYTES, SESSION_TAIL_MAX_BYTES):
        try:
            recs, size = _tail_records(p, n), os.path.getsize(p)
        except OSError:
            return None
        for r in reversed(recs):
            m = (r.get("message") or {}).get("model") if r.get("type") == "assistant" else None
            if isinstance(m, str) and m.startswith("claude-"):
                return m
        if size <= n:
            break
    return None


# The detector's start: deaths before it are not named. A death before it was
# handled by hand or not at all, and nothing records which, so naming it would send a seat to re-seat
# work finished days ago — the spend the procedure exists to avoid. Measured the hour after the hook
# went live: 273 unmarked pre-tool deaths across the fleet's sessions, 0 since, and the hook naming
# them on every prompt of every session that had any. `scan --all` still lists them, flagged.
DETECTION_EPOCH = "2026-10-12T04:14:08Z"
TAIL_BYTES = 65_536
SESSION_TAIL_MAX_BYTES = 4 << 20  # session_model()'s second read, only when TAIL_BYTES held no assistant record
# The tool_use SHAPE, not the bare name: the harness writes its whole tool catalogue into an
# attachment record of every transcript (`"name":"SubagentHandback","description":…`), so the bare
# name matched 7 of 7 transcripts on the first run, dead ones included.
HANDBACK_TOKEN = b'"name":"SubagentHandback","input"'
LIMIT_SHAPES = (
    "session limit", "fable limit", "usage limit", "rate_limit", "rate limit", "429",
    "usage-credits", "limit ·", "limit ∙", "limit reached",
)
AUTH_SHAPES = ("not logged in", "oauth token", "authentication_failed", "authentication_error", "/login")
# Checked before the limit shapes: its own text carries "(limit 200000)" and token counts, and a count can
# contain "429" (measured text: "Prompt is too long · the request is ~219096 tokens (limit 200000) …").
# "context limit": the API's "exceed context limit: N + M > W" and the harness's "Context limit reached" (not
# measured on this machine).
OVERFLOW_SHAPES = ("prompt is too long", "context limit")
# A server-side error says nothing about whether a resume works (a 529 re-death resumed fine once the overload
# cleared), so like a limit it is never a failed resume.
TRANSIENT_SHAPES = ("overloaded", "internal server error", "connection error", "request timed out")
# An agent that died at its OWN model's limit. The rule: when a helper on Opus hits a limit, there is no other
# model with room, so it waits for the reset; when a helper on Fable hits Fable's own weekly limit, which is not a
# session limit, it moves straight to Opus. So a family named
# here MOVES at once to a fresh seat on the family it maps to, no owner word needed; every other family WAITs for
# that limit's reset. A session-limit death is never a model limit (`_model_limit`), so it stays RESUME after the
# reset. This dict is the one place the rule lives: decide() and hook_doc() read it, the self-test pins it.
MODEL_LIMIT_MOVES = {"fable": "opus"}

HERE = os.path.dirname(os.path.abspath(__file__))


def _sid8(sid: str) -> str:
    return (sid or "")[:8]


def _repo_root() -> str:
    return os.path.abspath(os.path.join(HERE, os.pardir))


def _project_base() -> str:
    env = os.environ.get("LIMIT_RECOVERY_PROJECT_DIR")
    if env:
        return env
    sys.path.insert(0, HERE)
    try:
        from session_status import project_key_dir  # type: ignore
        return project_key_dir(_repo_root())
    except Exception:
        key = _repo_root().replace("/", "-")
        return os.path.join(os.path.expanduser("~"), ".claude", "projects", key)


def subagents_dir(sid: str) -> str:
    env = os.environ.get("LIMIT_RECOVERY_SUBAGENTS_DIR")
    if env:
        return env
    return os.path.join(_project_base(), sid, "subagents")


# a session id is a UUID; the project directory also holds non-session entries (the `memory` link), which a
# prefix such as `me` must never resolve to: that scan reads empty and prints the false all-clear resolve_sid ends
_SID_SHAPE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def resolve_sid(sid: str) -> tuple[str, str | None]:
    """(the session id to read, an error or None). A full id passes through; a shorter one, such as the 8-hex
    form every readout prints, resolves to the one session it prefixes. No match or several is an error, never
    an empty scan: an 8-hex prefix once went into the path as given, found no directory and printed
    "no unrecovered sub-agent deaths" while a plain `scan` listed the death. A session that never
    dispatched a helper still has its transcript, so it resolves and scans empty, which is then the truth."""
    if not sid:
        return sid, "no session id (--sid or CLAUDE_CODE_SESSION_ID)"
    if os.environ.get("LIMIT_RECOVERY_SUBAGENTS_DIR"):  # a test fixture names the directory itself
        return sid, None
    base = _project_base()
    if _SID_SHAPE.fullmatch(sid) and (os.path.isdir(os.path.join(base, sid))
                                      or os.path.isfile(os.path.join(base, sid + ".jsonl"))):
        return sid, None
    try:
        names = os.listdir(base)
    except OSError as e:
        return sid, f"cannot list the session directory {base}: {e.strerror or e}"
    found = sorted({n[:-len(".jsonl")] if n.endswith(".jsonl") else n for n in names
                    if n.startswith(sid) and (n.endswith(".jsonl") or os.path.isdir(os.path.join(base, n)))})
    found = [n for n in found if _SID_SHAPE.fullmatch(n)]
    if len(found) == 1:
        return found[0], None
    if not found:
        return sid, f"no session starts with {sid!r} in {base}"
    return sid, f"{sid!r} matches {len(found)} sessions ({', '.join(found)}): give more of the id"


def state_path(sid: str) -> str:
    d = os.environ.get("LIMIT_RECOVERY_STATE_DIR") or os.path.join(_repo_root(), ".claude", "state")
    return os.path.join(d, f"limit-recovery-{_sid8(sid)}.json")


def _now() -> float:
    env = os.environ.get("LIMIT_RECOVERY_NOW")
    return float(env) if env else time.time()


def _parse_ts(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        from datetime import datetime, timezone
        return datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return None


def _tail_records(path: str, nbytes: int = TAIL_BYTES) -> list[dict]:
    size = os.path.getsize(path)
    with io.open(path, "rb") as f:
        if size > nbytes:
            f.seek(size - nbytes)
            f.readline()  # drop the partial first line
        raw = f.read()
    out = []
    for line in raw.split(b"\n"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if isinstance(r, dict):  # a non-object line must not crash the scan and silence every sibling
            out.append(r)
    return out


def _tail_handback(recs: list[dict]) -> bool:
    """A SubagentHandback tool_use in the tail records: the hand-back sits just before the error."""
    return any(b.get("type") == "tool_use" and b.get("name") == "SubagentHandback"
               for r in recs if r.get("type") == "assistant" for b in _content(r))


def _has_handback(path: str) -> bool:
    with io.open(path, "rb") as f:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                return False
            if HANDBACK_TOKEN in chunk:
                return True
            # a token split across chunk boundaries: step back by its length
            if len(chunk) == 1 << 20:
                f.seek(f.tell() - len(HANDBACK_TOKEN))


def _content(rec: dict) -> list[dict]:
    m = rec.get("message") or {}
    c = m.get("content") if isinstance(m, dict) else None
    if isinstance(c, list):
        return c
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    return []


def _error_text(rec: dict) -> str:
    return " ".join(b.get("text", "") for b in _content(rec) if b.get("type") == "text").strip()


def classify_error(text: str) -> str:
    t = text.lower()
    if any(s in t for s in OVERFLOW_SHAPES):
        return "overflow"
    if any(s in t for s in LIMIT_SHAPES):
        return "limit"
    if any(s in t for s in AUTH_SHAPES):
        return "auth"
    if any(s in t for s in TRANSIENT_SHAPES):
        return "transient"
    return "api-error"


def _count_work(path: str) -> tuple[int, float | None, int | None, str | None]:
    """(tool calls, epoch of the last NON-error assistant record, the context tokens of the last live record that
    carries a positive, well-formed usage block — input + cache write + cache read, None when no live record has
    one — and the model of the last live record that names a real model)."""
    tools = 0
    last_live = None
    last_ctx = None
    last_model = None
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"type":"assistant"' not in line and '"type": "assistant"' not in line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("type") != "assistant":
                continue
            if r.get("isApiErrorMessage"):
                continue
            last_live = _parse_ts(r.get("timestamp")) or last_live
            msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            if isinstance(msg.get("model"), str) and msg["model"].startswith("claude-"):
                last_model = msg["model"]  # the model the agent last ran on, with or without a usage block
            u = msg.get("usage") if isinstance(msg.get("usage"), dict) else None
            vals = [(u or {}).get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")]
            # a malformed count skips the record (never read as small, never a crash that silences every death)
            if u and all(isinstance(v, int) and not isinstance(v, bool) for v in vals) and sum(vals) > 0:
                last_ctx = sum(vals)
            for b in _content(r):
                if b.get("type") == "tool_use":
                    tools += 1
    return tools, last_live, last_ctx, last_model


NO_TS = "<no timestamp>"  # a death record without one is still a death, and its mark must still match it


def _death_key(rec: dict) -> str:
    return rec.get("timestamp") or NO_TS


def _death_ts(sid: str, agent_id: str) -> str | None:
    """The key of the death a mark covers (its timestamp, or NO_TS), None when the transcript does not end in
    a death. Raises OSError when the transcript is missing or unreadable: the caller names that reason."""
    p = os.path.join(subagents_dir(sid), f"agent-{agent_id}.jsonl")
    for r in reversed(_tail_records(p)):
        if r.get("type") == "assistant":
            return _death_key(r) if r.get("isApiErrorMessage") else None
    return None


def _model_limit(err: str, model: str | None) -> bool:
    """The death was the agent's OWN model's limit: its family ("fable" in claude-fable-5-1) names the limit in
    one clause ("your Fable limit", "your Fable 5.1 limit", "your weekly Opus limit", "Opus weekly limit"), so an
    account-wide limit ("your session limit", "your weekly limit") or another model's never reads as this one's. A
    clause that names the session ("your Fable session limit", unmeasured) is the session limit, never the model's
    own (the model-limit rule covers only a limit that is not a session one), so it resumes after the reset."""
    fam = _family(model)
    m = re.search(rf"\b{re.escape(fam)}\b[\w .]{{0,24}}?\blimit\b", err, re.I) if fam.isalpha() else None
    return m is not None and re.search(r"\bsession\b", m.group(0), re.I) is None


def _family(model: str | None) -> str:
    """claude-sonnet-5-5 -> "sonnet"; an alias ("sonnet") is its own family."""
    parts = (model or "").lower().split("-")
    return parts[1] if len(parts) > 1 and parts[0] == "claude" else parts[0]


def agent_pin(agent_type: str | None) -> str | None:
    """The `model:` an agent definition pins (.claude/agents/<type>.md frontmatter), or None. A resume of a pinned
    agent runs on the pin, not the session's model (measured: a sonnet-pinned agent in an Opus
    session answered on Sonnet before and after a SendMessage resume), so the pin is what a resume is compared to."""
    if not agent_type or "/" in agent_type:
        return None
    try:
        agents = os.environ.get("LIMIT_RECOVERY_AGENTS_DIR") or os.path.join(_repo_root(), ".claude", "agents")
        with io.open(os.path.join(agents, f"{agent_type}.md"), encoding="utf-8") as f:
            head = f.read(4096)
    except OSError:
        return None
    m = re.match(r"---\n(.*?)\n---", head, re.S)
    pin = re.search(r"^model:\s*([\w.-]+)\s*$", m.group(1), re.M) if m else None
    return pin.group(1) if pin and pin.group(1).lower() != "inherit" else None


def is_warm(age_min: float | None) -> bool:
    """The one spelling of the warm-cache comparison; decide() and hook_doc() both read it."""
    return age_min is not None and age_min <= CACHE_WARM_MINUTES


def decide(dead: dict) -> tuple[str, str]:
    """Returns (action, reason) for one death row. Pure: reads only the row."""
    if dead["handback"]:
        return "BANKED", "a SubagentHandback exists in the transcript; collect the hand-back"
    age = dead["cache_age_min"]
    cache = (f"cache warm: last model call {age:.0f} min ago (≤ {CACHE_WARM_MINUTES}), so the resume pays only the increment"
             if is_warm(age) else
             f"cache cold ({'unknown age' if age is None else f'{age:.0f} min'}), so the resume rewrites it once")
    ctx = dead.get("context_tokens")
    size = "context unmeasured (no usage record)" if ctx is None else f"{ctx:,} tokens of context"
    model, smodel = dead.get("model"), dead.get("session_model")
    fresh = f"seat a fresh {dead['agent_type']} over the digest, then mark this id fresh"
    pin, named = dead.get("pinned"), dead.get("dispatched")
    # THE precedence, stated once: a resume runs on the dispatch's model (meta.json), else the definition's pin, else
    # the session's current model (code.claude.com/docs/en/sub-agents, "Model resolution order"; the pin and session
    # legs measured live, the dispatch leg read from older transcripts, as the docstring says).
    # A named or pinned alias resolves within its family; the session's model is compared exactly. same=None: unread.
    fixed = named or pin
    fixed_by = f"the dispatch named {named}" if named else f"its definition pins {pin}" if pin else ""
    target = fixed or smodel
    same = None if not (target and model) else (_family(target) == _family(model) if fixed else target == model)
    if dead.get("error_class") == "overflow":
        return "FRESH", ("its context does not fit its model's window (prompt is too long): a resume re-sends the same "
                         "context and fails the same way, and a fresh seat on the same model carries the same system "
                         f"prompt and tools; {fresh}, ON A MODEL WITH A LARGER CONTEXT WINDOW than {model or 'the one it ran on'}")
    if dead.get("model_limit"):
        # the one place a resume cannot run: its own model is at its limit. Say what happens AFTER the reset, so the
        # row is never read as "resume now"; `scan` reads no clock, so the row stays WAIT after the reset and the
        # reason carries the error, which names the reset when the harness gives one
        said = f'. The error, for the reset it names: "{dead["error"]}"' if dead.get("error") else ""
        moves_to = MODEL_LIMIT_MOVES.get(_family(model))
        if moves_to:
            return "FRESH", (f"it died at {model}'s own limit, a weekly limit and not the session one, so it moves to "
                             f"{moves_to} at once, no owner word needed; {fresh}, ON {moves_to}"
                             f"{said}")
        if same:
            after = (f"resume it ({fixed_by}, so the resume runs on {model})" if fixed
                     else f"resume it (the session runs {model})")
        elif same is None:
            after = f"resume it if the session runs {model} (SESSION MODEL UNREAD), otherwise {fresh}, ON {model}"
        else:
            after = f"{fresh}, ON {model} (a resume would run on {target})"
        # The no-room reason is about Opus (a limit on Opus leaves no other model with room); for another
        # family (Sonnet) it can be false, so that WAIT says only what the rule says: Fable alone moves
        why = ("no other model has room for it" if _family(model) == "opus"
               else "only a Fable agent moves to another model at once")
        return "WAIT", (f"it died at {model}'s own limit, so it cannot run on {model} until that limit resets, and {why}"
                        f": do not resume it now. After the reset: {after}{said}")
    if dead.get("resume_failed"):
        return "FRESH", (f"the resume failed: marked resumed for an earlier death, no live model call since; {fresh}"
                         + (f", ON {model}" if model else ""))
    if model and fixed:
        if same:
            return "RESUME", (f"{cache}; {size}; {fixed_by}, and a resume runs on that model, the one it died on ({model})")
        return "FRESH", (f"{fixed_by} but it ran on {model}, so a resume would change its model; "
                         f"{fresh}, ON {model}")
    if same is False:
        return "FRESH", (f"model change: it ran on {model}, the session now runs {smodel}, and a resume runs on the "
                         f"session's model; {fresh}, ON {model}")
    if model and not smodel:
        return "RESUME", (f"{cache}; {size}; SESSION MODEL UNREAD: resume only after confirming the session runs {model}, "
                          f"otherwise {fresh} on {model}")
    return "RESUME", (f"{cache}; {size}; a resume keeps the agent's own work and runs on the session's model "
                      f"({smodel or 'unread'}; the agent ran on {model or 'an unrecorded model'})")


def load_state(sid: str) -> dict:
    p = state_path(sid)
    if not os.path.exists(p):
        return {}
    try:
        return json.load(io.open(p, encoding="utf-8"))
    except Exception:
        return {}


def save_state(sid: str, state: dict) -> None:
    p = state_path(sid)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".lr-")
    with io.open(fd, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1, sort_keys=True)
    os.replace(tmp, p)


def scan(sid: str, include_handled: bool = False, include_old: bool = False,
         skip_banked: bool = False) -> list[dict]:
    d = subagents_dir(sid)
    if not os.path.isdir(d):
        return []
    handled = load_state(sid)
    now = _now()
    epoch = _parse_ts(DETECTION_EPOCH)
    smodel, smodel_read = None, False  # read on the first death only: the hook scans on every prompt
    rows = []
    for name in sorted(os.listdir(d)):
        if not (name.startswith("agent-") and name.endswith(".jsonl")):
            continue
        agent_id = name[len("agent-"):-len(".jsonl")]
        path = os.path.join(d, name)
        try:
            recs = _tail_records(path)
        except OSError:  # unreadable or vanished: skip this one, never the whole session
            continue
        last_asst = None
        for r in reversed(recs):
            if r.get("type") == "assistant":
                last_asst = r
                break
        if not last_asst or not last_asst.get("isApiErrorMessage"):
            continue
        mark = prior = handled.get(agent_id)
        # a mark covers the death it was written for; a later death of the same agent (a resumed seat that
        # died again) is named again, and its row carries no mark. A mark with no died_at (written before
        # marks recorded the death) covers every death of that agent; `mark` no longer writes one.
        if mark and mark.get("died_at") not in (None, _death_key(last_asst)):
            mark = None
        if mark and not include_handled:
            continue
        died = _parse_ts(last_asst.get("timestamp"))
        # an unreadable timestamp stays listed: the cutoff may only hide a death it can date
        pre_epoch = died is not None and epoch is not None and died < epoch
        if pre_epoch and not include_old:
            continue
        # the hook never names a BANKED row and nothing marks one, so without this every prompt re-reads it whole
        handback = _tail_handback(recs) or _has_handback(path)
        if handback and skip_banked:
            continue
        meta = {}
        mp = os.path.join(d, f"agent-{agent_id}.meta.json")
        if os.path.exists(mp):
            try:
                meta = json.load(io.open(mp, encoding="utf-8"))
            except Exception:
                meta = {}
        err = _error_text(last_asst)
        tools, last_live, last_ctx, last_model = _count_work(path)
        if not smodel_read:
            smodel, smodel_read = session_model(sid), True
        # a resume that did not take: the earlier death was marked resumed and no live call came after it
        prior_died = _parse_ts(prior.get("died_at")) if (prior and prior is not mark and prior.get("as") == "resumed") else None
        # a re-death at a limit or a logout is the limit's failure, not the resume's (a logout is not a failed
        # resume): a fresh seat dies the same way, so it waits for the reset and resumes again
        # (SKILL.md § Boundaries, "Not a retry loop"). A model-limit text the limit shapes miss counts as a limit, and
        # a server-side transient (an overload, a 500) says nothing about the resume either.
        model_limit = _model_limit(err, last_model)
        resume_failed = (prior_died is not None and (last_live is None or last_live <= prior_died)
                         and classify_error(err) not in ("limit", "auth", "transient") and not model_limit)
        row = {
            "agent_id": agent_id,
            "description": meta.get("description") or "",
            "agent_type": meta.get("agentType") or "general-purpose",
            "died_at": last_asst.get("timestamp"),
            "error": err[:160],
            "error_class": classify_error(err),
            "bytes": os.path.getsize(path),
            "context_tokens": last_ctx,
            "model": last_model,
            "session_model": smodel,
            "model_limit": model_limit,
            "pinned": agent_pin(meta.get("agentType")),
            # the Agent call's model as the harness recorded it; "inherit" (or none) means the dispatch named none
            "dispatched": (meta.get("model") if isinstance(meta.get("model"), str)
                           and meta.get("model") not in ("", "inherit") else None),
            "resume_failed": resume_failed,
            "tool_calls": tools,
            "cache_age_min": (None if last_live is None else max(0.0, (now - last_live) / 60.0)),
            "handback": handback,
            "handled": mark,
            "pre_epoch": pre_epoch,
            "transcript": path,
        }
        row["action"], row["reason"] = decide(row)
        rows.append(row)
    return rows


def digest(sid: str, agent_id: str, out: str | None = None) -> str:
    path = os.path.join(subagents_dir(sid), f"agent-{agent_id}.jsonl")
    recs = []
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except Exception:
                continue
    first = None
    for r in recs:
        if r.get("type") == "user":
            for b in _content(r):
                if b.get("type") == "text":
                    first = b["text"]
                    break
            if first is not None:
                break
    lines = ["# ORIGINAL BRIEF (the dead agent's first user message, verbatim; it binds the taker-over in full)",
             "", first or "<none>", "",
             "# PROGRESS — every assistant text block and every tool call, in order", ""]
    n = 0
    err = ""
    for r in recs:
        if r.get("type") != "assistant":
            continue
        if r.get("isApiErrorMessage"):
            err = _error_text(r)
            continue
        for b in _content(r):
            if b.get("type") == "text" and b.get("text", "").strip():
                lines.append("[text] " + b["text"].strip())
            elif b.get("type") == "tool_use":
                n += 1
                inp = b.get("input") or {}
                s = inp.get("command") or inp.get("file_path") or inp.get("pattern") or json.dumps(inp)
                lines.append("[tool %d] %s: %s" % (n, b.get("name"), str(s)[:300].replace("\n", " ")))
    lines += ["", f"# END — the agent died here with: {err or '<no error text>'}; tool calls: {n}",
              "# The taker-over re-reads what it needs: these reads are not in its context. Scratch files the",
              "# predecessor wrote (paths above) can be reopened; its unfinished conclusions are never verdicts."]
    text = "\n".join(lines) + "\n"
    if out:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        io.open(out, "w", encoding="utf-8").write(text)
    return text


def hook_doc(rows: list[dict]) -> str | None:
    live = [r for r in rows if r["action"] != "BANKED"]
    if not live:
        return None
    parts = []
    for r in live:
        age = "unknown age" if r["cache_age_min"] is None else f"cold {r['cache_age_min']:.0f} min"
        if is_warm(r["cache_age_min"]):
            age = f"warm {r['cache_age_min']:.0f} min"
        size = (f"{r['context_tokens']:,} tokens" if r.get("context_tokens") is not None
                else f"{r['bytes']:,} B, no token count")
        parts.append(f"«{r['description'] or r['agent_id']}» ({r['agent_type']}, {r['error_class']} at "
                     f"{(r['died_at'] or '?')[11:16]}Z, {r['tool_calls']} tool calls, {size}, {age}) → {r['action']}"
                     + (" (SESSION MODEL UNREAD: confirm the session runs " + r["model"] + " first)"
                        if r["action"] == "RESUME" and "SESSION MODEL UNREAD" in r["reason"] else ""))
    n = len(live)
    ctx = (f"⚠️ LIMIT RECOVERY — {n} sub-agent{'s' if n != 1 else ''} of this session died at an API limit or the "
           f"auth error a limit hit cascades into, and no recovery is recorded: " + "; ".join(parts) +
           ". Run /limit-recovery (it resumes each dead agent, or seats a fresh one over its digest where a resume "
           "would run on another model, the context does not fit its model, or its resume failed, and records what it "
           "did). "
           + "WAIT means the agent's own model is at its limit: nothing runs on it until that limit resets (on Opus "
           "no other model has room; " + "; ".join(f"a {k.capitalize()} agent at {k.capitalize()}'s own limit is FRESH on "
                                             f"{v.capitalize()} at once instead" for k, v in MODEL_LIMIT_MOVES.items()) + "). "
           + "A deliberate drop: `python3 scripts/limit-recovery.py mark <id> --as dropped`. Never report a dead "
           "agent's work as done, and never resume one the table says FRESH"
           + ", or WAIT before its model's limit resets.")
    return json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ctx}})


def _print_rows(rows: list[dict]) -> None:
    if not rows:
        print("limit-recovery: no unrecovered sub-agent deaths")
        return
    for r in rows:
        age = "?" if r["cache_age_min"] is None else f"{r['cache_age_min']:.0f}m"
        ctx = "?" if r.get("context_tokens") is None else f"{r['context_tokens']:,}"
        print(f"{r['action']:7} {r['agent_id']}  {r['agent_type']}  «{r['description']}»  {r['error_class']} "
              f"{(r['died_at'] or '?')[:19]}  tools={r['tool_calls']} context={ctx} bytes={r['bytes']:,} cache-age={age}"
              + (f"  handled={r['handled']['as']}" if r.get("handled") else "")
              + ("  pre-epoch" if r.get("pre_epoch") else ""))
        print(f"        {r['reason']}")


# ----------------------------------------------------------------------------------------------
# self-test

def _write_jsonl(path: str, recs: list[dict]) -> None:
    with io.open(path, "w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


def _asst(ts: str, blocks: list[dict], err: bool = False) -> dict:
    r = {"type": "assistant", "timestamp": ts, "message": {"content": blocks, "model": "<synthetic>" if err else "m"}}
    if err:
        r["isApiErrorMessage"] = True
    return r


def self_test() -> int:
    fails = 0

    def check(name, cond):
        nonlocal fails
        print(("PASS " if cond else "FAIL ") + name)
        if not cond:
            fails += 1

    d = tempfile.mkdtemp(prefix="lr-")
    sub = os.path.join(d, "sub")
    os.makedirs(sub)
    os.environ["LIMIT_RECOVERY_SUBAGENTS_DIR"] = sub
    os.environ["LIMIT_RECOVERY_STATE_DIR"] = os.path.join(d, "state")
    # agent definitions for the pin arms; every other fixture type has no definition here, so it reads unpinned
    agents = os.path.join(d, "agents")
    os.makedirs(agents)
    os.environ["LIMIT_RECOVERY_AGENTS_DIR"] = agents
    for name, pin in (("pinned-sonnet", "sonnet"), ("pinned-opus", "opus"), ("inherits", "inherit")):
        io.open(os.path.join(agents, f"{name}.md"), "w").write(f"---\nname: {name}\nmodel: {pin}\n---\nbody\n")
    io.open(os.path.join(agents, "no-front.md"), "w").write("model: sonnet\nno frontmatter here\n")
    now = 1_791_784_000  # after DETECTION_EPOCH, so every fixture death below is in range
    os.environ["LIMIT_RECOVERY_NOW"] = str(now)
    # pin the session's model so no arm reads a real session transcript
    os.environ["LIMIT_RECOVERY_SESSION_MODEL"] = "claude-opus-5-5"
    from datetime import datetime, timezone

    def ts(delta_min):
        return datetime.fromtimestamp(now - delta_min * 60, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    brief = {"type": "user", "timestamp": ts(60), "message": {"content": [{"type": "text", "text": "BRIEF: read file X"}]}}
    tool = {"type": "tool_use", "name": "Read", "input": {"file_path": "/x"}, "id": "t1"}
    big_text = {"type": "text", "text": "y" * 200_000}

    # (1) warm death at a limit → RESUME, tool calls counted, error class limit
    _write_jsonl(os.path.join(sub, "agent-warm1.jsonl"), [brief, _asst(ts(3), [tool]), _asst(ts(3), [{"type": "text", "text": "You've hit your session limit · resets 9:10am"}], err=True)])
    json.dump({"agentType": "general-purpose", "description": "warm reader"}, io.open(os.path.join(sub, "agent-warm1.meta.json"), "w"))
    # (2) cold + small (auth error) → RESUME
    _write_jsonl(os.path.join(sub, "agent-cold2.jsonl"), [brief, _asst(ts(30), [tool]), _asst(ts(30), [{"type": "text", "text": "Not logged in · Please run /login"}], err=True)])
    # (3) cold + large → RESUME (size never decides)
    _write_jsonl(os.path.join(sub, "agent-cold3.jsonl"), [brief] + [_asst(ts(40), [big_text, tool])] * 3 + [_asst(ts(40), [{"type": "text", "text": "API Error: OAuth token has been revoked"}], err=True)])
    json.dump({"agentType": "qa-expert", "description": "big reader"}, io.open(os.path.join(sub, "agent-cold3.meta.json"), "w"))
    # (4) handed back, then an error → BANKED
    _write_jsonl(os.path.join(sub, "agent-done4.jsonl"), [brief, _asst(ts(20), [{"type": "tool_use", "name": "SubagentHandback", "input": {"report": "FILE x"}, "id": "h"}]), _asst(ts(19), [{"type": "text", "text": "rate_limit"}], err=True)])
    # (5) alive: last record is a normal assistant record → not listed
    _write_jsonl(os.path.join(sub, "agent-alive5.jsonl"), [brief, _asst(ts(1), [tool])])
    # (6) resumed after a death: records after the error → not listed (self-clearing)
    _write_jsonl(os.path.join(sub, "agent-resumed6.jsonl"), [brief, _asst(ts(10), [{"type": "text", "text": "You've reached your Fable limit"}], err=True), {"type": "user", "timestamp": ts(2), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(1), [tool])])

    rows = {r["agent_id"]: r for r in scan("selftest-sid")}
    check("alive agent not listed", "alive5" not in rows)
    check("resumed agent self-clears", "resumed6" not in rows)
    check("four deaths found", sorted(rows) == ["cold2", "cold3", "done4", "warm1"])
    check("warm limit death → RESUME", rows["warm1"]["action"] == "RESUME" and rows["warm1"]["error_class"] == "limit")
    check("warm death counts its tool calls", rows["warm1"]["tool_calls"] == 1)
    check("meta.json read", rows["warm1"]["description"] == "warm reader")
    check("cold small auth death → RESUME", rows["cold2"]["action"] == "RESUME" and rows["cold2"]["error_class"] == "auth")
    check("cold large death → RESUME (size never decides)", rows["cold3"]["action"] == "RESUME" and rows["cold3"]["bytes"] > 500_000)
    check("handed-back then errored → BANKED", rows["done4"]["action"] == "BANKED")
    # negative control from the real shape: the harness tool catalogue names SubagentHandback in an
    # attachment record of EVERY transcript; that must not read as a hand-back (first run: 7 of 7 BANKED)
    _write_jsonl(os.path.join(sub, "agent-catalog7.jsonl"), [brief, {"type": "attachment", "timestamp": ts(50), "attachment": {"tools": [{"name": "SubagentHandback", "description": "hand back"}]}}, _asst(ts(45), [big_text, tool]) , _asst(ts(45), [big_text, tool]), _asst(ts(45), [big_text, tool]), _asst(ts(44), [{"type": "text", "text": "You've hit your session limit"}], err=True)])
    rows7 = {r["agent_id"]: r for r in scan("selftest-sid")}
    check("tool catalogue naming SubagentHandback is not a hand-back", rows7["catalog7"]["action"] == "RESUME" and not rows7["catalog7"]["handback"])
    # the cutoff: a death before DETECTION_EPOCH is not named (it was handled by hand or not at all, and
    # nothing records which); --all still lists it, flagged; an undatable death stays named
    _write_jsonl(os.path.join(sub, "agent-old8.jsonl"), [brief, _asst(ts(150), [tool]), _asst(ts(150), [{"type": "text", "text": "You've hit your session limit"}], err=True)])
    _write_jsonl(os.path.join(sub, "agent-nodate9.jsonl"), [brief, _asst("not-a-date", [tool]), _asst("not-a-date", [{"type": "text", "text": "You've hit your session limit"}], err=True)])
    # a death AT the epoch is in range (only an earlier one is hidden); the cache age reads the last LIVE call, not the error
    _write_jsonl(os.path.join(sub, "agent-edge10.jsonl"), [brief, _asst(DETECTION_EPOCH.replace("Z", ".000Z"), [tool]), _asst(DETECTION_EPOCH.replace("Z", ".000Z"), [{"type": "text", "text": "rate_limit"}], err=True)])
    _write_jsonl(os.path.join(sub, "agent-late11.jsonl"), [brief, _asst(ts(12), [tool]), _asst(ts(2), [{"type": "text", "text": "rate_limit"}], err=True)])
    check("fixture clock sanity: the old death is before DETECTION_EPOCH and now is after it", _parse_ts(ts(150)) < _parse_ts(DETECTION_EPOCH) < now)
    rows8 = {r["agent_id"]: r for r in scan("selftest-sid")}
    check("death before DETECTION_EPOCH is not named", "old8" not in rows8 and "warm1" in rows8)
    check("hook doc never names a death before DETECTION_EPOCH", "old8" not in (hook_doc(list(rows8.values())) or ""))
    rows8all = {r["agent_id"]: r for r in scan("selftest-sid", include_old=True)}
    check("death before DETECTION_EPOCH listed with include_old, flagged pre_epoch", rows8all.get("old8", {}).get("pre_epoch") is True and rows8all["warm1"]["pre_epoch"] is False)
    check("a death with an undatable timestamp stays named (the cutoff hides only what it can date)", "nodate9" in rows8 and rows8["nodate9"]["pre_epoch"] is False)
    check("a death exactly at DETECTION_EPOCH is named (the cutoff is strict)", "edge10" in rows8)
    check("cache age reads the last live call, not the later error record", rows8["late11"]["cache_age_min"] >= 11)
    # warmth only changes the reason: at exactly CACHE_WARM_MINUTES the cache reads warm, just past it cold
    rb = dict(rows["cold3"]); rb["cache_age_min"] = float(CACHE_WARM_MINUTES)
    check("at exactly CACHE_WARM_MINUTES → RESUME, cache warm (inclusive)", decide(rb)[0] == "RESUME" and "cache warm" in decide(rb)[1])
    rb["cache_age_min"] = CACHE_WARM_MINUTES + 0.5
    check("just past CACHE_WARM_MINUTES → RESUME, cache cold", decide(rb)[0] == "RESUME" and "cache cold" in decide(rb)[1])
    # measured contexts (always resume, so a measured size is reported, never decisive)
    def _asst_u(ts_, blocks, ctx, model="claude-opus-5-5"):
        r = _asst(ts_, blocks)
        r["message"]["model"] = model
        r["message"]["usage"] = {"input_tokens": 2, "cache_creation_input_tokens": 1000,
                                 "cache_read_input_tokens": ctx - 1002, "output_tokens": 50}
        return r
    zero_err = _asst(ts(40), [{"type": "text", "text": "You've hit your session limit"}], err=True)
    zero_err["message"]["usage"] = {"input_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 0}
    _write_jsonl(os.path.join(sub, "agent-tok12.jsonl"), [brief] + [_asst_u(ts(40), [big_text, tool], 400_000)] * 3 + [zero_err])
    zero_live = _asst(ts(40), [{"type": "text", "text": "ok"}])
    zero_live["message"]["usage"] = dict(zero_err["message"]["usage"])
    # an earlier, larger call (a compaction since) and a later zero-usage live record: only the LAST counted call decides
    _write_jsonl(os.path.join(sub, "agent-tok13.jsonl"), [brief, _asst_u(ts(41), [tool], 800_000), _asst_u(ts(40), [tool], 700_000), zero_live, zero_err])
    bad_u = _asst_u(ts(40), [tool], 900_000)
    bad_u["message"]["usage"]["input_tokens"] = "n/a"
    _write_jsonl(os.path.join(sub, "agent-tok14.jsonl"), [brief, _asst_u(ts(41), [tool], 500_000), bad_u, zero_err])
    rows12 = {r["agent_id"]: r for r in scan("selftest-sid")}
    check("cold, 400,000 tokens of context → RESUME", rows12["tok12"]["context_tokens"] == 400_000 and rows12["tok12"]["action"] == "RESUME")
    check("cold, 700,000 tokens of context → RESUME (no room line)", rows12["tok13"]["context_tokens"] == 700_000 and rows12["tok13"]["action"] == "RESUME")
    check("the context is the last LIVE call's; the error record's zero usage never counts", rows12["tok13"]["context_tokens"] == 700_000)
    check("a malformed usage count neither crashes the scan nor counts", rows12["tok14"]["context_tokens"] == 500_000)
    check("RESUME reason names the model the agent ran on", "claude-opus-5-5" in rows12["tok12"]["reason"])
    check("no usage record → still RESUME, labelled context unmeasured", rows12["cold3"]["context_tokens"] is None and rows12["cold3"]["action"] == "RESUME" and "context unmeasured" in rows12["cold3"]["reason"])
    # the model exception: an unpinned agent's resume runs on the session's model, so one on another model is seated FRESH
    # on its own; a death at the agent's OWN model's limit is WAIT (nothing runs on that model until its reset), except a
    # Fable agent at Fable's own limit, which is FRESH on Opus at once (MODEL_LIMIT_MOVES)
    fab = _asst(ts(40), [{"type": "text", "text": "You've reached your Fable limit · resets 2pm"}], err=True)
    _write_jsonl(os.path.join(sub, "agent-fab15.jsonl"), [brief, _asst_u(ts(41), [tool], 300_000, model="claude-fable-5-1"), fab])
    nou = _asst(ts(41), [tool]); nou["message"]["model"] = "claude-fable-5-1"
    _write_jsonl(os.path.join(sub, "agent-nou17.jsonl"), [brief, _asst_u(ts(42), [tool], 300_000, model="claude-opus-5-5"), nou, fab])
    rows15 = {r["agent_id"]: r for r in scan("selftest-sid")}
    check("the agent's model is read from its last live record even without a usage block",
          rows15["nou17"]["model"] == "claude-fable-5-1" and rows15["nou17"]["action"] == "FRESH")
    check("a Fable agent at Fable's own limit → FRESH on opus at once, no owner word, the error quoted",
          rows15["fab15"]["model_limit"] is True and rows15["fab15"]["action"] == "FRESH"
          and rows15["fab15"]["reason"].endswith('ON opus. The error, for the reset it names: "You\'ve reached your Fable limit · resets 2pm"')
          and "no owner word needed" in rows15["fab15"]["reason"] and "only on the owner's word" not in rows15["fab15"]["reason"])
    check("the model-limit rule lives in one mapping: Fable moves to Opus, every other family waits",
          MODEL_LIMIT_MOVES == {"fable": "opus"})
    op15 = dict(rows15["fab15"], model="claude-opus-5-5", error="You have used your Opus weekly limit · resets Mon 9am")
    check("an Opus agent at Opus's own limit → WAIT, never resume now, no model with room; after the reset a resume (the session runs opus)",
          decide(op15)[0] == "WAIT" and "do not resume it now" in decide(op15)[1] and "no other model has room" in decide(op15)[1]
          and "After the reset: resume it (the session runs claude-opus-5-5)" in decide(op15)[1]
          and "only on the owner's word" not in decide(op15)[1])
    so15 = dict(op15, model="claude-sonnet-5-5", error="You've reached your Sonnet limit")
    ha15 = dict(op15, model="claude-haiku-5", error="You've reached your Haiku limit")
    check("a Sonnet agent at its own limit → WAIT, and its reason says only Fable moves (the no-room reason is about Opus)",
          all(decide(x)[0] == "WAIT" and "only a Fable agent moves to another model at once" in decide(x)[1]
              and "no other model has room" not in decide(x)[1] for x in (so15, ha15)))
    rs = dict(rows15["fab15"]); rs["model_limit"] = False
    check("model change (a session-limit death on another model) → FRESH on the agent's own model, no reset wait",
          decide(rs)[0] == "FRESH" and "model change" in decide(rs)[1] and "ON claude-fable-5-1" in decide(rs)[1]
          and "limit resets" not in decide(rs)[1])
    check("a session limit is not a model limit", rows12["tok12"]["model_limit"] is False)
    check("every account-wide limit word is not a model limit; the agent's own model is",
          not any(_model_limit(f"You've hit your {w} limit", "claude-fable-5-1") for w in ("session", "usage", "weekly", "daily", "monthly", "rate", "Weekly", "hourly", "spend"))
          and _model_limit("You've reached your Fable limit · resets 2pm", "claude-fable-5-1") and _model_limit("your opus limit", "claude-opus-5-5"))
    ru = dict(rs); ru["session_model"] = None
    check("an unreadable session model never resumes silently: RESUME with SESSION MODEL UNREAD", decide(ru)[0] == "RESUME" and "SESSION MODEL UNREAD" in decide(ru)[1])
    rw = dict(op15); rw["session_model"] = None
    check("a model-limit death with the session model unread → WAIT, the after-reset step names the unread model",
          decide(rw)[0] == "WAIT" and "SESSION MODEL UNREAD" in decide(rw)[1])
    check("a Fable model-limit death moves to Opus whatever the session model reads (unread included)",
          decide(dict(rows15["fab15"], session_model=None))[0] == "FRESH" and "ON opus" in decide(dict(rows15["fab15"], session_model=None))[1])
    ru["action"], ru["reason"] = decide(ru)
    check("the hook doc carries the SESSION MODEL UNREAD label too", "SESSION MODEL UNREAD" in (hook_doc([ru]) or ""))
    # a pinned agent's resume runs on its pin, not the session's model (session here: claude-opus-5-5)
    json.dump({"agentType": "pinned-sonnet", "description": "pinned reader"}, io.open(os.path.join(sub, "agent-pin21.meta.json"), "w"))
    _write_jsonl(os.path.join(sub, "agent-pin21.jsonl"), [brief, _asst_u(ts(43), [tool], 300_000, model="claude-sonnet-5-5"), fab])
    pin21 = {r["agent_id"]: r for r in scan("selftest-sid")}["pin21"]
    check("a pin is read from the agent definition's frontmatter", pin21["pinned"] == "sonnet")
    check("an agent that ran on its pinned model RESUMEs in a session on another model",
          pin21["action"] == "RESUME" and "pins sonnet" in pin21["reason"])
    rp = dict(pin21); rp["model_limit"] = True
    check("a pinned agent that died at its own model's limit → WAIT, then a resume after the reset (it runs on the pin)",
          decide(rp)[0] == "WAIT" and "After the reset: resume it (its definition pins sonnet" in decide(rp)[1])
    rq = dict(pin21); rq["pinned"] = "opus"
    check("an agent that ran off its pin with no dispatch model recorded is FRESH on the model it ran on",
          decide(rq)[0] == "FRESH" and "ON claude-sonnet-5-5" in decide(rq)[1])
    check("an agent off its pin that died at its own model's limit → WAIT, then a fresh seat ON that model (a resume runs on the pin)",
          decide(dict(rq, model_limit=True))[0] == "WAIT" and "ON claude-sonnet-5-5 (a resume would run on opus)" in decide(dict(rq, model_limit=True))[1])
    check("a `model: inherit` definition is no pin (definitions fix no model; the launching seat picks it)", agent_pin("inherits") is None)
    ru2 = dict(pin21, session_model=None); ru2["action"], ru2["reason"] = decide(ru2)
    check("a pinned RESUME with the session model unread carries no UNREAD label in the hook (its resume runs on the pin)",
          ru2["action"] == "RESUME" and "SESSION MODEL UNREAD" not in (hook_doc([ru2]) or "SESSION MODEL UNREAD"))
    rn = dict(pin21); rn["pinned"] = None
    check("the same agent unpinned is a model change (FRESH on its model)", decide(rn)[0] == "FRESH" and "model change" in decide(rn)[1])
    rv = dict(rn, model="claude-opus-5", session_model="claude-opus-5-5")
    check("with no dispatch model and no pin, another version of the session's family is a model change (the session leg compares exactly)", decide(rv)[0] == "FRESH" and "model change" in decide(rv)[1])
    check("no pin without frontmatter, for a missing definition, or for a path-shaped type",
          agent_pin("no-front") is None and agent_pin("absent-type") is None and agent_pin("../pinned-sonnet") is None)
    check("the model family is read from an id or an alias", _family("claude-sonnet-5-5") == "sonnet" and _family("sonnet") == "sonnet" and _family("claude-opus-5-5") == "opus")
    # the dispatch's own model (meta.json `model`) is what a resume runs on, ahead of any pin and the session's model
    slim = _asst(ts(40), [{"type": "text", "text": "You've hit your session limit · resets 2pm"}], err=True)
    for aid, mmodel, ran in (("disp23", "fable", "claude-fable-5-1"), ("disp24", "inherit", "claude-fable-5-1"), ("disp25", "sonnet", "claude-opus-5-5")):
        json.dump({"agentType": "general-purpose", "description": aid, "model": mmodel}, io.open(os.path.join(sub, f"agent-{aid}.meta.json"), "w"))
        _write_jsonl(os.path.join(sub, f"agent-{aid}.jsonl"), [brief, _asst_u(ts(41), [tool], 300_000, model=ran), slim])
    rd = {r["agent_id"]: r for r in scan("selftest-sid")}
    check("an agent the dispatch named fable, in an Opus session, RESUMEs (the dispatch's model survives a resume)",
          rd["disp23"]["dispatched"] == "fable" and rd["disp23"]["action"] == "RESUME" and "the dispatch named fable" in rd["disp23"]["reason"])
    check("a dispatch recorded as inherit names no model: the same agent on Fable in an Opus session is a model change",
          rd["disp24"]["dispatched"] is None and rd["disp24"]["action"] == "FRESH" and "model change" in rd["disp24"]["reason"])
    check("an agent that ran off the model its dispatch named is FRESH on the model it ran on",
          rd["disp25"]["action"] == "FRESH" and "the dispatch named sonnet but it ran on claude-opus-5-5" in rd["disp25"]["reason"])
    flim = "You've reached your Fable limit · resets 2pm"  # the disp rows died at the session limit: give them Fable's own
    rdw = dict(rd["disp23"], error=flim); rdw["model_limit"] = _model_limit(flim, rdw["model"])
    check("an agent the dispatch named fable, at Fable's own limit → FRESH on opus at once (its dispatch's model is at its limit)",
          decide(rdw)[0] == "FRESH" and "ON opus" in decide(rdw)[1])
    rdi = dict(rd["disp24"], error=flim); rdi["model_limit"] = _model_limit(flim, rdi["model"])  # inherit, ran Fable, Opus session
    check("an inherit-dispatched Fable agent in an Opus session at Fable's limit → FRESH on opus (the review's open case)",
          rdi["dispatched"] is None and decide(rdi)[0] == "FRESH" and "ON opus" in decide(rdi)[1])
    rdp = dict(rd["disp23"]); rdp["pinned"] = "opus"
    check("the dispatch's model outranks the definition's pin", decide(rdp)[0] == "RESUME" and "the dispatch named fable" in decide(rdp)[1])
    rdo = dict(rd["disp25"], model_limit=True)  # dispatch named sonnet, ran claude-opus-5-5, session claude-opus-5-5
    check("at its own model's limit, an agent off its dispatch's model in a session on the model it ran → WAIT, then a fresh seat (a resume runs on the dispatch's model)",
          decide(rdo)[0] == "WAIT" and "ON claude-opus-5-5 (a resume would run on sonnet)" in decide(rdo)[1])
    rdq = dict(rd["disp25"], dispatched="opus", pinned="sonnet", model_limit=True)  # ran claude-opus-5-5, its Opus limit
    check("at its own model's limit the dispatch's model outranks the pin too: WAIT, then a resume after the reset",
          decide(rdq)[0] == "WAIT" and "After the reset: resume it (the dispatch named opus" in decide(rdq)[1])
    os.environ["LIMIT_RECOVERY_SESSION_MODEL"] = "claude-fable-5-1"
    f15 = {r["agent_id"]: r for r in scan("selftest-sid")}["fab15"]
    check("a Fable agent at Fable's own limit moves to Opus even when the session runs Fable",
          f15["action"] == "FRESH" and "ON opus" in f15["reason"])
    o15 = dict(f15, model="claude-opus-5-5", session_model="claude-opus-5-5", error="You have used your Opus weekly limit · resets Mon 9am")
    check("at its own model's limit an Opus agent WAITs even when the session runs that model, then resumes after the reset",
          decide(o15)[0] == "WAIT" and "After the reset: resume it (the session runs claude-opus-5-5)" in decide(o15)[1])
    o15["action"], o15["reason"] = decide(o15)
    check("a non-limit death of the same agent RESUMEs when the session runs its model",
          decide(dict(rs, session_model="claude-fable-5-1"))[0] == "RESUME")
    # the session model is read from the tail of the session's own transcript when no override is set
    os.environ.pop("LIMIT_RECOVERY_SESSION_MODEL")
    stp = os.path.dirname(sub) + ".jsonl"
    _write_jsonl(stp, [_asst_u(ts(5), [tool], 1000, model="claude-opus-5-5"), _asst(ts(4), [{"type": "text", "text": "x"}], err=True)])
    check("session_model() reads the newest real model in the session transcript, skipping error records", session_model("selftest-sid") == "claude-opus-5-5")
    os.remove(stp)
    check("session_model() is None when the session transcript is missing", session_model("selftest-sid") is None)
    _write_jsonl(stp, [_asst_u(ts(9), [tool], 1000, model="claude-opus-5-5"), _asst_u(ts(6), [tool], 1000, model="claude-fable-5-1")])
    check("session_model() takes the NEWEST of two models (a /model switch), not the first", session_model("selftest-sid") == "claude-fable-5-1")
    _write_jsonl(stp, [_asst_u(ts(6), [tool], 1000, model="claude-fable-5-1"), {"type": "attachment", "timestamp": ts(5), "attachment": {"content": "x" * (TAIL_BYTES + 30_000)}}])
    check("session_model() reads past a trailing record larger than TAIL_BYTES (a SessionStart injection, a large tool result)", session_model("selftest-sid") == "claude-fable-5-1")
    os.remove(stp)
    os.environ["LIMIT_RECOVERY_SESSION_MODEL"] = "claude-opus-5-5"
    check("hook doc gives a measured death in tokens", "700,000 tokens" in (hook_doc([rows12["tok13"]]) or ""))
    doc = hook_doc(list(rows.values()))
    check("hook doc labels the warm death warm and the cold one cold", "warm 3 min" in doc and "cold 30 min" in doc)
    check("hook doc is one JSON document naming the live deaths only", doc is not None and json.loads(doc)["hookSpecificOutput"]["hookEventName"] == "UserPromptSubmit" and "warm reader" in doc and "done4" not in doc)
    check("hook doc empty when only BANKED rows", hook_doc([rows["done4"]]) is None)

    # digest carries the brief, the tool call and the error
    dg = digest("selftest-sid", "cold3", out=os.path.join(d, "dg.txt"))
    check("digest carries the original brief verbatim", "BRIEF: read file X" in dg)
    check("digest lists tool calls and the error", "[tool 3] Read: /x" in dg and "OAuth token" in dg)

    # mark hides a handled death; include_handled shows it with its mark
    st = load_state("selftest-sid"); st["cold3"] = {"as": "fresh", "ts": "t", "note": "n"}; save_state("selftest-sid", st)
    check("marked death hidden from scan", "cold3" not in {r["agent_id"] for r in scan("selftest-sid")})
    check("marked death visible with include_handled", any(r["agent_id"] == "cold3" and r["handled"]["as"] == "fresh" for r in scan("selftest-sid", include_handled=True)))
    # a mark covers its own death only: a resumed agent that dies again is named again
    lim = [{"type": "text", "text": "You've hit your session limit"}]
    first = [brief, _asst(ts(40), [tool]), _asst(ts(40), lim, err=True)]
    _write_jsonl(os.path.join(sub, "agent-redie11.jsonl"), first)
    import contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        main(["mark", "redie11", "--as", "resumed", "--sid", "selftest-sid"])
    check("marked death hidden (mark written through the CLI)", "redie11" not in {r["agent_id"] for r in scan("selftest-sid")})
    check("a resumed death its mark still covers, listed by --all, is not a failed resume",
          [r["resume_failed"] for r in scan("selftest-sid", include_handled=True) if r["agent_id"] == "redie11"] == [False])
    _write_jsonl(os.path.join(sub, "agent-redie11.jsonl"), first + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), [tool]), _asst(ts(7), lim, err=True)])
    check("a marked agent that dies AGAIN is named again", "redie11" in {r["agent_id"] for r in scan("selftest-sid")})
    check("the re-died agent's row carries no mark (the old mark covered the old death only)",
          [r["handled"] for r in scan("selftest-sid") if r["agent_id"] == "redie11"] == [None])
    check("a resumed agent that did live work and died again → RESUME again (the resume took)",
          [r["action"] for r in scan("selftest-sid") if r["agent_id"] == "redie11"] == ["RESUME"])
    first16 = [brief, _asst(ts(40), [tool]), _asst(ts(40), lim, err=True)]
    _write_jsonl(os.path.join(sub, "agent-refail16.jsonl"), first16)
    with contextlib.redirect_stdout(io.StringIO()):
        main(["mark", "refail16", "--as", "resumed", "--sid", "selftest-sid"])
    _write_jsonl(os.path.join(sub, "agent-refail16.jsonl"), first16 + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), [{"type": "text", "text": "API Error: 400 invalid_request_error"}], err=True)])
    rf = [r for r in scan("selftest-sid") if r["agent_id"] == "refail16"]
    check("a resume that made no live call before dying again → FRESH, the resume failed",
          len(rf) == 1 and rf[0]["resume_failed"] is True and rf[0]["action"] == "FRESH" and "the resume failed" in rf[0]["reason"])
    _write_jsonl(os.path.join(sub, "agent-relim17.jsonl"), first16)
    with contextlib.redirect_stdout(io.StringIO()):
        main(["mark", "relim17", "--as", "resumed", "--sid", "selftest-sid"])
    _write_jsonl(os.path.join(sub, "agent-relim17.jsonl"), first16 + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), lim, err=True)])
    rl = [r for r in scan("selftest-sid") if r["agent_id"] == "relim17"]
    check("a resume that died again at the same limit before a live call → RESUME after the reset, not FRESH",
          len(rl) == 1 and rl[0]["resume_failed"] is False and rl[0]["action"] == "RESUME")
    check("the model limit is read off the agent's model family, multi-word and weekly forms included",
          all(_model_limit(e, "claude-fable-5-1") for e in ("You've reached your Fable limit", "You've reached your Fable 5.1 limit · resets 2pm", "You've reached your weekly Fable limit"))
          and _model_limit("Opus weekly limit reached", "claude-opus-5-5")
          and not any(_model_limit(e, "claude-fable-5-1") for e in ("You've hit your hourly limit", "You've hit your session limit", "You've reached your Sonnet limit"))
          and not _model_limit("You've reached your Fable limit", None))
    check("a limit clause naming the session is the session limit, never the model's own",
          not any(_model_limit(e, "claude-fable-5-1") for e in ("You've hit your Fable session limit · resets 3pm", "Fable 5.1 session limit reached")))
    wk = "You've hit your weekly limit · resets Sep 9 at 8pm (UTC)"  # the shape measured on four Opus agents (timezone neutral)
    check("the weekly-limit text measured on this box names no model: a limit, never the Opus agent's own",
          classify_error(wk) == "limit" and not any(_model_limit(wk, m) for m in ("claude-opus-5", "claude-opus-5-5")))
    # the limit/logout exclusion above masks any fixture that dies at a limit, so the two clauses the failed-resume
    # predicate rests on (a live call after the marked death; the mark not covering this death) and the logout half
    # of the exclusion are pinned here on non-limit deaths
    ape = [{"type": "text", "text": "API Error: 400 invalid_request_error"}]
    first18 = [brief, _asst(ts(40), [tool]), _asst(ts(40), ape, err=True)]
    _write_jsonl(os.path.join(sub, "agent-relive18.jsonl"), first18)
    with contextlib.redirect_stdout(io.StringIO()):
        main(["mark", "relive18", "--as", "resumed", "--sid", "selftest-sid"])
    check("a non-limit death its resumed mark still covers, listed by --all, is not a failed resume",
          [r["resume_failed"] for r in scan("selftest-sid", include_handled=True) if r["agent_id"] == "relive18"] == [False])
    _write_jsonl(os.path.join(sub, "agent-relive18.jsonl"), first18 + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), [tool]), _asst(ts(7), ape, err=True)])
    check("a resume that made a live call before a non-limit re-death took: RESUME, not a failed resume",
          [(r["resume_failed"], r["action"]) for r in scan("selftest-sid") if r["agent_id"] == "relive18"] == [(False, "RESUME")])
    _write_jsonl(os.path.join(sub, "agent-reauth19.jsonl"), first16)
    with contextlib.redirect_stdout(io.StringIO()):
        main(["mark", "reauth19", "--as", "resumed", "--sid", "selftest-sid"])
    _write_jsonl(os.path.join(sub, "agent-reauth19.jsonl"), first16 + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), [{"type": "text", "text": "Not logged in · Please run /login"}], err=True)])
    check("a resume that died again on a logout before a live call → RESUME after the re-login, not FRESH",
          [(r["resume_failed"], r["action"]) for r in scan("selftest-sid") if r["agent_id"] == "reauth19"] == [(False, "RESUME")])
    rfm = dict(rf[0]); rfm["model"], rfm["session_model"] = "claude-fable-5-1", "claude-opus-5-5"
    check("a failed resume of an agent on another model is seated ON the agent's model", decide(rfm)[0] == "FRESH" and "ON claude-fable-5-1" in decide(rfm)[1])
    # a model-limit text the limit shapes miss, after a marked resume with no live call: a limit, never a failed resume
    wk = "You have used your Opus weekly limit"
    check("fixture sanity: the weekly model-limit text is outside the limit shapes", classify_error(wk) == "api-error")
    first22 = [brief, _asst_u(ts(40), [tool], 300_000, model="claude-opus-5-5"), _asst(ts(40), lim, err=True)]
    _write_jsonl(os.path.join(sub, "agent-rewk22.jsonl"), first22)
    with contextlib.redirect_stdout(io.StringIO()):
        main(["mark", "rewk22", "--as", "resumed", "--sid", "selftest-sid"])
    _write_jsonl(os.path.join(sub, "agent-rewk22.jsonl"), first22 + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), [{"type": "text", "text": wk}], err=True)])
    check("a resume that died again at the agent's own model's limit is not a failed resume: WAIT",
          [(r["resume_failed"], r["action"]) for r in scan("selftest-sid") if r["agent_id"] == "rewk22"] == [(False, "WAIT")])
    # the context does not fit: a resume fails the same way, and so does a fresh seat on the same model
    ovt = "Prompt is too long · the request is ~214290 tokens (limit 200000) but this conversation is only ~250 tokens"
    check("an over-long prompt classes as overflow, even with 429 inside a token count", classify_error(ovt) == "overflow")
    check("overflow keys on the phrase, not on 429: a 429-free over-long prompt is overflow, a 429 rate limit is a limit",
          classify_error("Prompt is too long · the request is ~218000 tokens (limit 200000)") == "overflow"
          and classify_error("API Error: 429 rate_limit_error") == "limit")
    _write_jsonl(os.path.join(sub, "agent-over20.jsonl"), [brief, _asst_u(ts(30), [tool], 190_000, model="claude-sonnet-5-5"), _asst(ts(30), [{"type": "text", "text": ovt}], err=True)])
    ov = {r["agent_id"]: r for r in scan("selftest-sid")}["over20"]
    check("an over-long prompt → FRESH on a model with a larger context window, never RESUME",
          ov["action"] == "FRESH" and "LARGER CONTEXT WINDOW than claude-sonnet-5-5" in ov["reason"])
    ow = dict(ov); ow["model_limit"], ow["resume_failed"] = True, True
    check("the overflow rule outranks a model limit and a failed resume", decide(ow)[0] == "FRESH" and "LARGER CONTEXT WINDOW" in decide(ow)[1])
    check("WAIT outranks a failed resume (decide's own order, not only scan's exclusion)",
          decide(dict(o15, resume_failed=True))[0] == "WAIT")
    hw = hook_doc([o15])
    hwt = json.loads(hw)["hookSpecificOutput"]["additionalContext"] if hw else ""
    check("the hook names a WAIT row WAIT and bans its resume only before its model's limit resets",
          "→ WAIT" in hwt and "never resume one the table says FRESH, or WAIT before its model's limit resets." in hwt
          and "(on Opus no other model has room; " in hwt and "at its limit and no other model has room" not in hwt)
    check("a WAIT row's reason quotes the error, so the reset it names is readable from the printed scan",
          'The error, for the reset it names: "You have used your Opus weekly limit · resets Mon 9am"' in o15["reason"])
    fh = hook_doc([f15])
    fht = json.loads(fh)["hookSpecificOutput"]["additionalContext"] if fh else ""
    check("the hook names a Fable model-limit row FRESH and says Fable moves to Opus at once",
          "→ FRESH" in fht and "a Fable agent at Fable's own limit is FRESH on Opus at once instead" in fht)
    check("limit texts outside the measured shapes class as a limit (U+2219 separator, 'limit reached')",
          classify_error("5-hour limit reached \u2219 resets 3pm") == "limit" and classify_error("Weekly limit reached") == "limit"
          and classify_error("You've hit your limit \u2219 resets 3pm") == "limit")
    check("an over-long context in the API's and the harness's words is overflow, before the limit shapes",
          classify_error("input length and `max_tokens` exceed context limit: 194290 + 32000 > 200000") == "overflow"
          and classify_error("Context limit reached · /compact or /clear to continue") == "overflow")
    check("a 401 authentication_error is a logout", classify_error('API Error: 401 {"error":{"type":"authentication_error"}}') == "auth")
    check("a 529 overload and a 500 class as transient, not api-error",
          classify_error('API Error: 529 {"error":{"type":"overloaded_error","message":"Overloaded"}}') == "transient"
          and classify_error('API Error: 500 {"error":{"type":"api_error","message":"Internal server error"}}') == "transient")
    for aid, txt in (("retr23", 'API Error: 529 {"error":{"type":"overloaded_error","message":"Overloaded"}}'),
                     ("rewl24", "Weekly limit reached \u2219 resets Oct 15")):
        _write_jsonl(os.path.join(sub, f"agent-{aid}.jsonl"), first16)
        with contextlib.redirect_stdout(io.StringIO()):
            main(["mark", aid, "--as", "resumed", "--sid", "selftest-sid"])
        _write_jsonl(os.path.join(sub, f"agent-{aid}.jsonl"), first16 + [{"type": "user", "timestamp": ts(9), "message": {"content": [{"type": "text", "text": "continue"}]}}, _asst(ts(8), [{"type": "text", "text": txt}], err=True)])
    check("a resume that died again on an overload or an account-wide limit is not a failed resume: RESUME",
          sorted((r["agent_id"], r["resume_failed"], r["action"]) for r in scan("selftest-sid") if r["agent_id"] in ("retr23", "rewl24"))
          == [("retr23", False, "RESUME"), ("rewl24", False, "RESUME")])
    _write_jsonl(os.path.join(sub, "agent-live12.jsonl"), [brief, _asst(ts(3), [tool])])
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        rc_live = main(["mark", "live12", "--as", "resumed", "--sid", "selftest-sid"])
    check("mark refuses an agent whose transcript does not end in a death, and writes nothing",
          rc_live == 1 and "live12" not in load_state("selftest-sid"))
    _write_jsonl(os.path.join(sub, "agent-nots13.jsonl"), [brief, _asst(ts(4), [tool]), {"type": "assistant", "isApiErrorMessage": True, "message": {"content": lim}}])
    with contextlib.redirect_stdout(io.StringIO()):
        rc_nots = main(["mark", "nots13", "--as", "dropped", "--sid", "selftest-sid"])
    check("a death with no timestamp can be marked, and the mark hides it",
          rc_nots == 0 and "nots13" not in {r["agent_id"] for r in scan("selftest-sid")})
    err = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        rc_gone = main(["mark", "gone14", "--as", "fresh", "--sid", "selftest-sid"])
    check("mark on a missing transcript refuses, names it unreadable, writes nothing",
          rc_gone == 1 and "gone14 (transcript unreadable" in err.getvalue() and "gone14" not in load_state("selftest-sid"))
    # a death whose error text matches none of the shapes is still a death (api-error)
    check("unknown error text classes as api-error", classify_error("Connection closed mid-response") == "api-error")
    # the hook-mode scan never full-reads a BANKED row (nothing marks one); one bad sibling never silences the rest
    check("hook-mode scan skips BANKED rows, keeps live ones", (lambda ids: "done4" not in ids and "warm1" in ids)({r["agent_id"] for r in scan("selftest-sid", skip_banked=True)}))
    io.open(os.path.join(sub, "agent-bad10.jsonl"), "w").write('{"type":"assistant","isApiErrorMessage":true,"message":"str"}\n["not an object"]\n')
    check("a malformed sibling transcript does not silence the scan", "warm1" in {r["agent_id"] for r in scan("selftest-sid")})
    nr = os.path.join(sub, "agent-noread11.jsonl"); io.open(nr, "w").write("{}\n"); os.chmod(nr, 0)
    check("an unreadable sibling transcript does not silence the scan", os.access(nr, os.R_OK) or "warm1" in {r["agent_id"] for r in scan("selftest-sid")})
    check("the hand-back is found in the tail, no whole-file read", _tail_handback(_tail_records(os.path.join(sub, "agent-done4.jsonl"))))
    # --sid as a prefix: the 8-hex form every readout prints resolves to its one session, never to an empty scan
    proj = os.path.join(d, "proj")
    # synthetic ids, built in parts: the fixture session's 8-hex prefix, two sessions sharing another prefix,
    # and a prefix no session carries
    pref8, twin8, none8 = "aaaa1111", "bbbb2222", "deadbeef"
    tail = "-0000-4000-8000-"
    full = pref8 + tail + "000000000001"
    os.makedirs(os.path.join(proj, full, "subagents"))
    io.open(os.path.join(proj, full + ".jsonl"), "w").write("{}\n")
    for n in os.listdir(sub):
        if n.startswith("agent-warm1."):
            shutil.copy(os.path.join(sub, n), os.path.join(proj, full, "subagents", n))
    io.open(os.path.join(proj, twin8 + tail + "000000000001.jsonl"), "w").write("{}\n")
    io.open(os.path.join(proj, twin8 + tail + "000000000002.jsonl"), "w").write("{}\n")
    os.makedirs(os.path.join(proj, "memory"))  # the project directory's non-session entry
    saved_sub = os.environ.pop("LIMIT_RECOVERY_SUBAGENTS_DIR")
    os.environ["LIMIT_RECOVERY_PROJECT_DIR"] = proj
    check("an 8-hex --sid resolves to the one session it prefixes", resolve_sid(pref8) == (full, None))
    check("a full --sid passes through unchanged", resolve_sid(full) == (full, None))
    check("a --sid prefix naming no session is an error, not an empty scan",
          resolve_sid(none8)[1] is not None and "no session" in resolve_sid(none8)[1])
    check("a --sid prefix naming two sessions is an error naming both",
          (lambda e: e is not None and "2 sessions" in e)(resolve_sid(twin8)[1]))
    check("a --sid naming a non-session directory is an error, not an empty scan",
          resolve_sid("me")[1] is not None and resolve_sid("memory")[1] is not None)
    check("a --sid that only occurs inside a session id is not its prefix", resolve_sid(pref8[2:])[1] is not None)
    with contextlib.redirect_stdout(io.StringIO()) as buf:
        rc_pref = main(["scan", "--sid", pref8, "--json"])
    check("scan --sid <8-hex prefix> lists the death a full-id scan lists",
          rc_pref == 0 and "warm1" in {r["agent_id"] for r in json.loads(buf.getvalue())})
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err_buf:
        rc_none = main(["scan", "--sid", none8])
    check("scan --sid <unknown prefix> exits 2 and says so on stderr",
          rc_none == 2 and "no session starts with" in err_buf.getvalue())
    saved_stdin, sys.stdin = sys.stdin, io.StringIO(json.dumps({"session_id": none8}))
    try:
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            rc_hook = main(["scan", "--hook"])
    finally:
        sys.stdin = saved_stdin
    check("the hook form stays silent on an unknown session", rc_hook == 0 and buf.getvalue() == "")
    # digest and mark resolve the prefix too (their own block in main(); every other mark arm passes a full id)
    dg_pref = os.path.join(d, "dg-prefix.txt")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            rc_dg = main(["digest", "warm1", "--sid", pref8, "--out", dg_pref])
    except OSError:
        rc_dg = None
    check("digest --sid <8-hex prefix> reads the session it prefixes", rc_dg == 0 and os.path.isfile(dg_pref))
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        rc_mk = main(["mark", "warm1", "--as", "dropped", "--sid", pref8])
    check("mark --sid <8-hex prefix> marks the death in the session it prefixes", rc_mk == 0 and "warm1" in load_state(full))
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err_buf:
        rc_mk_none = main(["mark", "warm1", "--as", "dropped", "--sid", none8])
    check("mark --sid <unknown prefix> exits 2 and says so on stderr",
          rc_mk_none == 2 and "no session starts with" in err_buf.getvalue())
    os.environ["LIMIT_RECOVERY_PROJECT_DIR"] = os.path.join(d, "no-such-project")
    check("an unlistable project directory is an error, never an empty scan",
          (lambda e: e is not None and "cannot list" in e)(resolve_sid(pref8)[1]))
    os.environ.pop("LIMIT_RECOVERY_PROJECT_DIR")
    os.environ["LIMIT_RECOVERY_SUBAGENTS_DIR"] = saved_sub
    # negative control: missing dir → empty
    os.environ["LIMIT_RECOVERY_SUBAGENTS_DIR"] = os.path.join(d, "nope")
    check("missing transcript dir → no rows, no crash", scan("selftest-sid") == [])
    shutil.rmtree(d, ignore_errors=True)
    print(f"self-test: {fails} failed")
    return 1 if fails else 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        return 0
    if argv[0] == "--self-test":
        return self_test()
    cmd, rest = argv[0], argv[1:]

    def opt(flag, default=None):
        if flag in rest:
            i = rest.index(flag)
            v = rest[i + 1] if i + 1 < len(rest) else default
            del rest[i:i + 2]
            return v
        return default

    sid = opt("--sid") or os.environ.get("CLAUDE_CODE_SESSION_ID") or ""
    if cmd == "scan":
        as_json = "--json" in rest
        as_hook = "--hook" in rest
        # --all lists everything: the marked deaths with their mark, and the deaths before DETECTION_EPOCH
        include_handled = "--all" in rest
        if as_hook:
            # the hook payload's session_id outranks the environment: the suite drives this hook with a
            # fixture session while CLAUDE_CODE_SESSION_ID names the live seat (first smoke run: the
            # marked-death arm read the live session's deaths and failed)
            try:
                sid = json.load(sys.stdin).get("session_id") or sid
            except Exception:
                pass
        sid, err = resolve_sid(sid)
        if err:
            if as_hook:
                return 0
            print(f"limit-recovery: {err}", file=sys.stderr)
            return 2
        rows = scan(sid, include_handled=include_handled, include_old=include_handled, skip_banked=as_hook)
        if as_hook:
            doc = hook_doc(rows)
            if doc:
                print(doc)
            return 0
        if as_json:
            print(json.dumps(rows, indent=1))
        else:
            _print_rows(rows)
        return 0
    if cmd in ("digest", "mark"):
        sid, err = resolve_sid(sid)
        if err:
            print(f"limit-recovery: {err}", file=sys.stderr)
            return 2
    if cmd == "digest":
        out = opt("--out")
        if not rest:
            print("digest: agent id required", file=sys.stderr)
            return 2
        text = digest(sid, rest[0], out=out)
        if out:
            print(f"digest written: {out} ({len(text):,} B)")
        else:
            sys.stdout.write(text)
        return 0
    if cmd == "mark":
        as_ = opt("--as")
        note = opt("--note", "")
        if as_ not in ("fresh", "dropped", "resumed") or not rest:
            print("mark: <agent-id>... --as fresh|dropped|resumed [--note TEXT]", file=sys.stderr)
            return 2
        st = load_state(sid)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(_now()))
        marked, refused = [], []
        for aid in rest:
            try:
                died_at = _death_ts(sid, aid)
            except OSError as e:  # missing or unreadable: named with its reason, never read as "not a death"
                refused.append(f"{aid} (transcript unreadable: {e.strerror or e})")
                continue
            if died_at is None:  # no death to cover: a mark here would hide every later death of this agent
                refused.append(aid)
                continue
            st[aid] = {"as": as_, "ts": stamp, "note": note, "died_at": died_at}
            marked.append(aid)
        if marked:
            save_state(sid, st)
        print(f"marked {len(marked)} as {as_} in {state_path(sid)}")
        if refused:
            print(f"mark: not marked (the transcript does not end in a death, or cannot be read): {'; '.join(refused)}", file=sys.stderr)
            return 1
        return 0
    print(f"unknown subcommand {cmd!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
