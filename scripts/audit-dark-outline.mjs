// AUDIT (+ optional fix) existing designed.json levels for the "dark outline on a dark
// board" problem (FEATURES §20 RULE 4). A picture level whose SUBJECT PERIMETER is mostly
// dark AND whose BG fill is dark → the outline vanishes. Fix = relabel the dark bg colour
// to a LIGHT one (1:1 rename → winrate preserved) + set lightBoard:true.
//
//   node scripts/audit-dark-outline.mjs         → report candidates only (no write)
//   node scripts/audit-dark-outline.mjs --apply  → apply the fix + write designed.json
import fs from "fs";

const OUT = "src/levels/designed.json";
const APPLY = process.argv.includes("--apply");
const BASE_HEX = ["#fe4038","#fe8f28","#fed734","#37cb5c","#2ac0cc","#408afa","#9756fd","#fd55a5","#ffffff","#cbcbcb","#4a4a4a","#985828","#262630","#3050a0","#e0b888","#98d0f0","#208038","#f8c0c8","#902030"];
const hx = (h) => { h = h.replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; };
const rgb = BASE_HEX.map(hx);
const lum = (id) => { const c = rgb[id]; return 0.299*c[0]+0.587*c[1]+0.114*c[2]; };
const dist2 = (a,b) => { const r=a[0]-b[0],g=a[1]-b[1],bl=a[2]-b[2]; return r*r+g*g+bl*bl; };
const DARK = 95;

const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
const cands = [];

for (const key of Object.keys(data)) {
  const L = data[key];
  if (!L || L.track !== "square" || !Array.isArray(L.board)) continue;
  const size = L.cols;
  if (size < 15 || L.rows !== size) continue; // picture-scale only
  const b = L.board;
  // colour histogram of removable tiles (ignore obstacles >=90 and empty -1)
  const hist = {};
  for (const v of b) if (v >= 0 && v < 90) hist[v] = (hist[v]||0)+1;
  const colours = Object.keys(hist).map(Number);
  if (colours.length < 2) continue;
  // bg colour = mode of the inner-border ring (row/col = 1 and size-2), where the fill lives
  const ring = {};
  const add = (i) => { const v = b[i]; if (v >= 0 && v < 90) ring[v] = (ring[v]||0)+1; };
  for (let c = 1; c < size-1; c++) { add(1*size+c); add((size-2)*size+c); }
  for (let r = 1; r < size-1; r++) { add(r*size+1); add(r*size+size-2); }
  const bgId = Object.entries(ring).sort((a,z)=>z[1]-a[1])[0]?.[0];
  if (bgId == null) continue;
  const bg = Number(bgId);
  if (lum(bg) >= DARK) continue;               // bg already light → fine
  // subject perimeter darkness (subject = non-bg removable cells touching bg/empty/edge)
  let perim = 0, dark = 0;
  for (let i = 0; i < b.length; i++) {
    const v = b[i]; if (v < 0 || v >= 90 || v === bg) continue;
    const r = (i/size)|0, c = i%size;
    const nb = [r>0?b[i-size]:-1, r<size-1?b[i+size]:-1, c>0?b[i-1]:-1, c<size-1?b[i+1]:-1];
    const edge = r===0||c===0||r===size-1||c===size-1 || nb.some((x)=> x<0 || x===bg);
    if (!edge) continue;
    perim++; if (lum(v) < DARK) dark++;
  }
  const frac = perim ? dark/perim : 0;
  if (frac < 0.45) continue;                    // outline not mostly dark
  // already fixed?
  if (L.lightBoard) continue;
  // choose a LIGHT replacement id not used on the board
  const used = new Set(colours);
  const LIGHT = [8,9,14,15,17].filter((id)=> !used.has(id));
  const usedRgb = colours.map((id)=>rgb[id]);
  let repl = LIGHT[0] ?? 8, bd = -1;
  for (const id of LIGHT) { let mn=Infinity; for (const c of usedRgb){ const d=dist2(rgb[id],c); if(d<mn)mn=d; } if(mn>bd){bd=mn;repl=id;} }
  cands.push({ level: key, size, bg, bgCount: hist[bg], perimDarkPct: Math.round(frac*100), repl, colours: colours.length });
}

console.log(`\nDARK-OUTLINE-ON-DARK candidates: ${cands.length}`);
console.log("level  size  bg→light  perimDark%  bgCells  colours");
for (const c of cands) console.log(`  L${c.level.padEnd(4)} ${String(c.size).padStart(2)}   ${c.bg}→${c.repl}       ${String(c.perimDarkPct).padStart(3)}%       ${String(c.bgCount).padStart(4)}    ${c.colours}`);

if (APPLY && cands.length) {
  for (const c of cands) {
    const L = data[c.level];
    const rm = (v) => v === c.bg ? c.repl : v;
    L.board = L.board.map(rm);
    if (Array.isArray(L.layer2)) L.layer2 = L.layer2.map((v)=> v>=0 ? rm(v) : v);
    if (Array.isArray(L.chests)) L.chests = L.chests.map((ch)=> ({...ch, color: rm(ch.color)}));
    L.lightBoard = true;
  }
  const sorted = {};
  for (const k of Object.keys(data).map(Number).sort((a,z)=>a-z)) sorted[k] = data[k];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
  console.log(`\n✔ applied fix to ${cands.length} levels (bg relabel + lightBoard).`);
} else if (cands.length) {
  console.log(`\n(dry run — rerun with --apply to fix)`);
}
