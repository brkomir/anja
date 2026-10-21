#!/usr/bin/env python3
"""mail-stats — retrospective analysis of cross-session mail traffic.

Reads the persisted mail drops in .claude/state/session-mail/ and reports how
parallel sessions are actually using the deliver-and-surface mail channel:
consumption (read-rate), the LIVE-vs-EXITED unread split (the "is a session-start
listener worth it?" signal), read-latency, volume, and the sender->recipient graph.

This is the MEASUREMENT INSTRUMENT for the experiment of arming mail-listen at
every session start. Run with `--since <experiment start date>` to
compare post-experiment consumption against the pre-experiment baseline (44%
read-rate at experiment start, the pre-arm figure). If the read-rate does not materially rise AND the
unread is dominated by EXITED recipients (which no listener can fix), the
session-start arm-directive is not earning its cost -> retire it.

Sources, in order of authority: from 2026-07-02 the DURABLE events log
(.claude/logs/mail-events.jsonl — send / read / surfaced-live lines emitted by
session-manifest.py's _log_mail_event) is authoritative; the mail STORE itself is
TTL-pruned at every session start (24h read / 72h unread), so disk-state is only
a trailing ~72h sample. Disk drops not present in the log (the pre-log era) are
merged in as a fallback.

Stdlib only (no pip), inline markdown output (no HTML / no file write) per the
project's reporting conventions. Degrades cleanly on missing/malformed drops.

Usage:
  python3 scripts/mail-stats.py                 # all drops
  python3 scripts/mail-stats.py --since 2026-06-22
  python3 scripts/mail-stats.py --json          # machine-readable
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ANCHOR TO THE SCRIPT, NOT THE CWD (sibling sweep 2026-07-10). This script is
# hook-invoked, and a hook inherits the Bash tool's cwd — so bare relative paths silently read an
# empty/absent tree from any subdirectory and report ZERO mail rather than erroring. Same class as
# meta-corrections-scan.py's DEFAULT_REGISTRY; session-manifest.py + session-lifecycle.py were the
# already-correct precedent.
REPO_DIR = Path(__file__).resolve().parent.parent
STATE_DIR = REPO_DIR / ".claude/state"
MAIL_DIR = STATE_DIR / "session-mail"
# Durable event log (send / read / surfaced-live) — authoritative from 2026-07-02 onward;
# the drop files above are TTL-pruned (24h read / 72h unread) so they can't answer a
# ~2-week window on their own.
EVENTS_LOG = REPO_DIR / ".claude/logs/mail-events.jsonl"

# Status derivation delegates to the fleet SSOT (scripts/session_status.py) — this
# file carried a FOURTH divergent copy (bare marker-exists, the one-way
# latch), and its exited/live split feeds the listener-graduation numbers
# (read-rate 89% / addressable gap 0.6%). A false EXITED moves a message OUT of
# the addressable gap — the direction that makes the listener look better than it is.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import session_status  # noqa: E402

SESSIONS_DIR = Path(
    os.environ.get("FF_SESSIONS_DIR")
    or os.path.expanduser("~/.claude/projects/<project-key>"))
_exited_memo: dict[str, bool] = {}


def _parse_frontmatter(path: Path) -> dict:
    """Pull from/to/subject/created from a drop's YAML-ish frontmatter block."""
    fields: dict[str, str] = {}
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            in_fm = False
            for line in fh:
                s = line.rstrip("\n")
                if s == "---":
                    if in_fm:
                        break  # end of frontmatter
                    in_fm = True
                    continue
                if in_fm and ":" in s:
                    k, _, v = s.partition(":")
                    fields[k.strip()] = v.strip()
    except OSError:
        pass
    return fields


def _created_epoch(created: str) -> float | None:
    """ISO-8601 'created' (e.g. 2026-06-21T16:20:56Z) -> UTC epoch seconds."""
    if not created:
        return None
    try:
        iso = created.replace("Z", "+00:00")
        return datetime.fromisoformat(iso).timestamp()
    except ValueError:
        return None


