#!/usr/bin/env python3
"""Does SECRET_SHAPES in instinct-sweep.py catch everything .githooks/pre-push's push scan catches?

The spec promises it, and a hand comparison of the two is easy to get wrong, so this measures it: the scan's own
patterns, lifted verbatim and run by perl, against the script's, over one planted value per pattern arm in 46 contexts.
Exit 0 only when: every name in the scan has a planted value, each value trips its own pattern, nothing is caught by the
scan alone (push-only) and nothing planted is caught by neither. Prints counts and names, never a value. The values are
synthetic and built from parts, so neither this file nor the scan's own review reads one as a literal.
The scan is the pre-push git hook, which the copy does not ship: this reads the block from `@n = qw(` to
`($f, $h) = ("?", 0);` in `.githooks/pre-push`, so supply your own push scan of that shape there, or drop this check.
R1 below is a placeholder for the database project ref that the scan's connection-string pattern keys on: set it to
yours, or the postgres values trip only the sweep's shapes and the check fails."""
import collections
import importlib.util
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("isw", os.path.join(HERE, "instinct-sweep.py"))
isw = importlib.util.module_from_spec(spec)
sys.modules["isw"] = isw
spec.loader.exec_module(isw)

R1 = "abcdefghij" + "klmnopqrst"
A = "a1B2" * 12
VALUES = {
    "anthropic-api-key": ["sk" + "-ant-" + "api03-" + A],
    "openai-project-key": ["sk" + "-proj-" + A],
    "aws-access-key-id": ["AK" + "IA" + "QWERTYUIASDF1234"],
    "github-token": [p + "_" + "Q7r2" * 9 for p in ("gh" + "p", "gh" + "o", "gh" + "u", "gh" + "s", "gh" + "r")],
    "github-fine-grained-pat": ["github" + "_pat_" + "Q7r2" * 10],
    "paddle-api-key": ["pd" + "l_live_apikey_" + "Q7r2" * 6, "pd" + "l_sdbx_apikey_" + "Q7r2" * 6],
    "supabase-secret-key": ["sb_" + "secret_" + "Q7r2" * 6],
    "sentry-auth-token": ["sn" + "trys_" + "Q7r2" * 11],
    "jwt": ["ey" + "J" + "Q7r2" * 6 + ".ey" + "J" + "Q7r2" * 6 + "." + "Q7r2" * 6],
    "discord-webhook-url": ["disc" + "ord.com/api/web" + "hooks/" + "1234567890/" + "Q7r2" * 8,
                            "disc" + "ordapp.com/api/web" + "hooks/" + "1234567890/" + "Q7r2" * 8],
    "private-key-block": ["-----BEG" + "IN PRIVATE KEY", "-----BEG" + "IN RSA PRIVATE KEY",
                          "-----BEG" + "IN OPENSSH PRIVATE KEY"],
    "openai-api-key": ["sk" + "-svcacct-" + A, "sk" + "-admin-" + A, "sk" + "-" + A],
    "paddle-webhook-secret": ["pd" + "l_ntfset_" + "Q7r2" * 6],
    "resend-api-key": ["r" + "e_" + "Q7r2Q7r2" + "_" + "Q7r2" * 5],
    "webhook-signing-secret": ["wh" + "sec_" + "Q7r2" * 7],
    "supabase-access-token": ["sb" + "p_" + "a1b2c3d4" * 5],
    "posthog-personal-api-key": ["ph" + "x_" + "Q7r2" * 8],
    "pgpassword": ["PGPASS" + "WORD=" + "abc1", "PGPASS" + "WORD: " + "abc1", "PGPASS" + "WORD = '" + "abc1'"],
    "postgres-url-with-password": [
        "postgresql" + "://postgres:" + "Q7r2Q7r2@db." + R1 + ".example.invalid:5432/postgres",
        "postgres" + "://postgres." + R1 + ":" + "Q7r2Q7r2@" + "pooler.example.invalid:6543/postgres",
        "postgresql" + "://u@db." + R1 + ".example.invalid/postgres?ssl=1&pass" + "word=Q7r2Q7r2",
        "postgresql" + "+asyncpg://postgres:" + "Q7r2Q7r2@db." + R1 + ".example.invalid/postgres",
        "POSTGRES" + "://postgres:" + "Q7r2Q7r2@db." + R1 + ".example.invalid/postgres",
        "postgresql" + "://:" + "Q7r2Q7r2@db." + R1 + ".example.invalid/postgres",
        "postgresql" + "://postgres:/" + "Q7r2Q7r2@db." + R1 + ".example.invalid/postgres",
        "postgresql" + "://postgres:Q7/" + "r2Q7r2@db." + R1 + ".example.invalid/postgres",
        "postgres" + "://postgres." + R1 + ":/" + "Q7r2Q7r2@" + "pooler.example.invalid:6543/postgres",
        "postgresql" + "://postgres:" + "Q7r2Q7r2?x@db." + R1 + ".example.invalid/postgres",
        "postgresql" + "://postgres:" + "\"Q7r2Q7r2@db." + R1 + ".example.invalid/postgres",
    ],
}
CONTEXTS = ("", " ", "=", ":", '"', "'", "`", "(", "/", ".", "-", "_", "x", "X", "7", "\\n", "\\t", "\\r", "\\b", "\\f",
            "\\x0a", "\\u000a", "%20", "%0A", "%3D", "%253D", "=3D", "=0A", "\\012", "\\0", "\\a", "\\v", "\\e",
            "\x1b[32m", "\\u001b[32m", "\\e[1m", "&#10;", "&amp;", "%u000a", "\\U0000000a", "\\X0A", "\\U000A", "\\N",
            "<br>", "U+000A", "0x0a")


