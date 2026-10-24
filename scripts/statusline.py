#!/usr/bin/env python3
"""Claude Code status line: prompt-cache countdown, context fill, plan usage, Fable usage, sub-agents, Remote Control.

Reads the session JSON Claude Code pipes on stdin and prints up to six rows,
laid out as two columns of three. Every segment is skipped when its data is
absent, so an older Claude Code or a fresh session prints less rather than
failing. Never raises: any error prints nothing.

Layout: left column = this conversation (cache, context, agents), right
column = plan allowance (session = 5h, week = 7d, fable), stacked into one
column when COLUMNS is too narrow for both. Every row is one grid: label (9
wide, dim) · a 16-cell thin-line bar · a value right-aligned in 4 columns · dim
detail. The bars mean "used up", so full is the bad end — except cache, which
counts DOWN from its TTL (full when fresh, empty when cold). A
healthy bar is the source project's accent teal (chosen over blue) with its text in
the default colour; a warning turns the bar and value yellow and bold, and a
critical state red plus a word, so the meaning survives yellow-on-white themes.
(A colourless healthy bar reads as switched off, so healthy is coloured too.)

This repo runs THIS file through the project-level statusLine in .claude/settings.json. A copy outside
the repo (~/.claude/statusline.py, which other projects' sessions run) is refreshed from a COMMITTED
version, `git -C <repo> show <branch>:scripts/statusline.py > ~/.claude/statusline.py`, and NEVER
symlinked into a working tree: every other project's session would then run that tree's unreviewed
edits every 30 seconds, and with the lookup turned on (below) this script reads the saved login's
token for the plan-usage fetch.

Fields: https://code.claude.com/docs/en/statusline (prompt_cache needs
v2.1.251+, last_miss_cause v2.1.260+). The stdin carries only the 5-hour and
7-day plan windows; the Fable weekly window comes from GET /api/oauth/usage
(the endpoint /usage reads), fetched by a detached child at most every 2
minutes and cached per saved login in ~/.claude/statusline-cache/plan-usage*.json
(only the `limits` list is stored, never the token). The fetch uses the
machine's saved login, so the Fable row is shown only when the fetched 5h/7d
windows match this session's own (see same_account); after an account switch
it reads "saved login is another account" until they agree again.

The lookup is OFF unless STATUSLINE_USAGE_FETCH=1 is set: it reads your Claude
Code login token (the macOS Keychain entry, else Claude Code's credentials file)
and sends it to that endpoint, which Anthropic does not publicly document and can
change without notice. Anthropic's terms for Claude Code (its legal and
compliance page, read 2026-10-12) say a subscription login is meant for Claude
Code and Anthropic's own apps, and that Anthropic may enforce that without
warning; whether this lookup counts is Anthropic's call, so turn it on only if
you accept that risk to your account. Without the variable no child is started,
nothing reads the token, and the Fable row is not shown. To turn it on, start
statusLine.command with STATUSLINE_USAGE_FETCH=1.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

YELLOW, RED, DIM, BOLD, RESET = "\033[33m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"
# The source project's accent teal, #00c292. Exact in 24-bit
# terminals; the nearest xterm-256 colour (36, #00af87) elsewhere. Fixed, so no theme palette changes it.
ACCENT = "\033[38;2;0;194;146m" if os.environ.get("COLORTERM", "").lower() in ("truecolor", "24bit") \
    else "\033[38;5;36m"
TTL_SECONDS = {"5m": 300, "1h": 3600}
LABEL_W, BAR_W, VALUE_W = 9, 16, 4
WEEK_S = 7 * 86400


def dim(s):
    return DIM + s + RESET


def level(frac, warn, crit):
    return 2 if frac >= crit else 1 if frac >= warn else 0


def tint(lvl):
    return {1: YELLOW, 2: RED}.get(lvl, "")


def meter(fraction, color=""):
    """A thin-line bar: the used part in `color` (the accent teal when healthy), the rest a dim line."""
    fraction = max(0.0, min(1.0, fraction))
    filled = round(fraction * BAR_W)
    if fraction > 0 and not filled:
        filled = 1  # any use shows: 16 cells round everything under ~3.1% to nothing, which read as stuck at 0
    used = (color or ACCENT) + "━" * filled + RESET if filled else ""
    rest = BAR_W - filled
    return used + (dim("─" * rest) if rest else "")


def row(label, cells, value, detail, color=""):
    """One grid row. `cells` is BAR_W visible columns; `detail` arrives already styled."""
    out = dim(label.ljust(LABEL_W)) + cells + "  " + BOLD + color + value.rjust(VALUE_W) + RESET
    return out + ("   " + detail if detail else "")


def tokens(n):
    if n >= 999_500:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    if n >= 1000:
        return f"{round(n / 1000)}k"
    return str(n)


def duration(seconds):
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    hours, rest = divmod(seconds, 3600)
    days, hours = divmod(hours, 24)
    if days:
        return f"{days}d {hours}h"
    return f"{hours}h {rest // 60:02d}m"


def miss_cause(pc):
    cause = pc.get("last_miss_cause")
    if isinstance(cause, dict) and cause.get("causes"):
        return " · last miss: " + ", ".join(str(c) for c in cause["causes"])
    return ""


def cache_line(data, now):
    pc = data.get("prompt_cache")
    if not isinstance(pc, dict) or pc.get("caching_observed") is False:
        return None
    expires = pc.get("expires_at")
    ttl = pc.get("ttl")
    warm = pc.get("warm") is True and isinstance(expires, (int, float)) and expires > now

    if warm:
        left = expires - now
        total = TTL_SECONDS.get(ttl)
        remaining = left / total if total else None  # the bar counts down: full when fresh
        color = tint(1) if remaining is not None and remaining <= 0.2 else ""
        cells = meter(remaining, color) if remaining is not None else " " * BAR_W
        detail = [f"left of {ttl}" if ttl else "left"]
        if isinstance(pc.get("hit_ratio"), (int, float)):
            detail.append(f"hit {round(pc['hit_ratio'] * 100)}%")
        misses = pc.get("misses")
        if isinstance(misses, int) and not isinstance(misses, bool) and misses >= 0:  # show the count even at 0, so every session reads alike
            seg = f"{misses} miss" + ("" if misses == 1 else "es")
            wasted = pc.get("miss_recache_tokens")  # tokens re-written by the requests counted as misses
            if misses and isinstance(wasted, (int, float)) and wasted > 0:
                seg += f" ({tokens(int(wasted))} re-cached)"
            detail.append(seg)
        return row("cache", cells, duration(left), dim(" · ".join(detail) + miss_cause(pc)), color)

    recache = pc.get("recache_tokens_if_cold")
    if isinstance(recache, (int, float)):
        what = f"next message re-caches {tokens(int(recache))}"
    else:
        what = "next message re-caches the conversation"
    return row("cache", meter(0), "cold", RED + BOLD + what + miss_cause(pc) + RESET, RED)


def canon(model):
    """Drop the `[1m]` and `@date` suffixes Claude Code matches to the same modelSettings entry."""
    return str(model).split("[")[0].split("@")[0].strip().lower()


def compact_window(data):
    """The configured auto-compact window in tokens, or None when it is "auto"/unknown.

    Precedence: the CLAUDE_CODE_AUTO_COMPACT_WINDOW env var (floored at 100000,
    as Claude Code does), then settings files from most to least specific;
    inside one file a per-model value beats the top-level one
    (settings-reference: autoCompactWindow). Aliases such as "opus" used as a
    modelSettings key are not resolved here.
    """
    if any(os.environ.get(v, "").lower() in ("1", "true") for v in ("DISABLE_AUTO_COMPACT", "DISABLE_COMPACT")):
        return None  # no auto-compaction at all, so claim no threshold
    env = re.match(r"\s*([0-9]+)", os.environ.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW", ""))
    if env:  # "500k" reads as 500 and clamps to 100K, per env-vars docs
        return max(100_000, int(env.group(1)))
    model_id = canon((data.get("model") or {}).get("id"))
    project = (data.get("workspace") or {}).get("project_dir") or data.get("cwd") or ""
    files = []
    if project:
        files += [os.path.join(project, ".claude", "settings.local.json"),
                  os.path.join(project, ".claude", "settings.json")]
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    files.append(os.path.join(config_dir, "settings.json"))
    for path in files:
        if not os.path.isfile(path):  # a FIFO here would block open() forever
            continue
        try:
            with open(path) as fh:
                settings = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(settings, dict):
            continue
        raw = settings.get("modelSettings")
        raw = raw if isinstance(raw, dict) else {}
        models = {canon(k): v for k, v in raw.items()}
        models.update({k: v for k, v in raw.items() if k == canon(k)})  # a canonical key beats its alias
        entry = models.get(model_id)
        per_model = entry.get("autoCompactWindow") if isinstance(entry, dict) else None
        value = per_model if per_model is not None else settings.get("autoCompactWindow")
        if isinstance(value, int) and not isinstance(value, bool):
            return value if 100_000 <= value <= 1_000_000 else None
        if value is not None:
            return None
    return None


def compact_threshold(data):
    """The token count at which Claude Code auto-compacts, or None when it is unknown/off."""
    cw = data.get("context_window") or {}
    size = cw.get("context_window_size") if isinstance(cw, dict) else None
    window = compact_window(data)
    if window and isinstance(size, int) and size > 0:
        window = min(window, size)  # Claude Code caps the window at the model's context window
    if not window:
        return None
    # Claude Code 2.1.292 compacts at window - min(maxOutputTokens, 20000) - 13000
    # (the docs' "about 967K" for a 1M window is this formula), lowered further by
    # CLAUDE_AUTOCOMPACT_PCT_OVERRIDE. Its check counts the last reply too.
    threshold = window - 33_000
    pct_override = os.environ.get("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "")
    try:
        if 0 < float(pct_override) <= 100:
            threshold = min(int((window - 20_000) * float(pct_override) / 100), threshold)
    except ValueError:
        pass
    return threshold


# ---------------------------------------------------------------- plan usage from /api/oauth/usage

def keychain_suffix():
    """The suffix Claude Code adds to its Keychain entry name ("Claude Code-credentials").

    Mirrors O$() in Claude Code 2.1.295: no suffix for the default config dir; "-" + the first 8 hex
    of sha256(dir) when CLAUDE_SECURESTORAGE_CONFIG_DIR, or else CLAUDE_CONFIG_DIR, names one. The
    status line inherits its session's environment, so it reads the same login that session uses.
    Known limit, accepted: the binary's OAUTH_FILE_SUFFIX is "" for the production
    login and "-local-oauth" / "-custom-oauth" for its other login configs; this hard-codes "", so a
    session on such a config reads the production login (never sends its token to production), and
    same_account then hides the number. Revisit when a session first runs on a non-production login.
    """
    import hashlib
    import unicodedata
    sec = os.environ.get("CLAUDE_SECURESTORAGE_CONFIG_DIR")
    d = sec if sec is not None else os.environ.get("CLAUDE_CONFIG_DIR")
    if not d:
        return ""
    # surrogateescape: a non-UTF-8 byte in the env value must not raise at import (it blanks every row)
    return "-" + hashlib.sha256(unicodedata.normalize("NFC", d).encode("utf-8", "surrogateescape")).hexdigest()[:8]


# One cache per saved login, so sessions with a different config dir never share a number.
USAGE_CACHE = os.path.expanduser(f"~/.claude/statusline-cache/plan-usage{keychain_suffix()}.json")
USAGE_LOCK = USAGE_CACHE + ".lock"
USAGE_REFRESH_S = 120   # after a good fetch
USAGE_RETRY_S = 300     # after a failed one
USAGE_MAX_AGE_S = 900   # older than this, the Fable row is hidden rather than shown stale
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"


def usage_fetch_on():
    """The one opt-in test (header): exactly STATUSLINE_USAGE_FETCH=1. Read by every entry to the lookup
    (starting the child, the child itself) and by the Fable row, so off reads no token and shows no row."""
    return os.environ.get("STATUSLINE_USAGE_FETCH") == "1"


def read_usage_cache():
    try:
        with open(USAGE_CACHE) as fh:
            c = json.load(fh)
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def write_usage_cache(rec):
    os.makedirs(os.path.dirname(USAGE_CACHE), exist_ok=True)
    tmp = f"{USAGE_CACHE}.{os.getpid()}.tmp"
    # 0o600 like the lock: the numbers are the owner's plan usage, readable by group staff at 0o644
    with os.fdopen(os.open(tmp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600), "w") as fh:
        json.dump(rec, fh)
    os.replace(tmp, USAGE_CACHE)


def keychain_account():
    """The account Claude Code files its Keychain entry under (RR() in 2.1.296): $USER, else the login
    name, and "claude-code-user" when that is not [a-zA-Z0-9._-]+."""
    try:
        import pwd
        user = os.environ.get("USER") or pwd.getpwuid(os.getuid()).pw_name
    except Exception:
        user = "claude-code-user"
    return user if re.fullmatch(r"[a-zA-Z0-9._-]+", user or "") else "claude-code-user"


def oauth_token():
    """Claude Code's own OAuth access token: macOS Keychain, else the credentials file. Never logged."""
    raw = ""
    if sys.platform == "darwin":
        raw = subprocess.run(["security", "find-generic-password", "-a", keychain_account(), "-s",
                              "Claude Code-credentials" + keychain_suffix(), "-w"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
    if not raw:
        config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
        with open(os.path.join(config_dir, ".credentials.json")) as fh:
            raw = fh.read()
    oauth = json.loads(raw).get("claudeAiOauth") or {}
    token, exp = oauth.get("accessToken"), oauth.get("expiresAt")
    if not token:
        raise LookupError("no-token")
    if isinstance(exp, (int, float)) and exp / 1000 < time.time():
        raise LookupError("token-expired")  # Claude Code refreshes it; try again later
    return token


def fetch_limits():
    import urllib.request
    req = urllib.request.Request(USAGE_URL, headers={
        "Authorization": f"Bearer {oauth_token()}",
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    })
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None  # a 3xx becomes an HTTPError; the bearer token never leaves api.anthropic.com
    with urllib.request.build_opener(NoRedirect).open(req, timeout=8) as resp:
        body = json.load(resp)
    keep = ("kind", "group", "percent", "severity", "resets_at", "scope", "is_active")
    limits = [{k: lim.get(k) for k in keep} for lim in body.get("limits") or [] if isinstance(lim, dict)]
    # Usage credits ("extra_usage", Claude Code's "Extra-usage (overage) spend"): whether Fable keeps
    # running past its weekly limit on paid credits. None when the response does not say.
    extra = body.get("extra_usage") if isinstance(body.get("extra_usage"), dict) else {}
    on = extra.get("is_enabled")
    credits = None if not isinstance(on, bool) else (on and extra.get("spend_limit_reached") is not True)
    return limits, credits


LOCK_STALE_S = 60


def usage_due(c, now):
    """A fetch is due 120 s after the last attempt (300 s after a failure). An attempt time that is not
    a number or lies in the future counts as due, so a bad cache can never stop fetching for good."""
    a = c.get("attempt_at")
    wait = USAGE_REFRESH_S if c.get("ok") else USAGE_RETRY_S
    return not (isinstance(a, (int, float)) and not isinstance(a, bool) and 0 <= now - a < wait)


def lock_busy(now):
    """A refresh is in flight: the lock exists and was taken under 60 s ago. A lock dated in the
    FUTURE (clock change, a touched file) counts as stale, so it can never stop fetching."""
    try:
        age = now - os.stat(USAGE_LOCK).st_mtime
    except OSError:
        return False
    return 0 <= age < LOCK_STALE_S


def refresh_usage():
    """Run in a detached child (`--refresh-usage`) so the status line never waits on the network.

    The lock holds a per-child id and is removed only by the child whose id it holds. Taking over a
    stale lock is not atomic, so two children can occasionally fetch at once; that is harmless
    (each cache write is an atomic replace), and the id check stops one deleting the other's lock.
    """
    if not usage_fetch_on():
        return  # `--refresh-usage` run by hand is gated too, not only the start in maybe_refresh_usage
    os.makedirs(os.path.dirname(USAGE_LOCK), exist_ok=True)  # the lock lives in the cache dir
    me = f"{os.getpid()}-{os.urandom(8).hex()}".encode()
    try:
        fd = os.open(USAGE_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        if lock_busy(time.time()):
            return  # another refresh is in flight
        try:
            os.remove(USAGE_LOCK)
            fd = os.open(USAGE_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except OSError:
            return
    try:
        os.write(fd, me)
    except OSError:
        pass
    try:
        rec = read_usage_cache()
        if not usage_due(rec, time.time()):
            return  # a child that held the lock just before this one has already fetched
        rec["attempt_at"] = int(time.time())
        write_usage_cache(rec)
        try:
            limits, credits = fetch_limits()
            rec.update(ok=True, ok_at=int(time.time()), limits=limits, usage_credits=credits, error=None)
        except Exception as e:  # keep the last good limits; record only the error's kind, never its text
            code = getattr(e, "code", None)
            rec.update(ok=False, error=type(e).__name__ + (f" {code}" if code else "")
                       + (f" {e.args[0]}" if isinstance(e, LookupError) and e.args
                          and e.args[0] in ("no-token", "token-expired") else ""))
        if read_usage_cache().get("attempt_at") == rec["attempt_at"]:  # else a later child took over
            write_usage_cache(rec)
    finally:
        os.close(fd)
        try:
            with open(USAGE_LOCK, "rb") as fh:
                mine = fh.read() == me
            if mine:  # never remove a lock another child has taken over since
                os.remove(USAGE_LOCK)
        except OSError:
            pass


def maybe_refresh_usage(now):
    if not usage_fetch_on():
        return
    if not usage_due(read_usage_cache(), now) or lock_busy(now):
        return
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "--refresh-usage"],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def epoch(value):
    """A reset time as epoch seconds. The live API sends ISO 8601 with an offset
    ("2026-10-16T02:00:00.207735+00:00", read 2026-10-09); a naive one is read as UTC, never local
    time, and a number is taken as epoch seconds (milliseconds when it is that large)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            v = float(value)
        except OverflowError:
            return None
        if v != v or v in (float("inf"), float("-inf")):
            return None
        return v / 1000 if v > 1e12 else v
    try:
        d = datetime.fromisoformat(re.sub(r"\.\d+", "", str(value)).replace("Z", "+00:00"))
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()
    except (TypeError, ValueError, OverflowError):
        return None


def same_account(data, limits, now):
    """Do the fetched limits belong to the account THIS session is using?

    The fetch reads the machine's saved login, and every session follows that login (Claude Code
    re-reads the Keychain every 30 s), so they normally agree. They disagree for a while after an
    account switch: the cache can still hold the previous account's numbers (until the next fetch,
    longer if fetches fail), and an idle session's own rows stay on the previous account until its
    next request. Compare this session's 5h and 7d windows from stdin with the same windows in the
    fetched response: a different reset time (they are per account) or a fetched 7d share more than
    10 points BELOW this session's own means a different account.

    Returns "match", "mismatch", or "unknown" when no reset time could be compared (no stdin windows
    yet, or the response lacks them). "unknown" is NOT a match: showing an unconfirmed number is the
    fail-open found in the 2026-10-09 review. Residual, accepted: two accounts whose
    compared resets (5h and 7d, or the one window both sides carry) fall within 900 s of each other,
    with the fetched share not 10+ points low.
    """
    rl = data.get("rate_limits") if isinstance(data.get("rate_limits"), dict) else {}
    api = {lim.get("kind"): lim for lim in limits}
    compared = False
    for key, kind, pct_tol in (("five_hour", "session", None), ("seven_day", "weekly_all", 10)):
        mine, theirs = rl.get(key), api.get(kind)
        if not (isinstance(mine, dict) and isinstance(theirs, dict)):
            continue
        r1, r2 = epoch(mine.get("resets_at")), epoch(theirs.get("resets_at"))
        if r1 is not None and r2 is not None and r1 > now and r2 > now:
            if abs(r1 - r2) > 900:
                return "mismatch"
            compared = True
        if (r1 is not None and r1 <= now) or (r2 is not None and r2 <= now):
            continue  # one side was read before its window rolled over: its share is from another window
        p1, p2 = mine.get("used_percentage"), theirs.get("percent")
        # One-sided: an idle session's stdin share stays put while other sessions spend, so the fetched
        # share may run AHEAD of it; only a fetched share far BELOW this session's own is another account.
        if pct_tol and isinstance(p1, (int, float)) and isinstance(p2, (int, float)) and p2 < p1 - pct_tol:
            return "mismatch"
    return "match" if compared else "unknown"


def fable_window(data, now):
    """("ok", used percent, resets_at epoch, usage credits on?) for the Fable weekly limit; ("other",) when the fetched
    numbers belong to another account; ("unconfirmed",) when the account cannot be checked; None
    when there is nothing to show (lookup off, no fresh fetch, or this session has no plan windows yet)."""
    if not usage_fetch_on():
        return None  # off: a cache left by an earlier opted-in run is not shown
    c = read_usage_cache()
    if not isinstance(c.get("ok_at"), (int, float)) or not 0 <= now - c["ok_at"] <= USAGE_MAX_AGE_S:
        return None
    limits = [lim for lim in c.get("limits") or [] if isinstance(lim, dict)]
    for lim in limits:
        scope = lim.get("scope") if isinstance(lim.get("scope"), dict) else {}
        model = scope.get("model") if isinstance(scope.get("model"), dict) else {}
        if lim.get("kind") == "weekly_scoped" and str(model.get("display_name") or "").lower() == "fable":
            pct, reset = lim.get("percent"), epoch(lim.get("resets_at"))
            if not isinstance(pct, (int, float)) or (reset is not None and reset <= now):
                return None
            verdict = same_account(data, limits, now)
            if verdict == "mismatch":
                return ("other",)
            if verdict == "unknown":
                rl = data.get("rate_limits")
                # Before the session's first reply it has no session/week rows either; stay quiet.
                return ("unconfirmed",) if isinstance(rl, dict) and rl else None
            return ("ok", pct, reset, c.get("usage_credits") is True)
    return None


# ---------------------------------------------------------------- state for the repo's keep-warm gate

def write_state(data, now):
    """For the repo's keep-warm gate and usage-meter log.

    Writes <project>/.claude/state/statusline-<sid8>.json on every refresh, and appends one line to
    <project>/.claude/logs/usage-meter.jsonl at most once a minute per session. Only for a project
    that already HAS a .claude/state directory, so other projects are untouched. Never raises.
    """
    sid = str(data.get("session_id") or "")
    sid8 = sid.lower()[:8]
    project = (data.get("workspace") or {}).get("project_dir") or data.get("cwd") or ""
    state_dir = os.path.join(project, ".claude", "state")
    if not (sid8.replace("-", "").isalnum() and project and os.path.isdir(state_dir)):
        return
    rl = data.get("rate_limits") or {}
    five = rl.get("five_hour") if isinstance(rl, dict) else None
    seven = rl.get("seven_day") if isinstance(rl, dict) else None
    pc = data.get("prompt_cache") if isinstance(data.get("prompt_cache"), dict) else {}
    cw = data.get("context_window") if isinstance(data.get("context_window"), dict) else {}
    fable = fable_window(data, now)
    rec = {
        "ts": int(now),
        "sid8": sid8,
        "five_hour_pct": (five or {}).get("used_percentage") if isinstance(five, dict) else None,
        "five_hour_resets_at": (five or {}).get("resets_at") if isinstance(five, dict) else None,
        "seven_day_pct": (seven or {}).get("used_percentage") if isinstance(seven, dict) else None,
        # the weekly reset, which Claude Code's `rate_limits.seven_day` carries beside the share (CLI 2.1.307 builds
        # `seven_day: {used_percentage, resets_at}` exactly as for five_hour); scripts/hub-usage-watch.py prints it
        "seven_day_resets_at": (seven or {}).get("resets_at") if isinstance(seven, dict) else None,
        "fable_week_pct": fable[1] if fable and fable[0] == "ok" else None,
        "compact_threshold": compact_threshold(data),
        "context_tokens": cw.get("total_input_tokens"),
        "cache_warm": pc.get("warm"),
        "cache_ttl": pc.get("ttl"),
        "cache_expires_at": pc.get("expires_at"),
        "model": (data.get("model") or {}).get("id"),
        "cost_usd": (data.get("cost") or {}).get("total_cost_usd"),
    }
    path = os.path.join(state_dir, f"statusline-{sid8}.json")
    prev_ts = None
    try:
        with open(path) as fh:
            prev_ts = json.load(fh).get("logged_ts")
    except (OSError, ValueError, AttributeError):
        pass
    log_now = not isinstance(prev_ts, (int, float)) or now - prev_ts >= 60
    rec["logged_ts"] = int(now) if log_now else prev_ts
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as fh:
        json.dump(rec, fh)
    os.replace(tmp, path)
    if log_now:
        logs = os.path.join(project, ".claude", "logs")
        if os.path.isdir(logs):
            line = {k: v for k, v in rec.items() if k != "logged_ts"}
            with open(os.path.join(logs, "usage-meter.jsonl"), "a") as fh:
                fh.write(json.dumps(line) + "\n")


# ---------------------------------------------------------------- rows

def context_line(data):
    cw = data.get("context_window")
    if not isinstance(cw, dict):
        return None
    used = cw.get("total_input_tokens")
    size = cw.get("context_window_size")
    pct = cw.get("used_percentage")
    if cw.get("current_usage") is None or not isinstance(used, int) or used == 0:
        return dim("context".ljust(LABEL_W) + "updates after the next message")

    threshold = compact_threshold(data)
    if threshold:
        out = cw.get("total_output_tokens")
        used += out if isinstance(out, int) else 0
        frac = used / threshold
        lvl = level(frac, 0.7, 0.9)
        detail = f"{tokens(used)} / {tokens(threshold)}"
        detail += f" · {tokens(threshold - used)} to compact" if threshold > used else " · compacting"
    else:
        frac = (pct / 100) if isinstance(pct, (int, float)) else (used / size if size else 0)
        lvl = level(frac, 0.6, 0.8)
        detail = f"{tokens(used)}" + (f" / {tokens(size)}" if size else "")
    color = tint(lvl)
    detail = detail if lvl == 2 else dim(detail)  # critical: the detail drops its dimming
    return row("context", meter(frac, color), f"{round(frac * 100)}%", detail, color)


def window_line(data, now, key, label):
    """One plan window from stdin: `five_hour` as "session", `seven_day` as "week"."""
    rl = data.get("rate_limits")
    w = rl.get(key) if isinstance(rl, dict) else None
    if not isinstance(w, dict) or not isinstance(w.get("used_percentage"), (int, float)):
        return None
    p, reset = w["used_percentage"], w.get("resets_at")
    lvl = level(p / 100, 0.7, 0.9)
    words = ["LIMIT HIT" if p >= 100 else "near limit"] if lvl == 2 else []
    if isinstance(reset, (int, float)):
        words.append(f"resets {duration(reset - now)}")
    detail = " · ".join(words)
    detail = detail if lvl == 2 else dim(detail)  # critical: the detail drops its dimming
    return row(label, meter(p / 100, tint(lvl)), f"{round(p)}%", detail, tint(lvl))


def fable_line(data, now):
    fw = fable_window(data, now)
    if not fw:
        return None
    if fw[0] == "other":
        # The saved login's numbers are not this session's account; say so rather than show a wrong
        # number. NO early refetch: when the stale side is an idle SESSION (still on the account the
        # owner switched away from), no fetch can fix it, and a 20 s recheck here drew HTTP 429s from
        # the usage endpoint within minutes of going live (2026-10-09, an idle seat at 7d 89% vs 17%).
        # The normal 2-minute cycle catches a switch on the cache side.
        return row("fable", dim("─" * BAR_W), "–", dim("saved login is another account"))
    if fw[0] == "unconfirmed":
        return row("fable", dim("─" * BAR_W), "–", dim("can't confirm this session's account"))
    _, p, reset, credits = fw
    lvl = level(p / 100, 0.7, 0.9)
    if lvl == 0 and reset:
        elapsed = 1 - (reset - now) / WEEK_S  # share of the week gone
        if elapsed >= 0.25 and p / 100 > elapsed:
            lvl = 1  # ahead of pace: on track to run out before the reset
    color = tint(lvl)
    when = f"resets {duration(reset - now)}" if reset else ""
    # Past the limit Fable runs on usage credits only when the account has them switched on (and
    # not at their spend limit); otherwise it stops. Unknown reads as off, so the row never claims a
    # charge that will not happen (the rule dates from a "paid credits" row once shown on an
    # account with credits off).
    if p >= 100:
        word = "ON USAGE CREDITS" if credits else "LIMIT HIT"
        detail = RED + BOLD + word + (" · " + when if when else "") + RESET
    elif p >= 90:
        detail = ("then usage credits" if credits else "near limit") + (" · " + when if when else "")
    else:
        detail = dim(when)
    return row("fable", meter(p / 100, color), f"{round(p)}%", detail, color)


AGENT_CACHE_DIR = os.path.expanduser("~/.claude/statusline-cache")
AGENT_PARSE_BUDGET_S = 0.4  # per refresh; offsets persist, so a big backlog finishes over later refreshes
COLD_RECENT_S = 600  # the cold count is highlighted for this long after it last rose


def session_cost(data):
    """This session's estimated cost at API prices (Claude Code's own cost.total_cost_usd, the /cost figure), fit to 4 chars."""
    c = (data.get("cost") or {}).get("total_cost_usd") if isinstance(data.get("cost"), dict) else None
    if isinstance(c, bool) or not isinstance(c, (int, float)) or not 0 < c < 1e9:  # also NaN, inf, absurd
        return None
    if c < 9.95:
        return f"${c:.1f}"
    if c < 999.5:
        return f"${round(c)}"
    return f"${round(c / 1000)}k" if c < 999_500 else "$1M+"


def cost_only(data):
    money = session_cost(data)
    return row("cost", " " * BAR_W, money, dim("this session, est.")) if money else None


# Remote Control. In fullscreen Claude Code
# drops its own /rc badge from the bottom row and draws it only in the startup banner (2.1.296: the footer passes
# !fullscreen to the badge hook, the banner passes fullscreen), so this marker is the indicator that stays on screen.
# The state is the newest "bridge-session" record in this session's transcript: its bridgeSessionId is the remote
# session id while Remote Control is on and "" once it is turned off. Those records can sit 60 MB back (measured
# 2026-10-13 over 40 transcripts), so the file is read once backward in growing windows up to RC_SCAN_CAP and then
# only its new bytes, with the offset kept in ~/.claude/statusline-cache/<sid8>-rc.json.
RC_NEEDLE = b'"type":"bridge-session"'
RC_SCAN_CAP = 64 * 1024 * 1024


def rc_state_in(buf):
    """On (True) / off (False) from the LAST bridge-session record in buf, or None when buf holds none."""
    end = len(buf)
    while True:
        i = buf.rfind(RC_NEEDLE, 0, end)
        if i < 0:
            return None
        s = buf.rfind(b"\n", 0, i) + 1
        e = buf.find(b"\n", i)
        try:
            rec = json.loads(buf[s:e if e >= 0 else len(buf)])
            if isinstance(rec, dict) and rec.get("type") == "bridge-session":
                return bool(rec.get("bridgeSessionId"))
        except (ValueError, RecursionError):  # RecursionError: a pathologically nested line, as main() handles stdin
            pass
        end = s


def remote_control_on(data):
    """True / False for this session's Remote Control, or None when its transcript has never recorded it."""
    tp = data.get("transcript_path") or ""
    sid8 = str(data.get("session_id") or "").lower()[:8]
    if not (tp.endswith(".jsonl") and sid8.replace("-", "").isalnum()):
        return None
    size = os.path.getsize(tp)
    cpath = os.path.join(AGENT_CACHE_DIR, f"{sid8}-rc.json")
    try:
        with open(cpath) as fh:
            cache = json.load(fh)
    except (OSError, ValueError):
        cache = {}
    start = cache.get("offset") if isinstance(cache, dict) and cache.get("path") == tp else None
    if isinstance(start, bool):  # a bool is an int to isinstance; never a byte offset
        start = None
    state, offset = None, None
    with open(tp, "rb") as fh:
        if isinstance(start, int) and 0 <= start <= size and size - start <= RC_SCAN_CAP:
            state = cache.get("state") if cache.get("state") in (True, False) else None
            fh.seek(start)
            buf = fh.read(size - start)
            end = buf.rfind(b"\n") + 1           # whole lines only; a half-written last line is read next time
            found = rc_state_in(buf[:end])
            if found is not None:
                state = found
            offset = start + end
        else:
            for win in sorted({min(w, RC_SCAN_CAP) for w in (1 << 20, 1 << 22, 1 << 24, RC_SCAN_CAP)}):
                lo = max(0, size - win)
                fh.seek(lo)
                buf = fh.read(size - lo)
                skip = buf.find(b"\n") + 1 if lo > 0 else 0   # drop the window's partial first line
                end = buf.rfind(b"\n") + 1
                state = rc_state_in(buf[skip:end]) if end > skip else None
                offset = lo + end
                if state is not None or lo == 0:
                    break
    try:
        os.makedirs(AGENT_CACHE_DIR, exist_ok=True)
        tmp = f"{cpath}.{os.getpid()}.tmp"  # per process, as agents_line does: two overlapping refreshes never share one
        with open(tmp, "w") as fh:
            json.dump({"path": tp, "offset": offset, "state": state}, fh)
        os.replace(tmp, cpath)
    except OSError:
        pass
    return state


