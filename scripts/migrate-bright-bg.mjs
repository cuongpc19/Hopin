// One-off migration (user rule 2026-07-26): board mat is ALWAYS dark caro (drop
// lightBoard), and the picture BACKGROUND FILL becomes a BRIGHT panel colour
// (sky-blue id15 by default; a different bright id when the subject already uses 15).
// This is a pure per-level RELABEL of the single background colour id across every
// layer (board / layer2 / hidden) + chests — no cell moves, no count changes — so
// the measured winrate / difficulty is identical. Cars that were the old bg colour
// follow the rename. Re-runnable? No — run once on the freshly-built designed.json.
import fs from "node:fs";

const FILE = "src/levels/designed.json";
const ROCK = 90; // HARD_ROCK sentinel — never treat as a colour
// Bright bg preference: sky-blue first, then other clearly-bright hues. Dark ids
// (9 grey/10/12/13/16/18) are excluded so the bg always pops on the dark board.
const BRIGHT_PREF = [15, 4, 5, 17, 2, 1, 3, 7, 8, 6, 0, 14];

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const levels = data.levels || data;

// bg id = the mode colour of the outer ring of the filled (non-empty, non-rock) bbox.
function detectBg(L) {
  const { board, cols: W, rows: H } = L;
  let minx = W, miny = H, maxx = -1, maxy = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = board[y * W + x];
    if (v >= 0 && v !== ROCK) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  const cnt = {};
  const tally = (x, y) => { const v = board[y * W + x]; if (v >= 0 && v !== ROCK) cnt[v] = (cnt[v] || 0) + 1; };
  for (let x = minx; x <= maxx; x++) { tally(x, miny); tally(x, maxy); }
  for (let y = miny; y <= maxy; y++) { tally(minx, y); tally(maxx, y); }
  let best = -1, bm = 0;
  for (const k in cnt) if (cnt[k] > bm) { bm = cnt[k]; best = +k; }
  return best;
}

let report = [];
for (let n = 1; n <= 45; n++) {
  const L = levels[String(n)];
  if (!L) continue;
  const bg = detectBg(L);
  if (bg < 0) { report.push(`L${n}: no bg detected, skipped`); continue; }

  // colours the SUBJECT uses (everything except the bg id), across all colour layers
  const subj = new Set();
  const scan = (arr) => { if (arr) for (const v of arr) if (v >= 0 && v !== ROCK && v !== bg) subj.add(v); };
  scan(L.board); scan(L.layer2); scan(L.hidden);

  // pick a bright bg id not used by the subject (so it never merges → difficulty stays)
  let newBg = BRIGHT_PREF.find((id) => !subj.has(id));
  if (newBg == null) newBg = 15; // subject somehow uses every bright — fall back

  // relabel bg -> newBg everywhere it appears as a collectable colour
  if (newBg !== bg) {
    const relabel = (arr) => { if (arr) for (let i = 0; i < arr.length; i++) if (arr[i] === bg) arr[i] = newBg; };
    relabel(L.board); relabel(L.layer2); relabel(L.hidden);
    if (L.chests) for (const c of L.chests) if (c.color === bg) c.color = newBg;
  }

  // board mat: always dark caro now
  const wasLight = !!L.lightBoard;
  delete L.lightBoard;

  report.push(`L${String(n).padStart(2)}  bg ${String(bg).padStart(2)} -> ${String(newBg).padStart(2)}${newBg === bg ? " (same)" : ""}   ${wasLight ? "light->dark" : "dark"}`);
}

fs.writeFileSync(FILE, JSON.stringify(data));
console.log(report.join("\n"));
console.log(`\n✔ wrote ${FILE}`);
