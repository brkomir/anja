#!/usr/bin/env bash
# Compare two candidate fixes for the shape-arm process-substitution FP.
# Fixtures live in a FILE — an inline one is denied by the guard under test.
#
#   HEAD    = the hook as shipped today (strips $( ) and backticks)
#   POSN    = HEAD + strip <( ) / >( ) when in command-argument position
#   QUOTED  = invert it: run the shape test ONLY on quoted spans
#
# Expected column says what the row SHOULD be. A design is correct only if it
# matches expected on every row.
H="<repo-root>/.claude/hooks/grep-blowup-warn.sh"
D="$(dirname "$0")"
eval "$(grep -E '^_GBW_ATOM=|^_GBW_GAP=' "$H")"

fires() {  # $1 = scan text -> 0 if the shape arm would fire
  printf '%s' "$1" | grep -qE "${_GBW_ATOM}\{[0-9]*,[0-9]+\}${_GBW_GAP}" && return 0
  printf '%s' "$1" | grep -qE "${_GBW_ATOM}[*+]${_GBW_GAP}" && return 0
  return 1
}

strip_head() {  # what the hook does today
  local s="$1"
  for _ in 1 2; do s=$(printf '%s' "$s" | sed -E 's/\$\([^()]*\)//g; s/`[^`]*`//g'); done
  printf '%s' "$s"
}

strip_posn() {  # HEAD + process substitution in command-argument position
  local s; s=$(strip_head "$1")
  for _ in 1 2; do s=$(printf '%s' "$s" | sed -E 's/(^|[[:space:]|;&])[<>]\([^()]*\)/\1/g'); done
  printf '%s' "$s"
}

quoted_only() {  # keep ONLY single/double-quoted spans; a regex is always quoted
  printf '%s' "$1" | grep -oE "'[^']*'|\"[^\"]*\"" | tr '\n' ' '
}

combo() { quoted_only "$(strip_head "$1")"; }   # strip shell substitutions FIRST, then test only quoted spans

printf '%-4s %-7s %-7s %-7s %-7s  %s\n' "EXP" "HEAD" "POSN" "QUOTED" "COMBO" "case"
printf '%-4s %-7s %-7s %-7s %-7s  %s\n' "---" "----" "----" "------" "-----" "----"

fail_head=0; fail_posn=0; fail_quoted=0; fail_combo=0
while IFS='|' read -r exp label cmd; do
  [ -z "$exp" ] && continue
  fires "$(strip_head   "$cmd")" && h=FIRE || h=clean
  fires "$(strip_posn   "$cmd")" && p=FIRE || p=clean
  fires "$(quoted_only  "$cmd")" && q=FIRE || q=clean
  fires "$(combo        "$cmd")" && c=FIRE || c=clean
  want=$([ "$exp" = TP ] && echo FIRE || echo clean)
  [ "$h" = "$want" ] || { h="$h!"; fail_head=$((fail_head+1)); }
  [ "$p" = "$want" ] || { p="$p!"; fail_posn=$((fail_posn+1)); }
  [ "$q" = "$want" ] || { q="$q!"; fail_quoted=$((fail_quoted+1)); }
  [ "$c" = "$want" ] || { c="$c!"; fail_combo=$((fail_combo+1)); }
  printf '%-4s %-7s %-7s %-7s %-7s  %s\n' "$exp" "$h" "$p" "$q" "$c" "$label"
done < "$D/grep-blowup-cases.txt"

echo
echo "wrong answers:  HEAD=$fail_head  POSN=$fail_posn  QUOTED=$fail_quoted  COMBO=$fail_combo   (! marks a wrong cell)"
