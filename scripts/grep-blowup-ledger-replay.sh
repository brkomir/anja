#!/usr/bin/env bash
# My 12 cases were authored by me in one sitting from one intuition — that is ONE
# observation, not two. The real corpus is the ledger: 559 actual denials.
# Replay COMBO over every recorded deny and count how many it would now let through.
H="<repo-root>/.claude/hooks/grep-blowup-warn.sh"
L="<repo-root>/.claude/logs/grep-blowup-fires.jsonl"
eval "$(grep -E '^_GBW_ATOM=|^_GBW_GAP=' "$H")"

python3 - "$L" > /tmp/gbw-denies.txt <<'PY'
import json,sys
n=0
for line in open(sys.argv[1],encoding='utf-8',errors='replace'):
    try: r=json.loads(line)
    except Exception: continue
    if r.get('decision')!='deny': continue
    c=(r.get('cmd') or '').replace('\n',' ')
    if not c: continue
    print(c); n+=1
print(f"__COUNT__ {n}", file=sys.stderr)
PY
echo "deny records replayed: $(wc -l < /tmp/gbw-denies.txt)"

fires() {
  printf '%s' "$1" | grep -qE "${_GBW_ATOM}\{[0-9]*,[0-9]+\}${_GBW_GAP}" && return 0
  printf '%s' "$1" | grep -qE "${_GBW_ATOM}[*+]${_GBW_GAP}" && return 0
  return 1
}
strip_head() { local s="$1"; for _ in 1 2; do s=$(printf '%s' "$s" | sed -E 's/\$\([^()]*\)//g; s/`[^`]*`//g'); done; printf '%s' "$s"; }
quoted_only(){ printf '%s' "$1" | grep -oE "'[^']*'|\"[^\"]*\"" | tr '\n' ' '; }

still=0; flipped=0; i=0
: > /tmp/gbw-flipped.txt
while IFS= read -r cmd; do
  i=$((i+1))
  if fires "$(quoted_only "$(strip_head "$cmd")")"; then still=$((still+1))
  else flipped=$((flipped+1)); printf '%s\n' "$cmd" >> /tmp/gbw-flipped.txt; fi
done < /tmp/gbw-denies.txt

echo
echo "replayed under COMBO (strip shell substitutions, then test only quoted spans):"
echo "  still DENIED : $still"
echo "  now ALLOWED  : $flipped   <- these are the denials COMBO reverses"
echo
echo "a sample of what COMBO would now allow (read the HITS, never the count):"
head -c 1200 /tmp/gbw-flipped.txt