def remote_marker(data):
    """"● remote on" while Remote Control is TURNED ON for this session, else None; placed by place_right.

    It cannot show the link's health, so it says "on", never "connected". Measured 2026-10-13 over the 60 newest
    transcripts: 50,256 bridge-session records (the attached remote id, or "" when off) and 63 "is active" notes,
    and not one reconnecting / disconnected / error record; the status-line input carries no link state either.
    Claude Code's own badge reads that state from memory, so after a network drop it says reconnecting while this
    marker still says on.
    """
    if remote_control_on(data) is not True:
        return None
    return ACCENT + "\u25cf remote on" + RESET


RIGHT_GAP = 3
# Claude Code (2.1.296) draws the status line inside the footer box, paddingX 2 on each side outside fullscreen
# (`Dr=Qn?0:k1e`, k1e=2), and cuts each line at the box edge (wrap:"truncate"), while COLUMNS is the whole terminal
# (process.stdout.columns). A line padded to COLUMNS-1 therefore lost its last 3 columns: "● remot…".
FOOTER_INSET = 4


def place_right(lines, marker, cols=None):
    """Put `marker` at the right end of the TOP line. Right-aligned to the terminal edge when Claude Code passes
    COLUMNS (FOOTER_INSET + 1 columns short of it, so the footer box never cuts the marker), else to the widest line; on its own right-aligned
    line when the top line has no room, as in a narrow, stacked layout."""
    if not marker:
        return lines
    m = visible(marker)
    width = (cols - 1 - FOOTER_INSET) if cols and cols > 1 + FOOTER_INSET else max([visible(s) for s in lines] + [m])
    if lines and visible(lines[0]) + RIGHT_GAP + m <= width:
        return [lines[0] + " " * (width - visible(lines[0]) - m) + marker] + list(lines[1:])
    return list(lines) + [" " * max(0, width - m) + marker]


