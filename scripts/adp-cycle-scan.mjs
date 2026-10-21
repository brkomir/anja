// Throwaway ADP import-cycle detector for the source project. Tarjan SCC over the src/ import graph.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// --- collect all .ts/.tsx files under src/ ---
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) acc.push(p);
  }
  return acc;
}
const files = walk(SRC);
const fileSet = new Set(files);

// --- resolve an import specifier to an on-disk file, or null ---
function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // external / node_module
  const cands = [
    base + ".ts", base + ".tsx",
    join(base, "index.ts"), join(base, "index.tsx"),
    base, // already has extension
  ];
  for (const c of cands) if (fileSet.has(c)) return c;
  return null;
}

// --- build edges (exclude pure `import type` / `export type` — type-only deps don't cause runtime cycles) ---
// Two graphs: `graph` is the full runtime graph (static + dynamic edges, current
// behavior); `staticGraph` keeps ONLY eager static imports. A cycle that survives
// in staticGraph is init-order-dangerous (a module can observe a peer mid-init);
// a cycle that exists ONLY in the full graph is lazy-broken — at least one back-
// edge is `await import()`, resolved at call-time, so it cannot cause an
// init-order hazard. The lazy break is the established idiom here (138 dynamic
// imports codebase-wide). Splitting the two is what makes "clean" provable.
const graph = new Map();       // file -> Set<file>  (full: static + dynamic)
const staticGraph = new Map(); // file -> Set<file>  (eager static only)
for (const f of files) { graph.set(f, new Set()); staticGraph.set(f, new Set()); }
const importRe = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
const dynRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  let m;
  while ((m = importRe.exec(src))) {
    const isTypeKeyword = !!m[2];                 // `import type {...}`
    const spec = m[4];
    // skip if entire import is type-only (keyword form)
    if (isTypeKeyword) continue;
    const tgt = resolveSpec(f, spec);
    if (tgt && tgt !== f) { graph.get(f).add(tgt); staticGraph.get(f).add(tgt); }
  }
  while ((m = dynRe.exec(src))) {
    const tgt = resolveSpec(f, m[1]);
    if (tgt && tgt !== f) graph.get(f).add(tgt); // dynamic → full graph only
  }
}

let edgeCount = 0;
for (const s of graph.values()) edgeCount += s.size;

// --- Tarjan SCC (parameterized by graph) ---
function tarjan(g) {
  let idx = 0;
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  const sccs = [];
  function strongconnect(v) {
    index.set(v, idx); low.set(v, idx); idx++;
    stack.push(v); onStack.add(v);
    for (const w of g.get(v)) {
      if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  }
  for (const f of files) if (!index.has(f)) strongconnect(f);
  return sccs;
}

// self-loops (a file importing itself) — none expected, but capture
const selfLoops = files.filter((f) => graph.get(f).has(f));

const cycles = tarjan(graph).filter((c) => c.length > 1);
const staticCycles = tarjan(staticGraph).filter((c) => c.length > 1);
// A full-graph cycle is static-eager (dangerous) if some static cycle's node
// set is fully contained within it (static edges ⊆ full edges, so each static
// cycle lives inside exactly one full SCC).
const staticCycleNodeSets = staticCycles.map((c) => new Set(c));
const isStaticEager = (c) => {
  const cset = new Set(c);
  return staticCycleNodeSets.some((s) => [...s].every((n) => cset.has(n)));
};
const rel = (f) => relative(SRC, f);

console.log(`Files scanned: ${files.length}   Edges (value imports, type-only excluded): ${edgeCount}`);
console.log(`Cycles (full graph, static + dynamic edges): ${cycles.length}`);
console.log(`  └─ STATIC-EAGER (init-order-dangerous): ${staticCycles.length}`);
console.log(`  └─ lazy-broken (safe — ≥1 back-edge is await import()): ${cycles.length - staticCycles.length}`);
console.log(`Self-loops: ${selfLoops.length}`);

if (cycles.length === 0 && selfLoops.length === 0) {
  console.log("\n✅ NO import cycles anywhere in src/.");
} else if (staticCycles.length === 0) {
  console.log("\n✅ NO static-eager cycles — every cycle is lazy-broken (await import). No init-order risk.");
}
if (cycles.length > 0 || selfLoops.length > 0) {
  for (const c of cycles) {
    const touchesScope = c.some((f) => rel(f).startsWith("services/") || rel(f).startsWith("lib/"));
    const label = isStaticEager(c) ? "⚠️  STATIC-EAGER" : "✓ lazy-broken";
    console.log(`\n--- cycle (${c.length} files) [${label}]${touchesScope ? " [TOUCHES services/lib]" : ""} ---`);
    for (const f of c) console.log("   " + rel(f));
    // print the actual back-edges within the SCC, tagged static vs dynamic
    const cset = new Set(c);
    for (const f of c) for (const t of graph.get(f)) if (cset.has(t)) {
      const kind = staticGraph.get(f).has(t) ? "static" : "dynamic";
      console.log(`     edge: ${rel(f)} -> ${rel(t)}  [${kind}]`);
    }
  }
  for (const f of selfLoops) console.log(`\nself-loop: ${rel(f)}`);
}
