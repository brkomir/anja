// migration-record.mjs — does a commit subject record a migration as applied to BOTH databases?
//
// One predicate, two consumers: scripts/migration-notation-reconcile.mjs (which skips probing a
// migration it finds recorded) and scripts/promote-migration-gate.mjs (which blocks a promotion
// into main while a migration it brings has no record). Dependency-free on purpose, so the gate
// does not load the 2,400-line reconcile to ask a one-line question.

// "both DBs applied" — accept the canonical phrase AND the "…now in sync" form.
// Deliberately does NOT match "staging applied (prod pending)" / "created" —
// those are NOT-both states the reconcile SHOULD probe.
export const BOTH_APPLIED = /(staging\s*\+\s*prod|staging and prod|staging & prod)[\s\S]{0,30}(applied|in sync|synced)/i;

// A status word between the number and the phrase means the subject records this number as NOT
// applied to both ("0308 created; 0301 staging+prod applied").
export const NOT_BOTH = /\bcreated\b|\bnot yet applied\b|\bpending\b|\bunapplied\b/i;

// Inside the phrase itself: the window between "staging+prod" and "applied" can hold a failure or
// a rollback ("staging+prod — prod apply failed, staging applied", "staging+prod rollback applied").
const PHRASE_NEGATED = /\bnot\b|\bfail\w*|\brevert\w*|\broll\w*/i;

// Between the number and the phrase: any word that belongs to ANOTHER status clause means the
// number's own status is that clause, not the phrase ("0308 staging applied; 0301 staging+prod
// applied", "0308 staging only; 0301 …", and the real subject "0203 staging applied —
// staging+prod now in sync"). A numbered list ("0305 0306 0307 staging+prod applied") carries none.
const OTHER_STATUS = /\b(?:not|applied|staging|prod|only|fail\w*|revert\w*|rolled)\b/i;

// Does this one subject record `num` (a 4-digit string such as "0308") as applied to both?
// The number must appear as a standalone token BEFORE the phrase, with no status word between.
// The looser form (number anywhere, phrase anywhere) accepts "0166 staging+prod applied, rename
// from 0164" as a record for 0164, and it does in this repo's history. Only the FIRST phrase is
// read, so in "0301 staging+prod applied; 0302 staging+prod applied" 0302 reads false (the safe
// direction: the reconcile probes it and the gate asks for a record).
export function recordsBothApplied(num, subject) {
  const phrase = BOTH_APPLIED.exec(subject);
  // "staging+prod NOT applied", "staging+prod unapplied", "staging+prod rollback applied"
  if (!phrase || PHRASE_NEGATED.test(phrase[0]) || NOT_BOTH.test(phrase[0])) return false;
  // Alphanumeric-boundary lookarounds, NOT \b: the number is often followed by `_`
  // ("0201_example_table… staging+prod applied"), and `_` is a \w char; and a letter on either
  // side means the digits sit inside a commit hash (a0308bc12), not a migration number.
  for (const m of subject.matchAll(new RegExp(`(?<![0-9A-Za-z])0*${num}(?![0-9A-Za-z])`, "g"))) {
    if (m.index >= phrase.index) continue;
    const between = subject.slice(m.index + m[0].length, phrase.index);
    if (!NOT_BOTH.test(between) && !OTHER_STATUS.test(between)) return true;
  }
  return false;
}
