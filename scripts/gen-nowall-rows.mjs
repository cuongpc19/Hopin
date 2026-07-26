// Generate CSV rows for the NO-WALL 25x25 logic levels L316-330 (user 2026-07-26):
// same target win-rates as the rock-wall set L301-315, but difficulty comes from
// buried cars + twins + hidden "?" + two-layer + FEWER lanes on a small board (no
// rock walls). Non-Tray. Appends to the CSV, replacing any existing 316-330 rows.
import fs from "node:fs";
import path from "node:path";
const CSV = path.join(process.cwd(), "Manythings/Design winrate/winratedesign1.csv");

// lvl, tier, target, img, l1, lanes, bury, xedoi  (all size 25, no walls)
const L = [
  [316, "hard",  22, "7_robot_animals1.png",  6, 4, 0.5, 1],
  [317, "hard",  20, "7_dino_animals1.png",   6, 4, 0.5, 1],
  [318, "hard",  22, "5_fish_animals1.png",   6, 4, 0.5, 1],
  [319, "hard",  20, "6_train_toys.png",      5, 4, 0.5, 1],
  [320, "hard",  18, "7_pencils_toys.png",    5, 4, 0.5, 1],
  [321, "hard",  18, "7_airplane_toys.png",   5, 4, 0.5, 1],
  [322, "hard",  15, "7_cat_animals1.png",    5, 3, 0.5, 1],
  [323, "hard",  15, "7_owl_animals1.png",    5, 3, 0.5, 1],
  [324, "hard",  13, "7_robot_animals1.png",  5, 3, 0.6, 2],
  [325, "hard",  12, "7_dino_animals1.png",   4, 3, 0.6, 2],
  [326, "hard",  12, "5_fish_animals1.png",   4, 3, 0.6, 2],
  [327, "super", 10, "7_pencils_toys.png",    4, 3, 0.6, 2],
  [328, "super",  8, "6_train_toys.png",      4, 3, 0.6, 2],
  [329, "super",  8, "7_robot_animals1.png",  4, 3, 0.6, 2],
  [330, "super",  5, "7_dino_animals1.png",   4, 3, 0.7, 2],
];

// full row: lvl,tier,target,màu,maxxe,minxe,xedoi,track,maxslim,slime_ref,win_ref,skill,xe_ref,màu_ref,size,line,chôn,l1,tray,img,walls(empty)
const rows = L.map(([lvl, tier, target, img, l1, lanes, bury, xedoi]) =>
  [lvl, tier, target, 9, 50, 20, xedoi, "square", "auto", "", "", 0.9, "", "", 25, lanes, bury, l1, 0, img, ""].join(","));

let lines = fs.readFileSync(CSV, "utf8").split("\n");
lines = lines.filter((l) => { const m = l.match(/^(\d+),/); return !(m && +m[1] >= 316 && +m[1] <= 330); });
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
fs.writeFileSync(CSV, lines.join("\n") + "\n" + rows.join("\n") + "\n");
console.log(`wrote ${rows.length} no-wall rows (L316-330)`);
