// The deep-pass corpus strip, Node form — moved verbatim out of scripts/wrap-reconcile.mjs so that
// a parity test can import it. wrap-reconcile's runtime gate and its
// self-test still consume THIS function (the replica warning at its STAGE-1 CORPUS block: two copies
// existed and breaking the runtime one left the suite ALL PASS; it was computed inline there before).
//
// Four forms of this one rule exist: this file, transcript_bytes in scripts/wrap-preflight.py, and the
// python one-liner in deep-pass/SKILL.md and wrap/SKILL.md. Each self-test pins only its own copy, so
// a parity test runs all four on one fixture and compares them line by line.
// Change the rule in all four, then run that test.
//
// ⛔ THE HARNESS WRITES AN IMAGE PAYLOAD UNDER TWO KEYS — `source.data` and `toolUseResult.file.base64`
// — and a pattern naming only `data` kept 397,933,828 B across 250 transcripts, one post-blank line at
// 3,102,592 B (1.55x a whole 2 MB agent slice). A DELETE filter was key-agnostic by accident because it
// dropped the record; converting delete to BLANK turned that into a predicate that must enumerate the
// keys. The enumeration over the store is closed: `base64` is the only surviving key, the
// 200-char floor excludes no real payload (smallest 1,208 chars), key order is irrelevant.
const BASE64_PAYLOAD_RE = /"(data|base64)":"[^"]{200,}"/g;
export function blankBase64Payloads(line) {
  return line.includes('"type":"base64"') ? line.replace(BASE64_PAYLOAD_RE, '"$1":"<stripped>"') : line;
}
// The harness's request copies (`api-request`, `api-request-blob`, `api-request-shape`, written since
// harness 2.1.300, first seen 2026-10-14) are 52-65% of a transcript's bytes from their first appearance, so the strip BLANKS each to
// a one-line stub, keeping the line number. Every such record
// starts `{"type":"api-request`, so the test is a PREFIX: a record that only nests such an object is kept.
// The spec's python one-liner (deep-pass/SKILL.md, wrap/SKILL.md) writes the same stub.
const API_REQUEST_RE = /^\{"type":"(api-request[a-z-]*)"/;
export function stripTranscriptLine(line) {
  const m = API_REQUEST_RE.exec(line);
  return m ? `{"type":"${m[1]}","stripped":"request copy"}` : blankBase64Payloads(line);
}
export function strippedTranscriptBytes(lineArr) {
  return Buffer.byteLength(lineArr.map(stripTranscriptLine).join("\n"), "utf8");
}
