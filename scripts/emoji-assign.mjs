// BƯỚC 2/2 của bộ dựng level từ emoji.  Chạy SAU emoji-pool.mjs:
//   node scripts/emoji-assign.mjs        (đọc pool.json, ghi thẳng designed.json)
//
// Xếp 60 chủ thể vào L61-120 với BA ràng buộc cùng lúc:
//   1. đẹp dần lên  (user: "level khó là level đẹp nhất", level càng cao càng khó)
//   2. chủ đề xen kẽ (không hai bàn liền nhau cùng chủ đề)
//   3. cỡ xen kẽ 25/31
// Ba ràng buộc này cãi nhau, nên: neo theo (1), rồi hoán vị CỤC BỘ để gỡ (2) và (3) —
// đổi chỗ hai slot gần nhau thì thứ tự đẹp gần như không xê dịch.
import fs from "node:fs";
const D = "public/art/level art/emoji";
const pool = JSON.parse(fs.readFileSync(D + "/pool.json", "utf8"));

const by = {};
for (const v of Object.values(pool)) {
  const o = (by[v.name] = by[v.name] || { name: v.name, theme: v.theme, sizes: [], score: 0 });
  o.sizes.push(v.size); o.score = Math.max(o.score, v.score);
}
const all = Object.values(by).sort((a, b) => a.score - b.score);
const START = 61, N = 60;
const chosen = all.slice(all.length - N);           // bỏ những cái điểm thấp nhất
chosen.sort((a, b) => a.score - b.score);           // đẹp dần lên

const sizeAt = (i) => (i % 2 === 0 ? 25 : 31);
const canT = (o, i) => o.sizes.includes(sizeAt(i));

// gỡ ràng buộc CỠ trước: chủ thể chỉ dựng được một cỡ phải rơi đúng slot cùng chẵn/lẻ
for (let i = 0; i < N; i++) {
  if (canT(chosen[i], i)) continue;
  let best = -1;
  for (let d = 1; d < N; d++) for (const j of [i - d, i + d]) {
    if (j < 0 || j >= N || best >= 0) continue;
    if (canT(chosen[j], i) && canT(chosen[i], j)) best = j;
  }
  if (best >= 0) { const t = chosen[i]; chosen[i] = chosen[best]; chosen[best] = t; }
}
// rồi gỡ CHỦ ĐỀ trùng liền nhau
const clash = (arr, i) => (i > 0 && arr[i].theme === arr[i - 1].theme) || (i < N - 1 && arr[i].theme === arr[i + 1].theme);
for (let pass = 0; pass < 8; pass++) {
  let fixed = 0;
  for (let i = 1; i < N; i++) {
    if (chosen[i].theme !== chosen[i - 1].theme) continue;
    for (let d = 1; d < 12; d++) {
      const j = i + d; if (j >= N) break;
      if (!canT(chosen[j], i) || !canT(chosen[i], j)) continue;
      const a = chosen[i], b = chosen[j];
      chosen[i] = b; chosen[j] = a;
      if (!clash(chosen, i) && !clash(chosen, j)) { fixed++; break; }
      chosen[i] = a; chosen[j] = b;
    }
  }
  if (!fixed) break;
}

const dup = [];
for (let i = 1; i < N; i++) if (chosen[i].theme === chosen[i - 1].theme) dup.push(START + i);
const badSize = [];
for (let i = 0; i < N; i++) if (!canT(chosen[i], i)) badSize.push(START + i);

const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const table = [];
for (let i = 0; i < N; i++) {
  const o = chosen[i], size = o.sizes.includes(sizeAt(i)) ? sizeAt(i) : o.sizes[0];
  const rec = pool[`${o.name}@${size}`];
  d[START + i] = rec.level;
  table.push({ lv: START + i, name: o.name, theme: o.theme, size, score: o.score, colours: rec.colours, cars: rec.level.chests.length });
}
fs.writeFileSync("src/levels/designed.json", JSON.stringify(d, null, 2));
fs.writeFileSync(D + "/assign.json", JSON.stringify(table, null, 1));
console.log(`ghi ${N} bàn L${START}-${START + N - 1}`);
console.log(`chủ đề trùng liền nhau: ${dup.length ? dup.join(",") : "không"}`);
console.log(`lệch nhịp cỡ: ${badSize.length ? badSize.join(",") : "không"}`);
console.log(`điểm đẹp: L${START} = ${chosen[0].score.toFixed(0)}  →  L${START + N - 1} = ${chosen[N - 1].score.toFixed(0)}`);
