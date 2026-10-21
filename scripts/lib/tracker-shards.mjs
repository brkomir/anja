/**
 * tracker-shards.mjs — resolve a project-memory tracker to the FILES that hold its rows.
 *
 * WHY THIS EXISTS. A project-memory tracker is being split into a router plus
 * `<stem>-SHARD-NN-*.md` shards by `scripts/rules-tier-split.mjs --target flows`,
 * for the same reason the meta rules file was: at 368,860 B it is 106,716 B past the Read tool's
 * 262,144 B hard-error ceiling, so an unbounded Read returns nothing at all.
 *
 * ⛔ THE POINT OF SHIPPING THIS BEFORE THE SPLIT IS THAT IT IS A NO-OP UNTIL THE SPLIT LANDS.
 * With no shards on disk it returns exactly `[path]`, so every consumer keeps its current
 * behaviour byte-for-byte and there is no window in which a tool reads a partial tracker. The
 * alternative — split first, fix consumers after — opens exactly that window on three tools that
 * feed `/orient`, `/wrap` and the audit-drift sentinel.
 *
 * ⚠️ ROWS, NOT SECTIONS. Every consumer of this helper is LINE-oriented: it scans for `| N |`
 * rows and never needs a table to span a file boundary. The splitter guarantees that shape —
 * each shard carries whole `### ` tier sections, each with its own table header and separator —
 * so concatenating in name order is equivalent to reading the pre-split file for any row-level
 * predicate. It is NOT equivalent for anything positional (a line NUMBER, a byte offset, "the
 * section above this row"), and no current consumer asks for that. Check before adding one.
 */

import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * @param {string} absPath absolute path to the tracker (the router, after a split)
 * @returns {string[]} the router first, then its shards in name order
 */
export function trackerFiles(absPath) {
  const dir = dirname(absPath);
  const stem = basename(absPath).replace(/\.md$/, "");
  let shards = [];
  try {
    shards = readdirSync(dir)
      .filter((n) => n.startsWith(`${stem}-SHARD-`) && n.endsWith(".md"))
      // Name order IS document order: the splitter zero-pads the index (`-SHARD-01-`), which is
      // load-bearing — an unpadded `-SHARD-10-` sorts before `-SHARD-2-` and the concatenation
      // would silently reorder the tiers.
      .sort();
  } catch {
    // No directory, or unreadable: fall back to the single file rather than throwing. A consumer
    // that cannot read the tracker at all already reports that itself, with a better message.
  }
  return [absPath, ...shards.map((n) => join(dir, n))];
}
