#!/usr/bin/env bash
# focus-visible-staged-check.sh — reads a unified diff on stdin; emits "  [violation]"
# + the offending tag span for every ADDED interactive <button|<a|<Link|<I18nLink that carries
# hover: WITHOUT focus-visible:/focus-within: (aria-disabled spans + non-interactive
# tags excluded; => arrow fns neutralized so onClick doesn't false-close the tag).
# Since 2026-09-25: only an `aria-disabled=` ATTRIBUTE exempts (not the Tailwind
# `aria-disabled:` variant), comment lines carry no attributes and cannot close a tag, and a
# shared ring constant whose name holds FOCUS...RING (`${FOCUS_RING}`) counts as a ring. Since a
# later review, comment text (incl. a multi-line /* */ continuation) is stripped by strip_code.
# KNOWN LIMITS, accepted at review (0 instances in the tree then):
# a ` //` with whitespace before it inside a STRING is stripped as a comment; a line that
# STARTS with Tailwind's `*:` child variant reads as a comment; a bare boolean `aria-disabled`
# or an object-spread `"aria-disabled":` no longer exempts a tag (a loud false positive).
# TESTING THIS GATE: it reads only tags whose OPENING line is ADDED, so a -U0 diff of an edit
# to an existing tag is a vacuous control; use a whole-file diff. A scan that feeds the whole
# tree as added covers the block arm only: the --warn attr-edit rule needs unchanged context,
# so replay real per-commit diffs to measure it.
# Empty output = clean. Per .claude/rules/components.md + the sr-only carveout.
#
# Extracted BYTE-IDENTICALLY from the inline awk in .githooks/pre-push so the HARD
# gate is testable. pre-push pipes
# `git diff -U0 ... -- 'src/app/**' 'src/components/**'` into it. The smoke suite
# (scripts/smoke-test-hooks.sh) runs `--self-test`; the gate itself runs via pre-push.
# Gate logic UNCHANGED from the inline version — only its location moved.
#
# Usage:  git diff -U0 <range> -- <paths> | bash scripts/focus-visible-staged-check.sh
#         git diff -U8 <range> -- <paths> | bash scripts/focus-visible-staged-check.sh --warn
#         bash scripts/focus-visible-staged-check.sh --self-test
# --warn (WARN-mode per SC-3; pre-push prints, never blocks) reports two shapes the block
# arm cannot see: [outline-none] an ADDED `focus-visible:|focus-within:|focus:outline-none`
# (forced colors drops the ring and only `outline-hidden` keeps an outline — components.md), and
# [attr-edit] a hover-without-focus tag whose OPENING line is unchanged context but which holds
# an added line (an attribute-only edit).
set -u

if [ "${1:-}" = "--self-test" ]; then
  rc=0
  _ck() { # name | FIRE|SAFE | diff-text | [mode]
    local out; out=$(printf '%s\n' "$3" | bash "$0" ${4:+"$4"})
    if [ "$2" = "FIRE" ]; then
      if printf '%s' "$out" | grep -q '\[violation\]\|\[warn\]'; then echo "  PASS $1"; else echo "  FAIL $1 (expected violation, got none)"; rc=1; fi
    else
      if [ -z "$out" ]; then echo "  PASS $1"; else echo "  FAIL $1 (expected clean, got: $out)"; rc=1; fi
    fi
  }
  _ck "FIRE single-line hover/no-focus"          FIRE '@@ -0,0 +1 @@
+        <button className="rounded hover:bg-gray-100">Go</button>'
  _ck "FIRE multi-line Link hover/no-focus"      FIRE '@@ -0,0 +1,3 @@
+      <Link
+        className="text-sm hover:underline"
+      >'
  _ck "FIRE multi-line + onClick arrow, no focus" FIRE '@@ -0,0 +1,4 @@
+      <button
+        onClick={() => fn()}
+        className="hover:bg-gray-100"
+      >Go</button>'
  _ck "SAFE hover + focus-visible"               SAFE '@@ -0,0 +1 @@
+        <button className="hover:bg-gray-100 focus-visible:ring-2">Go</button>'
  _ck "SAFE focus-within counts as a ring"       SAFE '@@ -0,0 +1 @@
+      <a className="hover:bg-gray-50 focus-within:ring-2">link</a>'
  _ck "SAFE aria-disabled span"                  SAFE '@@ -0,0 +1 @@
+        <button aria-disabled="true" className="hover:bg-gray-100">Go</button>'
  _ck "SAFE non-interactive <article>"           SAFE '@@ -0,0 +1 @@
+        <article className="hover:shadow">card</article>'
  _ck "SAFE multi-line + onClick arrow + focus"  SAFE '@@ -0,0 +1,4 @@
+      <button
+        onClick={() => fn()}
+        className="hover:bg-gray-100 focus-visible:ring-2"
+      >Go</button>'
  _ck "FIRE I18nLink hover/no-focus"             FIRE '@@ -0,0 +1 @@
+          <I18nLink href="/suspended" className="underline hover:text-foreground">'
  _ck "FIRE --warn added outline-none"           FIRE '@@ -1 +1 @@
