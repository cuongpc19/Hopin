// BỎ XE "?" và ĐẢO THỨ TỰ hàng xe của một level, giữ nguyên bàn cờ.
//
//   LV=9134 node scripts/_shuffleOne.mjs                # xem trước, thử nhiều hoán vị
//   LV=9134 PICK=3 WRITE=1 node scripts/_shuffleOne.mjs # ghi hoán vị số 3
//
// Env: LV · SEED · TRIES (số hoán vị thử, mặc định 12) · LO/HI (dải winrate chấp nhận) · PICK.
//
// Vì sao cần đo lại: THỨ TỰ HÀNG XE chính là núm độ khó lớn nhất của game này — đảo xe không
// phải chuyện trang trí. Số ghế không đổi nên bất biến ghế=ô vẫn đúng, nhưng winrate thì đổi.
//
// ⚠ GIỮ NGUYÊN VỊ TRÍ XE ĐÔI. Cặp phải nằm dọc cùng cột (chỉ số cách nhau đúng LANES); đảo bừa
// là dây kéo chéo trở lại — đúng lỗi vừa sửa xong. Chỉ hoán vị các xe KHÔNG thuộc cặp nào.
import fs from "node:fs";
import { readD, writeD, mkRng } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { measureDBatch, blend } from "./calib.mjs";

const LV = Number(process.env.LV);
const TRIES = Number(process.env.TRIES || 12);
const LO = Number(process.env.LO || 90), HI = Number(process.env.HI || 100);
const d = readD();
const src = d[LV];
if (!src) { console.log(`L${LV}: khong co ban`); process.exit(1); }

const base = JSON.parse(JSON.stringify(src));
for (const c of base.chests) delete c.buried;           // bỏ xe "?"
const locked = new Set(base.chests.map((c, i) => (c.pairId != null ? i : -1)).filter((i) => i >= 0));
const free = base.chests.map((_, i) => i).filter((i) => !locked.has(i));

const cands = [];
for (let t = 0; t < TRIES; t++) {
  const L = JSON.parse(JSON.stringify(base));
  if (t > 0) {                                          // t=0 = chỉ bỏ xe "?", không đảo
    const rng = mkRng(Number(process.env.SEED || 4242) + t * 977);
    const perm = free.slice();
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const taken = free.map((_, k) => base.chests[perm[k]]);
    free.forEach((idx, k) => { L.chests[idx] = JSON.parse(JSON.stringify(taken[k])); });
  }
  cands.push({ t, L });
}
const Bs = cands.map((c) => measure2(c.L, 200));
const Ds = measureDBatch(cands.map((c) => c.L), { trials: 60, tag: "shuf" });
cands.forEach((c, i) => { c.b = Bs[i]; c.d = Ds[i]; c.cal = blend(Bs[i], Ds[i]); c.spread = Math.abs(Bs[i] - (Ds[i] ?? Bs[i])); });

console.log(`L${LV} — bo ${src.chests.filter((c) => c.buried).length} xe "?", thu ${TRIES} hoan vi`);
console.log("  # | thu tu mau (5 xe dau)      |  B  |  D  | hieu chuan | lech | trong dai?");
for (const c of cands) {
  const head = c.L.chests.slice(0, 5).map((x) => `${x.color}x${x.count}`).join(" ");
  const ok = c.cal >= LO && c.cal <= HI;
  console.log(`  ${String(c.t).padStart(1)} | ${head.padEnd(26)} | ${String(c.b).padStart(3)} | ${String(c.d ?? "-").padStart(3)} | ${String(c.cal).padStart(9)}% | ${String(c.spread).padStart(4)} | ${ok ? "dat" : "truot"}`);
}
const good = cands.filter((c) => c.cal >= LO && c.cal <= HI).sort((a, b) => a.spread - b.spread);
console.log(`\n${good.length}/${TRIES} hoan vi trong dai ${LO}-${HI}. Tot nhat (dong thuan nhat): #${good[0]?.t}`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat PICK=<so> WRITE=1 de ghi"); process.exit(0); }
const pick = process.env.PICK != null ? cands.find((c) => c.t === Number(process.env.PICK)) : good[0];
if (!pick) { console.log("khong co hoan vi nao phu hop"); process.exit(1); }
d[LV] = pick.L;
writeD(d);
console.log(`\nda ghi hoan vi #${pick.t} — hieu chuan ${pick.cal}%, lech B-D ${pick.spread}`);
