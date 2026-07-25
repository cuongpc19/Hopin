// Generate CSV rows for the L126-185 two-layer / tray pack (item 5, user 2026-07-25).
// 30 levels per mode (Non-Tray L126-155, Tray L156-185): 5 interleaved subjects × 2
// sizes (31,35) × 3 difficulties (super 10% / hard 25% / medium 35% @ skill 0.9).
// Appends to the winrate CSV, replacing any existing 126-185 rows (idempotent).
import fs from "node:fs";
import path from "node:path";
const CSV = path.join(process.cwd(), "Manythings/Design winrate/winratedesign1.csv");

// interleaved (scattered-colour) subjects — the difficulty rule: colour-INTERLEAVED art.
const SUBJ = {
  super:  ["6_train_toys.png", "7_pencils_toys.png", "7_robot_animals1.png", "7_dino_animals1.png", "7_star_heroes.png"],
  hard:   ["7_airplane_toys.png", "5_bus_objects.png", "5_fish_animals1.png", "7_cat_animals1.png", "7_owl_animals1.png"],
  medium: ["6_elephant_toys.png", "6_goldfish_toys.png", "7_bear_animals1.png", "7_mushroom_heroes.png", "6_spacecat_heroes.png"],
};
// The two modes need DIFFERENT params for the SAME target: NON-TRAY's juggle bot is
// forgiving (a bottom-2 level reads ~43%), so non-tray goes HARDER — 5 lanes (needed
// for the perfect solver to survive a many-colour hidden bottom) + a lower l1 (more
// hidden colours). TRAY has no juggle (much harder already), so a bottom-2 level lands
// near target — 4 lanes + high l1. Difficulty = hidden bottom + burial + "?" + groups.
const P = {
  // [tier, target, l1_nontray, lanes_nontray, l1_tray, lanes_tray, bury, xedoi]
  super:  { target: 10, mau: 9, ntL1: 4, ntLanes: 5, trL1: 5, trLanes: 4, bury: 0.6, xedoi: 1, tier: "super" },
  hard:   { target: 25, mau: 9, ntL1: 5, ntLanes: 5, trL1: 6, trLanes: 4, bury: 0.4, xedoi: 1, tier: "hard" },
  medium: { target: 35, mau: 9, ntL1: 6, ntLanes: 5, trL1: 7, trLanes: 5, bury: 0.2, xedoi: 0, tier: "hard" },
};
const DIFFS = ["super", "hard", "medium"];
const SIZES = [31, 35];

// row: lvl,tier,target,max màu,maxxe,minxe,xedoi,track,max slim,slime_ref,win_ref,skill,xe_ref,màu_ref,kích thước,line,chôn,l1,tray,img
function row(n, d, size, subj, tray) {
  const p = P[d];
  const l1 = tray ? p.trL1 : p.ntL1;
  const lanes = tray ? p.trLanes : p.ntLanes;
  return [n, p.tier, p.target, p.mau, 55, 25, p.xedoi, "square", "auto", "", "", 0.9, "", "", size, lanes, p.bury, l1, tray, subj].join(",");
}

const rows = [];
let n = 126;
for (const tray of [0, 1]) {          // 0 = Non-Tray (126-155), 1 = Tray (156-185)
  for (const d of DIFFS) {
    for (const size of SIZES) {
      for (const subj of SUBJ[d]) rows.push(row(n++, d, size, subj, tray));
    }
  }
}

let lines = fs.readFileSync(CSV, "utf8").split("\n");
lines = lines.filter((l) => { const m = l.match(/^(\d+),/); return !(m && +m[1] >= 126 && +m[1] <= 185); });
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
const out = lines.join("\n") + "\n" + rows.join("\n") + "\n";
fs.writeFileSync(CSV, out);
console.log(`wrote ${rows.length} rows (L126-${n - 1}) → ${path.relative(process.cwd(), CSV)}`);
