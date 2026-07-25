// Post-process designed.json: reorder each level's cars OUTSIDE-IN so a launched
// front car can always collect (no more "car drives the rail, eats nothing"), and
// re-place twin/linked cars so their colours surface together (no more "car 1 at the
// front, car 2 buried 3 rows back"). Pairs whose two colours surface far apart are
// UNLINKED (become solo cars). Only touches the `chests` array — counts/board/track
// are untouched, so every level's slime-count == car-capacity stays intact.
//
//   node scripts/fix-queue-order.mjs            → fix L1..120 (default)
//   node scripts/fix-queue-order.mjs 1 120      → fix an explicit range
//
// Re-runnable & idempotent-ish (sorting a sorted queue is stable). Reuses the exact
// peel/reachability logic from build-levels.mjs.
import fs from "fs";

const OUT = "src/levels/designed.json";
const LO = parseInt(process.argv[2] ?? "1", 10);
const HI = parseInt(process.argv[3] ?? "120", 10);
const PER_ROW = 4;   // inventory columns (matches the game)
const HARD = 90;     // board codes >= this are obstacles, not collectable colours
const KEEP_SPREAD = 1; // keep a pair only if its colours are <=1 peel-rank apart

// ---- peel / reachability (verbatim logic from build-levels.mjs) -------------
function trackEdges(t) {
  if (t === "line") return { L: 0, R: 0, T: 0, B: 1 };
  if (t === "u") return { L: 1, R: 1, T: 0, B: 1 };
  if (t === "arch") return { L: 1, R: 1, T: 1, B: 0 };
  return { L: 1, R: 1, T: 1, B: 1 }; // square / rect
}
function raysFor(e) {
  const dirs = [];
  const add = (dr, dc) => { if (!dirs.some((d) => d[0] === dr && d[1] === dc)) dirs.push([dr, dc]); };
  if (e.B) { add(-1, 0); add(-1, -1); add(-1, 1); }
  if (e.T) { add(1, 0); add(1, -1); add(1, 1); }
  if (e.L) { add(0, 1); add(-1, 1); add(1, 1); }
  if (e.R) { add(0, -1); add(-1, -1); add(1, -1); }
  return dirs;
}
function exposedTiles(occ, cols, rows, e) {
  const S = new Set();
  for (const [dr, dc] of raysFor(e)) {
    const reach = new Uint8Array(cols * rows);
    for (let ri = 0; ri < rows; ri++) {
      const r = dr < 0 ? rows - 1 - ri : ri;
      for (let ci = 0; ci < cols; ci++) {
        const c = dc < 0 ? cols - 1 - ci : ci;
        const i = r * cols + c, br = r - dr, bc = c - dc;
        let rc;
        if (br < 0 || br >= rows || bc < 0 || bc >= cols) rc = 1;
        else { const bi = br * cols + bc; rc = occ[bi] < 0 ? reach[bi] : 0; }
        reach[i] = rc;
        if (rc && occ[i] >= 0) S.add(i);
      }
    }
  }
  return S;
}
function peelLayers(board, cols, rows, e) {
  const occ = board.slice();
  const layer = new Array(board.length).fill(-1);
  let L = 0, remaining = occ.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0), guard = 0;
  while (remaining > 0 && guard++ < board.length + 5) {
    const E = exposedTiles(occ, cols, rows, e);
    if (E.size === 0) break;
    for (const i of E) { layer[i] = L; occ[i] = -1; remaining--; }
    L++;
  }
  for (let i = 0; i < occ.length; i++) if (occ[i] >= 0) layer[i] = L;
  return layer;
}
// Per COLLECTABLE colour: its MIN peel layer (first moment ANY tile is reachable) and
// its AVG peel layer. We rank by (min, avg) so a colour that has a tile exposed RIGHT
// NOW (min 0) always outranks one that only surfaces a layer or two later — that's what
// keeps the front-row cars productive on launch (min matters, not the average depth).
function colorOuterness(board, layer) {
  const sum = new Map(), cnt = new Map(), min = new Map();
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (v < 0 || v >= HARD) continue;
    sum.set(v, (sum.get(v) || 0) + layer[i]);
    cnt.set(v, (cnt.get(v) || 0) + 1);
    min.set(v, Math.min(min.get(v) ?? Infinity, layer[i]));
  }
  const out = new Map();
  for (const [c, s] of sum) out.set(c, { min: min.get(c), avg: s / cnt.get(c) });
  return out;
}