def _recipient_exited(to: str) -> bool:
    """A direct recipient is EXITED per the SSOT derivation (marker + record-supersede +
    wrapped interplay) — NOT bare marker existence. Memoized: one derivation per sid/run."""
    if not to or to == "all":
        return False
    if to not in _exited_memo:
        _exited_memo[to] = session_status.lifecycle_status(
            to, str(STATE_DIR), str(SESSIONS_DIR)) == "EXITED"
    return _exited_memo[to]


def _basename_fields(mail: str) -> tuple[str | None, float | None, str | None]:
    """(recipient, created-epoch, sender) from a drop basename `{to}__{ns}__{from}.md`.
    Fallback identity when an event record lacks a send event (log started mid-life)."""
    stem = mail[:-3] if mail.endswith(".md") else mail
    parts = stem.split("__")
    if len(parts) >= 3:
        created = None
        try:
            created = int(parts[1]) / 1e9  # sender-set ns timestamp in the filename
        except ValueError:
            pass
        return parts[0], created, parts[-1]
    return None, None, None


_EXCLUDED = [0]  # module-level tally of channel events filtered out of the default denominator


def load_event_records(include_channels: bool = False) -> tuple[dict[str, dict], bool]:
    """Parse the durable events log into per-mail records keyed by drop basename.
    Record: {sender, recipient, created, read, read_ts, surfaced_live}. Degrades
    cleanly on a missing log (pre-log era) or malformed lines.

    fleet-channels: events carrying a `channel:` field are EXCLUDED by
    default — one 5-seat channel run would inject ~60% contamination into the
    default-bus read-rate that graduated the standing mail-listen directive
    (design §2 instrument protection). `--include-channels` opts back in."""
    recs: dict[str, dict] = {}
    if not EVENTS_LOG.is_file():
        return recs, False
    try:
        with EVENTS_LOG.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                mail = e.get("mail") or ""
                if not mail:
                    continue
                if e.get("channel") and not include_channels:
                    _EXCLUDED[0] += 1  # counted so render() can TELL the reader (silent-filter fix)
                    continue  # channel traffic is off the default-bus denominator (see docstring)
                ts = _created_epoch(e.get("ts", ""))
                r = recs.setdefault(mail, {
                    "sender": None, "recipient": None, "created": None,
                    "read": False, "read_ts": None, "surfaced_live": False,
                })
                ev = e.get("event")
                if ev == "send":
                    r["created"] = ts
                    r["recipient"] = e.get("recipient")
                    r["sender"] = e.get("sender")
                elif ev == "read":
                    r["read"] = True
                    if r["read_ts"] is None:
                        r["read_ts"] = ts
                    # NB: a read event's own `recipient` is the CONSUMER (≠ 'all' for a
                    # broadcast) — the record's recipient stays the send-time addressee.
                elif ev == "surfaced-live":
                    r["surfaced_live"] = True
    except OSError:
        pass
    return recs, True


def collect_from_events(recs: dict[str, dict], since_epoch: float | None) -> list[dict]:
    """Event records -> drop dicts (same shape as collect()'s disk drops)."""
    drops: list[dict] = []
    for mail, r in recs.items():
        b_to, b_created, b_frm = _basename_fields(mail)
        created = r["created"] if r["created"] is not None else b_created
        recipient = r["recipient"] or b_to or "?"
        sender = r["sender"] or b_frm or "?"
        if since_epoch is not None and (created is None or created < since_epoch):
            continue
        latency_min = None
        if r["read"] and r["read_ts"] is not None and created is not None:
            latency_min = (r["read_ts"] - created) / 60.0
        drops.append(
            {
                "mail": mail,
                "sender": sender,
                "recipient": recipient,
                "created": created,
                "read": r["read"],
                "broadcast": recipient == "all",
                "exited_recipient": (not r["read"]) and _recipient_exited(recipient),
                "seen_receipt": r["surfaced_live"],
                "latency_min": latency_min,
            }
        )
    return drops


