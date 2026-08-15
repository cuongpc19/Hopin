// Chấm "đẹp" cho các bàn CÙNG MỘT CỠ trong designed.json rồi xuất TOP N ra định dạng pick,
// để board-sheet.mjs vẽ ra ảnh mà nhìn.
//   SIZE=31 TOP=10 node scripts/_pretty.mjs
//
// Điểm = màu×3 + liền-mảng×40 + độ-phủ×20, cùng công thức beauty() của emoji-pool.mjs.
// ⚠ ĐIỂM NÀY KHÔNG THAY MẮT NGƯỜI. Nó thưởng bàn ÍT ĐỐM LẺ, mà đo 2026-08-14 cho thấy nó
// không dự đoán được độ khó (r=0.011), và nó cũng từng chấm cao 8 tấm biển cấm nhìn y hệt nhau.
// Dùng để LỌC BỚT rồi nhìn, không dùng để chốt.
import fs from "node:fs";
import { readD, isC } from "./genlib.mjs";

const SIZE = Number(process.env.SIZE || 31);
const TOP = Number(process.env.TOP || 10);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
const d = readD();

function beauty(L) {
  const W = L.cols, H = L.rows, b = L.board, seen = new Array(b.length).fill(false);
  let tiny = 0, blobs = 0, cells = 0;
  for (let i = 0; i < b.length; i++) {
    if (!isC(b[i])) continue;
    cells++;
    if (seen[i]) continue;
    const c = b[i], st = [i]; seen[i] = true; let sz = 0;
    while (st.length) {
      const p = st.pop(); sz++; const x = p % W, y = (p / W) | 0;
      for (const [a, e] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (a < 0 || e < 0 || a >= W || e >= H) continue;
        const q = e * W + a;
        if (!seen[q] && b[q] === c) { seen[q] = true; st.push(q); }
      }
    }
    blobs++; if (sz <= 2) tiny++;
  }
  const colours = new Set(b.filter(isC)).size;
  const clean = blobs ? 1 - tiny / blobs : 0;
  const cover = cells / (W * H);
  return { colours, clean, cover, score: +(colours * 3 + clean * 40 + cover * 20).toFixed(1) };
}

const rows = Object.keys(d).map(Number).sort((a, b) => a - b)
  .filter((n) => (ONLY ? ONLY.has(n) : d[n]?.cols === SIZE))
  .map((n) => ({ n, ...beauty(d[n]), level: d[n] }))
  .sort((a, b) => b.score - a.score);

const pick = {};
console.log(`top ${TOP} / ${rows.length} ban ${SIZE}x${SIZE}:`);
console.log("lv   | diem | mau | lien mang | do phu");
for (const r of rows.slice(0, TOP)) {
  console.log(`L${String(r.n).padEnd(4)}| ${String(r.score).padStart(4)} | ${String(r.colours).padStart(3)} | `
    + `${(r.clean * 100).toFixed(0).padStart(8)}% | ${(r.cover * 100).toFixed(0).padStart(5)}%`);
  pick[`L${r.n}@${SIZE}`] = { name: `L${r.n}`, theme: "", size: SIZE, colours: r.colours, score: r.score, level: r.level };
}
fs.writeFileSync("public/art/level art/emoji/_pretty-pick.json", JSON.stringify(pick));
console.log("\nghi _pretty-pick.json — ve bang: PICK=_pretty-pick.json OUT=... node scripts/board-sheet.mjs");
