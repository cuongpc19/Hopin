// BƯỚC 2/2 của bộ dựng level từ emoji.  Chạy SAU emoji-pool.mjs:
//   node scripts/emoji-assign.mjs        (đọc pool.json, ghi thẳng designed.json)
//
// Xếp 60 chủ thể vào L61-120 với BA ràng buộc cùng lúc:
//   1. đẹp dần lên  (user: "level khó là level đẹp nhất", level càng cao càng khó)
//   2. chủ đề xen kẽ (không hai bàn liền nhau cùng chủ đề)
//   3. cỡ xen kẽ 25/31
// Ba ràng buộc này cãi nhau, nên: neo theo (1), rồi hoán vị CỤC BỘ để gỡ (2) và (3) —
// đổi chỗ hai slot gần nhau thì thứ tự đẹp gần như không xê dịch.
//
// POOL=<file> START=<level đầu> COUNT=<số bàn> WIPEFROM=<level> node scripts/emoji-assign.mjs
// WIPEFROM xoá mọi level từ số đó trở lên TRƯỚC khi ghi — dùng khi thay nguyên một dải.
import fs from "node:fs";
const D = "public/art/level art/emoji";
const pool = JSON.parse(fs.readFileSync(`${D}/${process.env.POOL || "pool.json"}`, "utf8"));

const by = {};
for (const v of Object.values(pool)) {
  const o = (by[v.name] = by[v.name] || { name: v.name, theme: v.theme, sizes: [], score: 0 });
  o.sizes.push(v.size); o.score = Math.max(o.score, v.score);
}
const all = Object.values(by).sort((a, b) => a.score - b.score);
const START = Number(process.env.START || 61), N = Number(process.env.COUNT || 60);
if (all.length < N) { console.error(`kho chỉ có ${all.length} chủ thể, cần ${N}`); process.exit(1); }
const chosen = all.slice(all.length - N);           // bỏ những cái điểm thấp nhất
chosen.sort((a, b) => a.score - b.score);           // đẹp dần lên

// NHỊP CỠ BÀN. Mặc định giữ nết cũ: 25/31 xen kẽ một-một.
//
// SIZES="31,35" chuyển sang nhịp THEO TỈ LỆ CÓ THẬT trong pool. Lô 2026-08-14 có 194 bàn cỡ 35
// và 106 bàn cỡ 31, mà mỗi chủ thể chỉ dựng được ĐÚNG một cỡ — ép xen kẽ một-một thì 88 slot
// không thể khớp và vòng hoán vị bên dưới chạy vô ích. Rải theo tỉ lệ (Bresenham) thì cỡ nhỏ
// nằm rải đều khắp dải thay vì dồn một cục, và gần như mọi slot đều khớp được.
const SIZES = (process.env.SIZES || "").split(",").map(Number).filter(Boolean);
let sizeAt;
if (SIZES.length === 2) {
  const cnt = {};
  for (const o of chosen) for (const s of o.sizes) cnt[s] = (cnt[s] || 0) + 1;
  const [A, B] = SIZES;                       // A = cỡ nhỏ, rải xen vào giữa cỡ B
  const nA = Math.min(cnt[A] || 0, N);
  const pat = [];
  for (let i = 0; i < N; i++) pat.push(Math.floor(((i + 1) * nA) / N) > Math.floor((i * nA) / N) ? A : B);
  sizeAt = (i) => pat[i];
} else {
  sizeAt = (i) => (i % 2 === 0 ? 25 : 31);
}
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
if (process.env.WIPEFROM) {
  const from = Number(process.env.WIPEFROM);
  const gone = Object.keys(d).map(Number).filter((k) => k >= from);
  for (const k of gone) delete d[k];
  console.log(`xoá ${gone.length} level cũ từ L${from} trở lên`);
}
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
