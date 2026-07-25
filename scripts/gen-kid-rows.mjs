// Generate CSV rows for the KID rebuild L200-250 (item 6, user 2026-07-25):
// Non-Tray, cute _simple subjects, size 31, skill 0.6, ideal 20-30 slimes/car,
// winrate 60-90% — levels divisible by 5 -> 60%, L200 -> 90%, others cycle 75-90%.
// Appends to the winrate CSV, replacing any existing 200-250 rows (idempotent).
import fs from "node:fs";
import path from "node:path";
const CSV = path.join(process.cwd(), "Manythings/Design winrate/winratedesign1.csv");
const SIMPLE_DIR = path.join(process.cwd(), "public/art/level art/sliced/_simple");

// cute, low-colour subjects — cycle across the 51 levels
const subjects = fs.readdirSync(SIMPLE_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();

const LO = 200, HI = 250;
const TARGET_CYCLE = [85, 75, 90, 80]; // non-÷5, non-200 targets — all in the 60-90 band
function target(n) {
  if (n === 200) return 90;
  if (n % 5 === 0) return 60;
  return TARGET_CYCLE[(n - LO) % TARGET_CYCLE.length];
}

// row: lvl,tier,target,max màu,maxxe,minxe,xedoi,track,max slim,slime_ref,win_ref,skill,xe_ref,màu_ref,kích thước,line,chôn,l1,tray,img
const rows = [];
for (let n = LO; n <= HI; n++) {
  const subj = subjects[(n - LO) % subjects.length];
  const xedoi = (n - LO) % 2 === 0 ? 1 : 0; // light twin presence (kept easy by the target)
  // maxxe/minxe loose so the tuner centres on ~25 slimes/car (its ideal), i.e. 20-30 band.
  rows.push([n, "kid", target(n), 6, 50, 25, xedoi, "square", "auto", "", "", 0.6, "", "", 31, "", "", "", 0, subj].join(","));
}

let lines = fs.readFileSync(CSV, "utf8").split("\n");
lines = lines.filter((l) => { const m = l.match(/^(\d+),/); return !(m && +m[1] >= LO && +m[1] <= HI); });
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
fs.writeFileSync(CSV, lines.join("\n") + "\n" + rows.join("\n") + "\n");
console.log(`wrote ${rows.length} kid rows (L${LO}-${HI}) from ${subjects.length} subjects`);
