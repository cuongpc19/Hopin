// Add BURIED "?" cars to slam levels. A buried car hides its colour (dark "?" cover) until it
// reaches the FRONT of its queue column — the player can't look ahead and must MEMORISE the flow.
//
// PLACEMENT (user 2026-07-29): keep the first VISIBLE_ROWS rows visible (learn the level), then
// bury DENSELY from there on — so confusion starts EARLY (after 1-2 rows), not deep in the game.
// Density ramps: L101-115 ~0.5 of the later cars; L116-130 ramp 0.5→0.85 for a 50%→10% feel.
import fs from "fs";
const OUT = "src/levels/designed.json";
const DEFAULT_LANES = 4;
const VISIBLE_ROWS = 2; // first 2 rows of the queue stay face-up (easy start)
const d = JSON.parse(fs.readFileSync(OUT, "utf8"));

function density(n) {
  if (n <= 115) return 0.5;                 // L101-115: half the later cars are "?"
  const t = (n - 116) / (130 - 116);        // 0..1 across L116-130
  return 0.5 + t * 0.35;                     // 50% → 85%
}

function addBuried(L, dens, seed) {
  for (const c of L.chests) delete c.buried;
  const lanes = L.lanes || DEFAULT_LANES;
  const start = VISIBLE_ROWS * lanes;        // first cars (rows 0..VISIBLE_ROWS-1) stay visible
  const n = L.chests.length;
  const cand = [];
  for (let i = start; i < n; i++) if (L.chests[i].pairId == null) cand.push(i);
  const want = Math.round(dens * cand.length);
  // shuffle deterministically so buried cars are spread through the later rows (not all clustered)
  let s = seed >>> 0 || 1;
  for (let i = cand.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  let made = 0;
  for (const i of cand) { if (made >= want) break; L.chests[i].buried = true; made++; }
  return { made, n, lanes };
}

let total = 0;
for (let n = 101; n <= 130; n++) {
  const L = d[n]; if (!L || !L.slam) continue;
  const { made, n: nc, lanes } = addBuried(L, density(n), n * 131 + 7);
  total += made;
  if ([101, 108, 115, 116, 121, 126, 130].includes(n))
    console.log(`L${n}: ${made}/${nc} buried (${Math.round(density(n) * 100)}% of cars past row ${VISIBLE_ROWS}, lanes ${lanes})`);
}
const sorted = {}; for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) sorted[k] = d[k];
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
console.log(`\n✔ ${total} buried "?" cars — visible first ${VISIBLE_ROWS} rows, then dense`);