+        <a className="hover:underline focus-visible:outline-none focus-visible:ring-2">x</a>' --warn
  _ck "SAFE --warn added outline-hidden"         SAFE '@@ -1 +1 @@
+        <a className="hover:underline focus-visible:outline-hidden focus-visible:ring-2">x</a>' --warn
  _ck "FIRE --warn attribute-only edit"          FIRE '@@ -10,4 +10,4 @@
         <a
-          href="/old"
+          href="/new"
           className="underline hover:text-foreground"
         >' --warn
  _ck "FIRE --warn attribute-only edit, I18nLink" FIRE '@@ -10,4 +10,4 @@
         <I18nLink
-          href="/old"
+          href="/new"
           className="underline hover:text-foreground"
         >' --warn
  _ck "SAFE --warn legacy tag, no added line"    SAFE '@@ -10,3 +10,4 @@
         <a href="/x" className="underline hover:text-foreground">x</a>
+        <p>unrelated</p>' --warn
  _ck "SAFE --warn added opener (block arm owns)" SAFE '@@ -1 +1 @@
+        <a href="/x" className="underline hover:text-foreground">x</a>' --warn
  # 2026-09-25 review: the three misreads that blocked a correct button and
  # waved three others through by accident. Each arm reds when its predicate is reverted.
  _ck "FIRE Tailwind aria-disabled: variant does not exempt" FIRE '@@ -0,0 +1 @@
+        <button className="hover:bg-muted aria-disabled:opacity-60">Go</button>'
  _ck "FIRE aria-disabled in a {/* */} comment does not exempt" FIRE '@@ -0,0 +1,5 @@
+      <button
+        {/* aria-disabled="true" would drop focus to body, so it is not used */}
+        onClick={go}
+        className="hover:bg-muted"
+      >Go</button>'
  _ck "FIRE a > in a trailing // comment does not close the tag" FIRE '@@ -0,0 +1,4 @@
+      <button
+        onClick={go} // opening -> focus moves to the group
+        className="hover:bg-muted"
+      >Go</button>'
  _ck "FIRE a non-ring FOCUS_* constant is not a ring" FIRE '@@ -0,0 +1 @@
+        <button className={`hover:bg-muted ${FOCUS_JUDGE_MODEL}`}>Go</button>'
  _ck "SAFE shared ring constant \${FOCUS_RING}"    SAFE '@@ -0,0 +1 @@
+        <button className={`hover:bg-muted ${FOCUS_RING}`}>Go</button>'
  _ck "SAFE aria-disabled={expr} attribute exempts" SAFE '@@ -0,0 +1,4 @@
+      <button
+        aria-disabled={submitting || undefined}
+        className="hover:bg-muted"
+      >Go</button>'
  _ck "FIRE a > in a multi-line /* */ continuation does not close the tag" FIRE '@@ -0,0 +1,7 @@
+      <button
+        type="button"
+        /* opening moves focus to the group, which
+           keeps it off <body> when the save fails */
+        onClick={go}
+        className="hover:bg-muted"
+      >Go</button>'
  _ck "FIRE aria-disabled= in a /* */ continuation does not exempt" FIRE '@@ -0,0 +1,6 @@
+      <button
+        /* never native disabled; the in-flight state is
+           aria-disabled={pending} further down the tree */
+        onClick={go}
+        className="hover:bg-muted"
+      >Go</button>'
  _ck "FIRE a > on a * comment line does not close the tag" FIRE '@@ -0,0 +1,7 @@
+      <button
+        /*
+         * opening -> focus moves to the group
+         */
+        onClick={go}
+        className="hover:bg-muted"
+      >Go</button>'
  _ck "FIRE code after {/* */} on the same line still opens a tag" FIRE '@@ -0,0 +1 @@
+        {/* Mobile nav */} <Link href="/x" className="hover:underline">x</Link>'
  _ck "FIRE a FOCUS_*RING-lettered non-ring constant is not a ring" FIRE '@@ -0,0 +1 @@
+        <button className={`hover:bg-muted ${FOCUS_SCORING}`}>Go</button>'
  _ck "FIRE an unclosed /* does not carry into the next hunk" FIRE '@@ -0,0 +1 @@
