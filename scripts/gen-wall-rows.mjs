// Generate CSV rows for the ROCK-WALL logic levels L301-315 (user 2026-07-26).
// Hard-rock walls block board edges -> U / arch / line frontier -> narrow frontier =
// LOGIC over fast fingers, and smaller boards = not a slog. winrate 5-25% @ skill 0.9.
// 40% of levels wall the TOP edge only; 40%+ are 25x25; mix in 31/35. Elements: buried
// cars + twins/triples + hidden "?" + light two-layer. Non-Tray (classic game).
// Appends to the winrate CSV, replacing any existing 301-315 rows (idempotent).
import fs from "node:fs";
import path from "node:path";
const CSV = path.join(process.cwd(), "Manythings/Design winrate/winratedesign1.csv");

// lvl, tier, target, màu, size, walls, img, l1, lanes, bury, xedoi
const L = [
  // 6 TOP-ONLY walls (40%) — mildest (3 sides still open)
  [301, "hard",  22, "25", "T",   "7_robot_animals1.png",  6, 4, 0.5, 1],
  [302, "hard",  20, "25", "T",   "7_dino_animals1.png",   6, 4, 0.5, 1],
  [303, "hard",  22, "25", "T",   "7_star_heroes.png",     5, 3, 0.7, 1],
  [304, "hard",  20, "25", "T",   "6_train_toys.png",      7, 5, 0.5, 1],
  [305, "hard",  18, "31", "T",   "7_pencils_toys.png",    6, 4, 0.5, 2],
  [306, "hard",  18, "31", "T",   "7_airplane_toys.png",   6, 4, 0.5, 1],
  // 5 TWO-EDGE walls — narrower frontier
  [307, "hard",  15, "25", "TL",  "5_fish_animals1.png",   6, 4, 0.5, 1],
  [308, "hard",  15, "25", "TR",  "7_cat_animals1.png",    6, 4, 0.5, 1],
  [309, "hard",  13, "31", "TB",  "7_owl_animals1.png",    6, 4, 0.5, 2],
  [310, "hard",  12, "35", "TL",  "7_robot_animals1.png",  6, 5, 0.6, 2],
  [311, "hard",  12, "35", "LR",  "7_dino_animals1.png",   6, 5, 0.6, 2],
  // 4 THREE-EDGE walls — only 1 open edge = LINE frontier, hardest
  [312, "super", 10, "25", "TLR", "7_star_heroes.png",     7, 4, 0.6, 1],
  [313, "super",  8, "31", "TLB", "6_train_toys.png",      7, 5, 0.6, 2],
  [314, "super",  8, "35", "TRB", "7_pencils_toys.png",    7, 5, 0.6, 2],
  [315, "super",  5, "25", "TLR", "7_robot_animals1.png",  7, 4, 0.6, 2],
];

// full row: lvl,tier,target,màu,maxxe,minxe,xedoi,track,maxslim,slime_ref,win_ref,skill,xe_ref,màu_ref,size,line,chôn,l1,tray,img,walls
const rows = L.map(([lvl, tier, target, size, walls, img, l1, lanes, bury, xedoi]) =>
  [lvl, tier, target, 9, 50, 20, xedoi, "square", "auto", "", "", 0.9, "", "", size, lanes, bury, l1, 0, img, walls].join(","));

let lines = fs.readFileSync(CSV, "utf8").split("\n");
lines = lines.filter((l) => { const m = l.match(/^(\d+),/); return !(m && +m[1] >= 301 && +m[1] <= 315); });
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
fs.writeFileSync(CSV, lines.join("\n") + "\n" + rows.join("\n") + "\n");
console.log(`wrote ${rows.length} rock-wall rows (L301-315)`);