def agents_line(data, now):
    """This session's cost row: the harness's cost estimate, the sub-agent count and their cold re-caches.

    Claude Code's prompt_cache object leaves sub-agent requests out, so this reads the session's
    <transcript>/subagents/agent-*.jsonl files directly. Parsing is incremental: per-file byte offsets and
    running totals live in ~/.claude/statusline-cache/<sid8>.json, and each refresh reads only new bytes,
    within a time budget. A COLD re-cache is a request that read under half of the agent's previous
    context from cache and wrote more than 2,000 tokens (same predicate as the 2026-10-07 7-day measurement:
    219 such events, 64.4M tokens re-written, 177 of them after a 5-60 minute pause).
    """
    tp = data.get("transcript_path") or ""
    sid8 = str(data.get("session_id") or "").lower()[:8]
    if not (tp.endswith(".jsonl") and sid8.replace("-", "").isalnum()):
        return cost_only(data)
    sub = tp[:-len(".jsonl")] + "/subagents"
    if not os.path.isdir(sub):
        return cost_only(data)
    files = [f for f in os.listdir(sub) if f.startswith("agent-") and f.endswith(".jsonl")]
    if not files:
        return cost_only(data)
    cpath = os.path.join(AGENT_CACHE_DIR, f"{sid8}.json")
    try:
        with open(cpath) as fh:
            cache = json.load(fh)
        if cache.get("dir") != sub:
            cache = {}
    except (OSError, ValueError):
        cache = {}
    cache["dir"] = sub
    was_partial = cache.get("partial", True)
    per = cache.setdefault("files", {})
    start = time.monotonic()
    for name in sorted(files):
        st = per.setdefault(name, {"off": 0, "req": 0, "read": 0, "write": 0, "inp": 0, "w1h": 0, "w5m": 0,
                                     "colds": 0, "coldw": 0, "prevctx": 0, "rid": None})
        path = os.path.join(sub, name)
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size < st["off"]:  # rewritten file: start over
            st.update(off=0, req=0, read=0, write=0, inp=0, w1h=0, w5m=0, colds=0, coldw=0, prevctx=0, rid=None)
        if size == st["off"]:
            continue
        if time.monotonic() - start > AGENT_PARSE_BUDGET_S:
            cache["partial"] = True
            break
        with open(path, "rb") as fh:
            fh.seek(st["off"])
            chunk = fh.read()
        end = chunk.rfind(b"\n")
        if end < 0:
            continue
        st["off"] += end + 1
        for raw in chunk[:end].split(b"\n"):
            if b'"usage"' not in raw:
                continue
            try:
                r = json.loads(raw)
            except ValueError:
                continue
            if r.get("type") != "assistant":
                continue
            rid = r.get("requestId") or (r.get("message") or {}).get("id")
            if rid and rid == st["rid"]:
                continue
            u = (r.get("message") or {}).get("usage") or {}
            rd = u.get("cache_read_input_tokens") or 0
            wr = u.get("cache_creation_input_tokens") or 0
            inp = u.get("input_tokens") or 0
            # A usage-limit or API-error record carries ZERO usage; counting it would reset the agent's
            # previous context to 0 and hide the cold resume after it (measured 2026-10-07:
            # 66 limit-caused re-caches / 12.0M hidden that way). Skip it entirely.
            if r.get("error") or r.get("isApiErrorMessage") or rd + wr + inp == 0:
                continue
            st["rid"] = rid
            cc = u.get("cache_creation") or {}
            st["w1h"] += cc.get("ephemeral_1h_input_tokens") or 0
            st["w5m"] += cc.get("ephemeral_5m_input_tokens") or 0
            if st["req"] and st["prevctx"] > 20000 and rd < 0.5 * st["prevctx"] and wr > 2000:
                st["colds"] += 1
                st["coldw"] += wr
            st["req"] += 1
            st["read"] += rd
            st["write"] += wr
            st["inp"] += inp
            st["prevctx"] = rd + wr + inp
    else:
        cache["partial"] = False
    t = {k: sum(v.get(k, 0) for v in per.values()) for k in ("req", "read", "write", "inp", "w1h", "w5m", "colds", "coldw")}
    # When did the cold count last rise? A rise found while catching up a backlog is history, not news.
    if "cold_seen" in cache and t["colds"] > cache["cold_seen"] and not was_partial:
        cache["cold_at"] = int(now)
    cache["cold_seen"] = t["colds"]
    try:
        os.makedirs(AGENT_CACHE_DIR, exist_ok=True)
        tmp = f"{cpath}.{os.getpid()}.tmp"
        with open(tmp, "w") as fh:
            json.dump(cache, fh)
        os.replace(tmp, cpath)
    except OSError:
        pass
    if not t["req"]:
        return cost_only(data)
    # Neither the cache-hit % nor a raw token count means anything to the reader; the number that
    # does is what the session costs. Claude Code's cost.total_cost_usd is that estimate (API prices).
    # Waste stays on the cold count.
    # Same word as the cache row's misses ("cold" beside "misses" read as two different things).
    cold = f"{t['colds']} agent miss" + ("" if t["colds"] == 1 else "es") + (f" ({tokens(t['coldw'])} re-cached)" if t["colds"] else "")
    recent = isinstance(cache.get("cold_at"), (int, float)) and now - cache["cold_at"] < COLD_RECENT_S
    text = dim("this session, est. · ")
    text += (BOLD + YELLOW + cold + RESET) if recent else dim(cold)
    if cache.get("partial"):
        text += dim(" · counting…")
    return row("cost", f"{len(files)} agents".ljust(BAR_W), session_cost(data) or "", text)


