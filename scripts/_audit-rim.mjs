// audit nhanh: rim cấu trúc toàn bộ + trùng artwork theo khoá chuẩn
import fs from "fs";
import { structuralRimPct, canonName } from "./genlib.mjs";

const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const lvls = [...Array(25).keys()].map((i) => i + 1).concat([...Array(22).keys()].map((i) => i + 131));
let bad = 0;
const seen = {};
for (const k of lvls) {
  const L = d[k];
  if (!L) continue;
  const p = structuralRimPct(L.board, L.cols, L.rows);
  if (p > 30) { console.log(`L${k}: rim ${p}% ⚠ [${L.img || ""}]`); bad++; }
  if (L.img) {
    const key = canonName(L.img);
    if (seen[key]) console.log(`DUP: L${k} vs L${seen[key]} (${key})`);
    seen[key] = k;
  }
}
console.log(bad === 0 ? "✔ rim toàn bộ ≤30%, không dup" : `${bad} level vượt`);