def collect(since_epoch: float | None) -> list[dict]:
    drops: list[dict] = []
    if not MAIL_DIR.is_dir():
        return drops
    for path in sorted(MAIL_DIR.iterdir()):
        name = path.name
        # receipts are metadata, never drops: `.read-by-<sid>` (broadcast consume
        # receipt) must not inflate volume counts.
        if ".read-by-" in name:
            continue
        if name.endswith(".md.read"):
            read = True
        elif name.endswith(".md"):
            read = False
        else:
            continue  # not a drop file
        base = name[:-5] if read else name  # original drop basename (dedupe key vs events log)
        fm = _parse_frontmatter(path)
        created = _created_epoch(fm.get("created", ""))
        if since_epoch is not None and (created is None or created < since_epoch):
            continue
        sender = fm.get("from", "?")
        recipient = fm.get("to", "?")
        # read-latency: when the .read rename happened (mtime) minus when it was sent
        latency_min = None
        if read and created is not None:
            try:
                latency_min = (path.stat().st_mtime - created) / 60.0
            except OSError:
                pass
        drops.append(
            {
                "mail": base,
                "sender": sender,
                "recipient": recipient,
                "created": created,
                "read": read,
                "broadcast": recipient == "all",
                "exited_recipient": (not read) and _recipient_exited(recipient),
                # disk-state carries NO listener-receipt info (pre-log era only —
                # surfaced-live lives exclusively in the durable events log)
                "seen_receipt": False,
                "latency_min": latency_min,
            }
        )
    return drops


def _median(nums: list[float]) -> float | None:
    if not nums:
        return None
    s = sorted(nums)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def summarize(drops: list[dict]) -> dict:
    total = len(drops)
    read = [d for d in drops if d["read"]]
    unread = [d for d in drops if not d["read"]]
    unread_exited = [d for d in unread if d["exited_recipient"]]
    unread_broadcast = [d for d in unread if d["broadcast"]]
    unread_live = [d for d in unread if not d["exited_recipient"] and not d["broadcast"]]
    # surfaced-live: unread on disk, but a non-consuming mail-listen left a `.seen-by-*` receipt
    unread_surfaced_live = [d for d in unread if d.get("seen_receipt")]
    unread_live_no_receipt = [d for d in unread_live if not d.get("seen_receipt")]
    latencies = [d["latency_min"] for d in read if d["latency_min"] is not None]

    by_sender: dict[str, int] = {}
    by_recipient: dict[str, int] = {}
    edges: dict[str, int] = {}
    for d in drops:
        by_sender[d["sender"]] = by_sender.get(d["sender"], 0) + 1
        by_recipient[d["recipient"]] = by_recipient.get(d["recipient"], 0) + 1
        edges[f"{d['sender']} -> {d['recipient']}"] = edges.get(f"{d['sender']} -> {d['recipient']}", 0) + 1

    return {
        "channel_excluded": _EXCLUDED[0],
        "total": total,
        "read": len(read),
        "read_pct": round(100 * len(read) / total) if total else 0,
        "unread": len(unread),
        "unread_exited": len(unread_exited),
        "unread_live": len(unread_live),
        "unread_surfaced_live": len(unread_surfaced_live),
        "unread_live_no_receipt": len(unread_live_no_receipt),
        "unread_broadcast": len(unread_broadcast),
        "median_latency_min": _median(latencies),
        "broadcasts": sum(1 for d in drops if d["broadcast"]),
        "direct": sum(1 for d in drops if not d["broadcast"]),
        "by_sender": dict(sorted(by_sender.items(), key=lambda kv: -kv[1])),
        "by_recipient": dict(sorted(by_recipient.items(), key=lambda kv: -kv[1])),
        "edges": dict(sorted(edges.items(), key=lambda kv: -kv[1])),
    }


