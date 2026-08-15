// Dò nấc cho MỘT level, đi từ ĐẦU DỄ và dừng ngay khi trúng dải.
//
//   LV=497 node scripts/_tune-one.mjs            # xem trước
//   LV=497 WRITE=1 node scripts/_tune-one.mjs    # ghi luôn nấc tìm được
//
// Env: LV · MAX (số nấc tối đa được đo, mặc định 24) · N (số ván mỗi phép đo, mặc định 200).
//
// VÌ SAO CÓ FILE NÀY. `_tuneAll --scan` xếp thang theo SỐ XE TĂNG DẦN, tức dò từ đầu KHÓ về dễ.
// Cách ấy đúng khi chưa biết gì về bàn, nhưng tốn: bàn 240 nấc mất ~90 phút. Khi đã biết bàn
// đang QUÁ KHÓ (L497 đo được B=0 ở nấc mượn của L476), đi ngược từ đầu DỄ về khó thì trúng sau
// vài phép đo thay vì vài chục.
//
// ⚠ ĐỪNG DÙNG THAY CHO --scan Ở LÔ LỚN. Nó dừng ở nấc DỄ NHẤT còn lọt dải, trong khi --scan cân
// nhắc thêm số xe và vị trí thua (`positionPenalty`) giữa nhiều nấc đã trúng. Đây là công cụ vá
// một bàn lẻ, không phải thước đo của cả lô.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { cfg, buildX } from "./_tuneAll.mjs";

const LV = Number(process.env.LV);
const MAX = Number(process.env.MAX || 24);
const N = Number(process.env.N || 200);
if (!LV) { console.log("thieu LV="); process.exit(1); }

const d = readD();
const c = cfg(LV);
const caps = (process.env.CAPS || "130,95,65,45,30").split(",").map(Number);
const waves = (process.env.WAVES || "1,2,3,5").split(",").map(Number);
const press = (LV % 5 === 0 || (LV >= 470 && LV <= 500)) ? [0, 0.15, 0.3] : [0, 0.15];
const mins = (process.env.MINCAR_LADDER || "22,40").split(",").map(Number);

const rungs = [];
for (const cap of caps) for (const wave of waves) for (const pressure of press) for (const lay of c.lays) for (const minCar of mins)
  rungs.push({ cap, wave, pressure, lay, minCar, hid: c.hid });

const built = rungs.map((r) => ({ r, L: buildX(d[LV], LV, r) }));
// NHIỀU XE = DỄ. Xếp giảm dần để phép đo đầu tiên là nấc dễ nhất có thể.
built.sort((a, b) => b.L.chests.length - a.L.chests.length);

console.log(`L${LV} | dai ${c.lo}-${c.hi} | ${built.length} nac, do toi da ${MAX}, moi phep ${N} van`);
console.log("nac | xe | B   | ghi chu");
let hit = null, nearest = null;
for (let i = 0; i < Math.min(MAX, built.length); i++) {
  const x = built[i];
  const b = measure2(x.L, N);
  const off = Math.max(0, c.lo - b) + Math.max(0, b - c.hi);
  if (!nearest || off < nearest.off) nearest = { ...x, b, off };
  console.log(` ${String(i + 1).padStart(2)} | ${String(x.L.chests.length).padStart(2)} | ${String(b).padStart(3)} | `
    + (off === 0 ? "TRUNG DAI" : `lech ${off}`));
  if (off === 0) { hit = { ...x, b, off }; break; }
}

const pick = hit || nearest;
console.log(`\nchon: ${hit ? "nac trung dai" : "nac GAN NHAT (khong nac nao trung)"} — B=${pick.b}, ${pick.L.chests.length} xe`);
console.log(`  ${JSON.stringify(pick.r)}`);
if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
d[LV] = pick.L;
writeD(d);
fs.writeFileSync(`scripts/_one-${LV}.json`, JSON.stringify([{ n: LV, b: pick.b, off: pick.off, cars: pick.L.chests.length, rung: pick.r }]));
console.log(`\nda ghi L${LV} vao designed.json`);