def push_hits(block, texts):
    """The scan's names that fire on each text, from its own patterns run by perl."""
    with tempfile.TemporaryDirectory(prefix="instinct-scan-diff-") as d:
        pl = os.path.join(d, "push.pl")
        with open(pl, "w", encoding="utf-8") as fh:
            fh.write(block + "\n$| = 1;\nwhile (my $l = <STDIN>) { chomp $l; my ($id, $v) = split /\\t/, $l, 2; my @h;\n"
                     "  for my $i (0..$#s) { push @h, $n[$i] if $v =~ $s[$i]; }\n  print \"$id\\t\" . join(',', @h) . \"\\n\"; }\n"
                     "END { print \"NAMES\\t\" . join(',', @n) . \"\\n\"; }\n")
        res = subprocess.run(["perl", pl], input="".join("%d\t%s\n" % (i, t) for i, t in enumerate(texts)).encode("utf-8"),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert res.returncode == 0, res.stderr[:300]
    hits, names = {}, []
    for line in res.stdout.decode("utf-8").splitlines():
        key, _, val = line.partition("\t")
        if key == "NAMES":
            names = val.split(",")
        else:
            hits[int(key)] = set(x for x in val.split(",") if x)
    assert len(hits) == len(texts), (len(hits), len(texts))
    return hits, names


def main():
    src = open(os.path.join(HERE, "..", ".githooks", "pre-push"), encoding="utf-8").read()
    block = src[src.index("@n = qw("):src.index('($f, $h) = ("?", 0);')]
    rows = [(name, ctx + v, ctx) for name, vals in VALUES.items() for v in vals for ctx in CONTEXTS]
    hits, names = push_hits(block, [r[1] for r in rows])
    both, sweep_only, push_only, neither, own = 0, 0, collections.Counter(), collections.Counter(), set()
    for i, (name, text, ctx) in enumerate(rows):
        p, s = bool(hits[i]), isw.secret_shaped(text)
        if ctx == "" and name in hits[i]:
            own.add(name)
        if p and s:
            both += 1
        elif p:
            push_only[name] += 1
        elif s:
            sweep_only += 1
        else:
            neither[name] += 1
    unplanted = sorted(set(names) - set(VALUES))
    stale = sorted(set(VALUES) - set(names))
    no_control = sorted(set(VALUES) - own)
    print("rows %d, names %d, contexts %d: both %d, push-only %d, sweep-only %d, neither %d" % (
        len(rows), len(names), len(CONTEXTS), both, sum(push_only.values()), sweep_only, sum(neither.values())))
    for label, items in (("no planted value", unplanted), ("planted for no name", stale),
                         ("own pattern missed its value", no_control), ("push-only", sorted(push_only)),
                         ("neither", sorted(neither))):
        if items:
            print("FAIL %s: %s" % (label, ", ".join(items)))
    return 1 if unplanted or stale or no_control or push_only or neither else 0


if __name__ == "__main__":
    sys.exit(main())