def render(s: dict, window: str) -> str:
    out: list[str] = []
    out.append(f"## mail-stats — cross-session mail traffic ({window})")
    out.append("- Provenance: disk-state is TTL-truncated (24h read / 72h unread at every session start); "
               "the events log (`.claude/logs/mail-events.jsonl`) is authoritative from 2026-07-02 onward"
               + ("." if s.get("events_log_present") else " — LOG NOT FOUND YET, disk-only (trailing ~72h sample)."))
    out.append("")
    if s["total"] == 0:
        out.append("_No mail drops in window._")
        return "\n".join(out)

    lat = s["median_latency_min"]
    lat_str = f"{lat:.0f} min" if lat is not None else "n/a"
    out.append("### Consumption (the worth-it headline)")
    out.append(f"- **Read-rate: {s['read']}/{s['total']} ({s['read_pct']}%)**  ·  median drop→read latency {lat_str}")
    # SILENT-FILTER TELL (2026-07-28): the channel exclusion lives in the
    # docstring + a flag — neither of which the READER of this number ever sees. A filtered
    # denominator reported as the whole is the instrument class that cost four seats on
    # 2026-07-27. Zero-case stays silent (no noise before the first channel run).
    if s.get("channel_excluded"):
        out.append(f"- ⚠️ Excluded: {s['channel_excluded']} fleet-channel event(s) — this "
                   f"read-rate measures the DEFAULT BUS only (`--include-channels` to opt in)")
    out.append(f"- **Surfaced-live (listener receipt): {s['unread_surfaced_live']}** — unread, but a "
               "non-consuming mail-listen surfaced it (`surfaced-live` event); invisible to read-rate by design")
    out.append(f"- Unread: {s['unread']}")
    out.append(f"  - → **EXITED** recipient (a listener CANNOT help): {s['unread_exited']}")
    out.append(f"  - → **LIVE** recipient (raw, incl. listener-surfaced): {s['unread_live']}")
    out.append(f"  - → **LIVE recipient, NO receipt (the true addressable gap): {s['unread_live_no_receipt']}**")
    out.append(f"  - broadcasts to `all` (no single reader): {s['unread_broadcast']}")
    out.append("")
    out.append("### Volume")
    out.append(f"- direct: {s['direct']}  ·  broadcast: {s['broadcasts']}")
    out.append("- by sender: " + ", ".join(f"`{k}`×{v}" for k, v in list(s["by_sender"].items())[:8]))
    out.append("- by recipient: " + ", ".join(f"`{k}`×{v}" for k, v in list(s["by_recipient"].items())[:8]))
    out.append("")
    out.append("### Edges (sender → recipient)")
    for edge, n in list(s["edges"].items())[:12]:
        out.append(f"- {edge}  ×{n}")
    out.append("")
    out.append("### Read this:")
    out.append("- Key any keep/retire decision on **listener-receipt coverage of the LIVE slice**, "
               "NOT read-rate alone: the listener is deliberately NON-consuming (never archives), so read-rate "
               "is structurally blind to every drop it surfaces. A `surfaced-live` receipt on an unread drop "
               "means the listener DID its job.")
    if s["unread_live_no_receipt"] == 0 and s["unread_surfaced_live"] > 0:
        out.append("- ✅ Every LIVE-recipient unread carries a listener receipt — the listener is consuming "
                   "the addressable gap. Points KEEP.")
    elif s["unread_live_no_receipt"] == 0 and s["unread_exited"] > 0:
        out.append("- ⚠️ Unread is dominated by EXITED recipients — a session-start listener can't move these. "
                   "The win comes only from the LIVE no-receipt slice; if it stays ~0 with no receipts either, "
                   "the arm-directive isn't earning its cost.")
    elif s["unread_live_no_receipt"] > 0:
        out.append(f"- {s['unread_live_no_receipt']} unread went to a LIVE recipient with NO listener receipt — "
                   "the true addressable gap a session-start listener should have caught. Track whether this "
                   "drops once arming is universal.")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Retrospective cross-session mail-traffic stats.")
    ap.add_argument("--since", help="Only count drops created on/after this date (YYYY-MM-DD).")
    ap.add_argument("--json", action="store_true", help="Machine-readable JSON instead of markdown.")
    ap.add_argument("--include-channels", action="store_true",
                    help="Include fleet-channel traffic (excluded by default — it would contaminate the default-bus read-rate denominator).")
    args = ap.parse_args()

    since_epoch = None
    window = "all drops"
    if args.since:
        try:
            since_epoch = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).timestamp()
            window = f"since {args.since}"
        except ValueError:
            print(f"Bad --since date: {args.since!r} (want YYYY-MM-DD)", file=sys.stderr)
            return 2

    # Events log first (durable, survives the store's TTL prune); disk drops the log has
    # never seen (pre-log era) are merged in as the fallback, deduped by drop basename.
    recs, log_present = load_event_records(include_channels=args.include_channels)
    drops = collect_from_events(recs, since_epoch)
    drops += [d for d in collect(since_epoch) if d["mail"] not in recs]
    summary = summarize(drops)
    summary["events_log_present"] = log_present
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(render(summary, window))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