// ---- reorder one level ------------------------------------------------------
function fixLevel(lv) {
  const { cols, rows, board, chests } = lv;
  const track = lv.track ?? "square";
  const layer = peelLayers(board, cols, rows, trackEdges(track));
  const outer = colorOuterness(board, layer);
  // rank colours outside-in: first-surfacing (min layer) wins, ties broken by avg depth.
  // Unknown colours (special cars) sort last.
  const ranked = [...outer.keys()].sort((a, b) => {
    const A = outer.get(a), B = outer.get(b);
    return A.min - B.min || A.avg - B.avg;
  });
  const rank = new Map();
  ranked.forEach((c, i) => rank.set(c, i));
  const keyOf = (c) => (rank.has(c) ? rank.get(c) : 1e6);

  // Group chest indices by pairId.
  const byPair = new Map();
  chests.forEach((c, i) => { if (c.pairId != null) (byPair.get(c.pairId) || byPair.set(c.pairId, []).get(c.pairId)).push(i); });

  const usedInPair = new Set();
  const units = []; // { chests:[...], key, width }
  let kept = 0, broken = 0;
  for (const [, idxs] of byPair) {
    if (idxs.length < 2) continue; // stray pairId → handled as solo below
    const ranks = idxs.map((i) => keyOf(chests[i].color));
    const spread = Math.max(...ranks) - Math.min(...ranks);
    if (spread <= KEEP_SPREAD) {
      idxs.forEach((i) => usedInPair.add(i));
      units.push({ chests: idxs.map((i) => ({ ...chests[i] })), key: ranks.reduce((a, b) => a + b, 0) / ranks.length, width: idxs.length });
      kept++;
    } else {
      broken++; // leave members for the solo pass (pairId stripped there)
    }
  }
  // Solo cars (originals + members of broken pairs). Strip pairId so they're unlinked.
  chests.forEach((c, i) => {
    if (usedInPair.has(i)) return;
    const cc = { ...c };
    delete cc.pairId;
    units.push({ chests: [cc], key: keyOf(c.color), width: 1 });
  });

  // Outside-in order (stable secondary key by colour id then count).
  units.sort((a, b) => a.key - b.key || (a.chests[0].color - b.chests[0].color) || (b.chests[0].count - a.chests[0].count));

  // Bin-pack into rows of PER_ROW so a linked group (width ≥2) lands in adjacent
  // columns of the SAME row (never straddling a row boundary). If a group won't fit
  // the row's remaining slots, pull the next SOLO forward to fill — a tiny, local
  // reordering that keeps the queue outside-in.
  const q = units.slice();
  const result = [];
  let colPos = 0;
  while (q.length) {
    const rem = PER_ROW - colPos;
    let idx = 0;
    if (q[0].width > rem) {
      const s = q.findIndex((u) => u.width <= rem);
      idx = s >= 0 ? s : 0; // no solo to fill → accept a rare straddle (members stay 1 row apart)
    }
    const u = q.splice(idx, 1)[0];
    for (const ch of u.chests) result.push(ch);
    colPos = (colPos + u.width) % PER_ROW;
  }

  lv.chests = result;
  return { kept, broken };
}

// ---- main -------------------------------------------------------------------
const d = JSON.parse(fs.readFileSync(OUT, "utf8"));
let totKept = 0, totBroken = 0, done = 0;
for (let n = LO; n <= HI; n++) {
  const lv = d[n];
  if (!lv) continue;
  const before = lv.chests.reduce((a, c) => a + c.count, 0);
  const r = fixLevel(lv);
  const after = lv.chests.reduce((a, c) => a + c.count, 0);
  if (before !== after) { console.error(`⚠ L${n}: capacity changed ${before}→${after} (BUG, aborting)`); process.exit(1); }
  totKept += r.kept; totBroken += r.broken; done++;
}
const sorted = {};
for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) sorted[k] = d[k];
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
console.log(`✔ reordered ${done} levels (L${LO}-${HI}). twin pairs kept: ${totKept}, unlinked (too far apart): ${totBroken}`);
