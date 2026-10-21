#!/usr/bin/env bash
# Reproduce grep-blowup-warn.sh's shape arm against a fixture read from a FILE
# (an inline fixture is blocked by the guard it models — session-cadence.md).
H="<repo-root>/.claude/hooks/grep-blowup-warn.sh"
D="$(dirname "$0")"

# Same instrument, not a retyped one: take the atoms from the hook itself.
eval "$(grep -E '^_GBW_ATOM=|^_GBW_GAP=' "$H")"
echo "ATOM = $_GBW_ATOM"
echo "GAP  = $_GBW_GAP"
echo

SEG=$(cat "$D/grep-blowup-fixture.txt")
echo "SEGMENT:"; echo "  $SEG"; echo

# --- the hook's segment gate: is this segment even tested? ---
if printf '%s' "$SEG" | grep -qE '(^|[|;( ])(grep|egrep|ugrep|rg)([[:space:]]|$)'; then
  echo "segment gate: TESTED (it is a grep-family invocation)"
else
  echo "segment gate: skipped"; exit 0
fi

# --- the hook's strip: command substitution + backticks ONLY ---
SCAN="$SEG"
for p in 1 2; do
  SCAN=$(printf '%s' "$SCAN" | sed -E 's/\$\([^()]*\)//g; s/`[^`]*`//g')
done
echo
echo "AFTER HOOK STRIP:"; echo "  $SCAN"
[ "$SCAN" = "$SEG" ] && echo "  (unchanged — nothing was stripped)"
echo

fire=0
if printf '%s' "$SCAN" | grep -qE "${_GBW_ATOM}\{[0-9]*,[0-9]+\}${_GBW_GAP}"; then
  echo "PATTERN A  {m,n} + gap : MATCH"; fire=1
else
  echo "PATTERN A  {m,n} + gap : no match"
fi
if printf '%s' "$SCAN" | grep -qE "${_GBW_ATOM}[*+]${_GBW_GAP}"; then
  echo "PATTERN B  atom [*+] + gap : MATCH"; fire=1
else
  echo "PATTERN B  atom [*+] + gap : no match"
fi
echo "=> hook verdict on this segment: $([ $fire = 1 ] && echo FIRES || echo clean)"

# --- CONTROL: strip process substitution too, then re-test ---
echo
echo "CONTROL — strip <( ) / >( ) as well as \$( ):"
CTL="$SEG"
for p in 1 2; do
  CTL=$(printf '%s' "$CTL" | sed -E 's/(\$|[<>])\([^()]*\)//g; s/`[^`]*`//g')
done
echo "  $CTL"
c=0
printf '%s' "$CTL" | grep -qE "${_GBW_ATOM}\{[0-9]*,[0-9]+\}${_GBW_GAP}" && c=1
printf '%s' "$CTL" | grep -qE "${_GBW_ATOM}[*+]${_GBW_GAP}" && c=1
echo "=> control verdict: $([ $c = 1 ] && echo "STILL FIRES (the parens are NOT from the substitution)" || echo "CLEAN (the parens came from <( ) — false positive)")"

# --- POSITIVE CONTROL: a genuine backtracking shape must still fire ---
echo
echo "POSITIVE CONTROL (must FIRE, or this probe proves nothing):"
POS=$(cat "$D/grep-blowup-fixture-positive.txt")
echo "  $POS"
p=0
printf '%s' "$POS" | grep -qE "${_GBW_ATOM}\{[0-9]*,[0-9]+\}${_GBW_GAP}" && p=1
printf '%s' "$POS" | grep -qE "${_GBW_ATOM}[*+]${_GBW_GAP}" && p=1
echo "=> positive control: $([ $p = 1 ] && echo "FIRES (instrument is live)" || echo "DID NOT FIRE — probe is broken, discard every reading above")"

# --- THE HOOK ITSELF. Everything above is a MODEL of the hook: it takes the two pattern
# literals from the source but supplies its OWN segmentation, and since 2026-08-18 the hook
# splits on unquoted `|` / `;` / `&&` and evaluates PER SEGMENT. So the model now
# reports FIRES on a fixture the running hook clears, and a reader following this row's
# "re-run rather than trust the figures" instruction would conclude the bug is unfixed.
# The running hook is the oracle; the pattern detail above is kept because it localises WHY.
echo
echo "=== THE LIVE HOOK (authoritative — the block above is a model of it) ==="
for f in "$D/grep-blowup-fixture.txt" "$D/grep-blowup-fixture-positive.txt"; do
  [ -f "$f" ] || continue
  c=$(cat "$f")
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' \
    "$(printf '%s' "$c" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    | GREP_BLOWUP_NO_LOG=1 bash "$H" >/dev/null 2>&1
  case $? in
    2) v="DENIES" ;;
    *) v="clean" ;;
  esac
  echo "  $(basename "$f"): $v"
done
echo "  (expected: fixture = clean, fixture-positive = DENIES)"