ANSI = re.compile(r"\x1b\[[0-9;]*m")
COLUMN_GAP = "    "
LEFT_DETAIL_FLOOR = 36  # the left column is at least this wide in detail text, so the right one rarely shifts


def visible(s):
    return len(ANSI.sub("", s))


def term_columns():
    """COLUMNS as Claude Code sets it for the status line, or None when absent or not a number."""
    try:
        return int(os.environ.get("COLUMNS", ""))
    except ValueError:
        return None


def layout(left, right):
    """Two columns, left = this conversation (cache, context, agents), right = plan allowance
    (session, week, fable). Stacked in one column when COLUMNS
    (set by Claude Code for the status line) says the pair would not fit."""
    left, right = [s for s in left if s], [s for s in right if s]
    if not left or not right:
        return left + right
    width = max([visible(s) for s in left] + [LABEL_W + BAR_W + 2 + VALUE_W + 3 + LEFT_DETAIL_FLOOR])
    cols = term_columns()
    if cols and width + len(COLUMN_GAP) + max(visible(s) for s in right) > cols:
        return left + right
    lines = []
    for i in range(max(len(left), len(right))):
        l = left[i] if i < len(left) else ""
        r = right[i] if i < len(right) else ""
        lines.append((l + " " * (width - visible(l)) + COLUMN_GAP + r) if r else l)
    return lines