+        /* opened here, closed on a line this -U0 diff does not show
@@ -40,0 +41 @@
+        <button className="hover:bg-muted">Go</button>'
  _ck "FIRE --warn attr-edit: aria-disabled: variant does not exempt" FIRE '@@ -10,4 +10,4 @@
         <a
-          href="/old"
+          href="/new"
           className="underline hover:text-foreground aria-disabled:opacity-60"
         >' --warn
  _ck "FIRE --warn attr-edit: a non-ring FOCUS_* constant is not a ring" FIRE '@@ -10,4 +10,4 @@
         <a
-          href="/old"
+          href="/new"
           className={`underline hover:text-foreground ${FOCUS_JUDGE_MODEL}`}
         >' --warn
  _ck "SAFE --warn attr-edit on a \${FOCUS_RING} tag"   SAFE '@@ -10,4 +10,4 @@
         <a
-          href="/old"
+          href="/new"
           className={`underline hover:text-foreground ${FOCUS_RING}`}
         >' --warn
  _ck "SAFE --warn outline-none named in a comment"  SAFE '@@ -1 +1 @@
+   * never focus-visible:outline-none here: forced colors drops the ring' --warn
  if [ "$rc" -eq 0 ]; then echo "focus-visible-staged-check --self-test: all pass (19 FIRE + 12 SAFE)"; else echo "focus-visible-staged-check --self-test: FAILURES"; fi
  exit "$rc"
fi

# Comment text is dropped before any rule reads a line. An unclosed /* is carried across lines
# (reset per hunk), so the house-style multi-line /* ... */ inside a JSX opening tag, whose
# continuation lines carry no leading *, can neither close the tag at a ">" nor exempt it. A line
# led by * outside a known block is a hunk that began inside a comment: all comment.
STRIP_CODE_AWK='
      function strip_code(s,   out, i, j) {
        if (!in_block && s ~ /^[[:space:]]*\*/) return ""
        out = ""
        for (;;) {
          if (in_block) { i = index(s, "*/"); if (!i) return out; s = substr(s, i + 2); in_block = 0 }
          i = index(s, "/*"); j = match(s, /(^|[[:space:]])\/\//)
          if (j && (!i || j < i)) return out substr(s, 1, j - 1)
          if (!i) return out s
          out = out substr(s, 1, i - 1); s = substr(s, i + 2); in_block = 1
        }
      }
'

if [ "${1:-}" = "--warn" ]; then
  awk "$STRIP_CODE_AWK"'
      /^(\+\+\+|---) / { next }
      /^@@/ { in_tag=0; in_block=0; buf=""; next }
      /^[+ ]/ {
        added = (substr($0, 1, 1) == "+"); line = substr($0, 2)
        # Same comment / ring-constant / attribute-only rules as the block arm below.
        code = strip_code(line); is_comment = (code ~ /^[[:space:]{}]*$/)
        nl = code; gsub(/=>/, "", nl)
        if (!is_comment && added && code ~ /(focus-visible|focus-within|focus):outline-none/) { print "  [warn] [outline-none]"; print line }
        if (!is_comment && code ~ /<(button|a|Link|I18nLink)([^a-zA-Z]|$)/) { in_tag=1; opened_added=added; any_added=0; has_hover=0; has_focus=0; has_disabled=0; buf="" }
        if (in_tag) {
          buf = (buf == "" ? line : buf "\n" line)
          if (added) any_added=1
          if (!is_comment) {
            if (code ~ /hover:/) has_hover=1
            if (code ~ /focus-visible:|focus-within:/ || code ~ /(^|[^A-Za-z0-9_])([A-Z0-9]+_)*FOCUS_([A-Z0-9]+_)*RING(_[A-Z0-9]+)*([^A-Za-z0-9_]|$)/) has_focus=1
            if (code ~ /(^|[[:space:]])aria-disabled[[:space:]]*=/) has_disabled=1
            if (nl ~ />/) {
              if (has_hover && !has_focus && !has_disabled && any_added && !opened_added) { print "  [warn] [attr-edit]"; print buf }
              in_tag=0; buf=""
            }
          }
        }
      }
    '
  exit 0
fi

awk "$STRIP_CODE_AWK"'
      /^\+\+\+/ { next }
      /^@@/ { in_tag=0; in_block=0; has_hover=0; has_focus=0; has_disabled=0; buf=""; next }
      /^\+/ {
        line = substr($0, 2)
        # A comment line inside a tag carries no attributes: it can neither exempt the tag, supply
        # a ring, nor close it. Until 2026-09-25 a `//` line mentioning aria-disabled exempted its
        # button, and a `->` inside one closed the tag before its className was read.
        code = strip_code(line); is_comment = (code ~ /^[[:space:]{}]*$/)
        nl = code; gsub(/=>/, "", nl)
        if (!is_comment && code ~ /<(button|a|Link|I18nLink)([^a-zA-Z]|$)/) { in_tag=1; has_hover=0; has_focus=0; has_disabled=0; buf="" }
        if (in_tag) {
          buf = (buf == "" ? line : buf "\n" line)
          if (!is_comment) {
            if (code ~ /hover:/) has_hover=1
            # A shared ring constant counts as a ring. Keyed on FOCUS...RING, not on any FOCUS
            # name: src/ holds ~30 FOCUS_* constants that are not rings (FOCUS_JUDGE_MODEL ...).
            if (code ~ /focus-visible:|focus-within:/ || code ~ /(^|[^A-Za-z0-9_])([A-Z0-9]+_)*FOCUS_([A-Z0-9]+_)*RING(_[A-Z0-9]+)*([^A-Za-z0-9_]|$)/) has_focus=1
            # The ATTRIBUTE only. A bare substring also matched the Tailwind `aria-disabled:` variant.
            if (code ~ /(^|[[:space:]])aria-disabled[[:space:]]*=/) has_disabled=1
            if (nl ~ />/) {
              if (has_hover && !has_focus && !has_disabled) { print "  [violation]"; print buf }
              in_tag=0; has_hover=0; has_focus=0; has_disabled=0; buf=""
            }
          }
        }
      }
    '
