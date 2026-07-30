// Generate SLAM (lock-mode) prototype levels: normal ~24x24 board & look, slam:true so the
// waiting-slot LOCK mechanic is on (tap a bay car → it goes out & locks its bay; returns
// with progress if it can't fill; frees the bay when full; deadlock = lose).
// Voronoi colour blobs; chests match each colour's count (solvable) and are INTERLEAVED so
// the auto-filled bays get a colour mix (something's usually reachable → fair, not insta-stuck).
import fs from "fs";
const OUT = "src/levels/designed.json";

const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; }; };

function makeLevel(size, colours, seed, fill = 0.85) {
  const r = rng(seed);
  const seeds = colours.map((c) => ({ x: r() * size, y: r() * size, c }));
  const board = new Array(size * size).fill(-1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (r() > fill) continue;
    let best = 0, bd = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const dx = x + 0.5 - seeds[i].x, dy = y + 0.5 - seeds[i].y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    board[y * size + x] = seeds[best].c;
  }
  // chests per colour, cars of 8–12
  const counts = new Map();
  for (const v of board) if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
  const perColour = [];
  for (const [color, total] of counts) {
    const cars = [];
    let rem = total;
    while (rem > 0) { const c = Math.min(rem, 8 + Math.floor(r() * 5)); cars.push({ color, count: c }); rem -= c; }
    perColour.push(cars);
  }
  // INTERLEAVE colours round-robin so the queue (and thus the bays) gets a colour mix
  const chests = [];
  let added = true;
  while (added) {
    added = false;
    for (const cars of perColour) { if (cars.length) { chests.push(cars.shift()); added = true; } }
  }
  return { track: "square", cols: size, rows: size, board, chests, slam: true };
}

const designed = JSON.parse(fs.readFileSync(OUT, "utf8"));
// clear the old visual-prototype levels 601-605
for (const n of [601, 602, 603, 604, 605]) delete designed[n];
// palette: 0 red,1 orange,2 yellow,3 green,4 teal,5 blue,6 purple,7 pink
designed[601] = makeLevel(24, [0, 2, 5], 6001, 0.8);          // 3 colours (easiest)
designed[602] = makeLevel(24, [1, 3, 5, 7], 6002, 0.82);      // 4 colours
designed[603] = makeLevel(24, [0, 2, 3, 5, 6], 6003, 0.85);   // 5 colours
designed[604] = makeLevel(24, [0, 1, 3, 4, 6], 6004, 0.85);   // 5 colours
designed[605] = makeLevel(25, [0, 2, 3, 5, 6, 7], 6005, 0.88); // 6 colours (hardest)

const sorted = {};
for (const k of Object.keys(designed).map(Number).sort((a, b) => a - b)) sorted[k] = designed[k];
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2));
for (const n of [601, 602, 603, 604, 605]) {
  const L = designed[n];
  const slimes = L.board.filter((v) => v >= 0).length;
  const cols = new Set(L.board.filter((v) => v >= 0)).size;
  console.log(`L${n}: ${L.cols}x${L.rows}, ${slimes} slimes, ${cols} colours, ${L.chests.length} cars (slam=lock)`);
}
console.log("done");