def main():
    if sys.argv[1:] == ["--refresh-usage"]:
        try:
            refresh_usage()
        except Exception:
            pass
        return
    try:
        data = json.load(sys.stdin)
    except Exception:  # ValueError, and RecursionError on pathologically nested input
        return
    now = time.time()
    try:
        maybe_refresh_usage(now)
    except Exception:
        pass
    try:
        write_state(data, now)
    except Exception:
        pass
    def safe(build):
        try:
            return build()
        except Exception:
            return None

    left = [safe(lambda: cache_line(data, now)), safe(lambda: context_line(data)), safe(lambda: agents_line(data, now))]
    right = [safe(lambda: window_line(data, now, "five_hour", "session")),
             safe(lambda: window_line(data, now, "seven_day", "week")), safe(lambda: fable_line(data, now))]
    try:
        lines = layout(left, right)
    except Exception:
        lines = [s for s in left + right if s]
    marker = safe(lambda: remote_marker(data))
    try:
        lines = place_right(lines, marker, term_columns())
    except Exception:
        pass
    if lines:
        try:  # write UTF-8 whatever the locale says, so a non-UTF-8 LANG cannot raise
            sys.stdout.buffer.write(("\n".join(lines) + "\n").encode("utf-8", "replace"))
            sys.stdout.flush()
        except Exception:
            pass


if __name__ == "__main__":
    main()
