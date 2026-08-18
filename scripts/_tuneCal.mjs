// DÒ NẤC THEO THƯỚC ĐÃ HIỆU CHUẨN, không phải theo mô hình B.
//
//   LV=9109 TARGET=62 node scripts/_tuneCal.mjs
//   LV=9109,9129 TARGET=62,10 WRITE=1 node scripts/_tuneCal.mjs
//
// Env: LV · TARGET · BAND (±, mặc định 5) · N_B (200) · D_TRIALS (60).
//
// VÌ SAO CẦN. `_tuneAll` dò bằng B một mình, mà B chấm ÁP CHÓT trên 67 ván thật (LL -74.2, tệ
// hơn cả đoán bừa một hằng số -46.4). Thước chính thức là blend(B, D) nắn qua logistic. Với
// phần lớn level hai thước cho cùng câu trả lời, nhưng ở hai bàn của bộ C chúng cãi nhau kịch
// liệt — L9109 B=57 mà D=0, L9129 B=10 mà D=100 — và ở đó B một mình dẫn đi sai hẳn.
//
// ⚠ CHÊNH LỆCH B-D LỚN LÀ TÍN HIỆU, KHÔNG PHẢI NHIỄU. Nếu nấc tốt nhất vẫn còn |B-D| rất lớn
// thì con số hiệu chuẩn chỉ là trung bình của hai phán đoán mâu thuẫn, không phải một ước
// lượng — lúc ấy nên ĐỔI BÀN chứ đừng vặn tiếp. Script in cột đó ra để thấy.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { measureDBatch, blend } from "./calib.mjs";
import { buildX, cfg } from "./_tuneAll.mjs";

const LV = (process.env.LV || "").split(",").map(Number).filter(Boolean);
const TG = (process.env.TARGET || "").split(",").map(Number);
const BAND = Number(process.env.BAND || 5);
const N_B = Number(process.env.N_B || 200);
const d = readD();
if (!LV.length || LV.length !== TG.length) { console.log("can LV= va TARGET= cung so phan tu"); process.exit(1); }

const out = [];
for (let k = 0; k < LV.length; k++) {
  const n = LV[k], target = TG[k];
  const c = cfg(n);
  const caps = (process.env.CAPS || "130,95,65,45,30").split(",").map(Number);
  const waves = (process.env.WAVES || "1,2,3,5").split(",").map(Number);
  const press = (n % 5 === 0) ? [0, 0.15, 0.3] : [0, 0.15];
  const mins = (process.env.MINCAR_LADDER || "22,40").split(",").map(Number);
  let rungs = [];
  for (const cap of caps) for (const wave of waves) for (const pressure of press) for (const lay of c.lays) for (const minCar of mins)
    rungs.push({ cap, wave, pressure, lay, minCar, hid: c.hid });
  let built = rungs.map((r) => ({ r, L: buildX(d[n], n, r) })).filter((x) => x.L.chests.length >= 6);
  if (c.cars) {
    const w = built.filter((x) => x.L.chests.length >= c.cars[0] && x.L.chests.length <= c.cars[1]);
    if (w.length) built = w;
  }
  console.error(`L${n}: ${built.length} nac, dich ${target}±${BAND}`);

  // B cho từng nấc, rồi D cho CẢ LÔ trong một lần spawn (D đắt, gọi từng cái là không xong).
  for (const x of built) x.b = measure2(x.L, N_B);
  const ds = measureDBatch(built.map((x) => x.L), { trials: Number(process.env.D_TRIALS || 60), tag: "cal" });
  built.forEach((x, i) => { x.d = ds[i]; x.cal = blend(x.b, x.d); x.spread = Math.abs(x.b - (x.d ?? x.b)); });

  // ⚠ TRONG SỐ NẤC ĐÃ LỌT DẢI, LẤY NẤC HAI MÔ HÌNH ĐỒNG THUẬN NHẤT — không lấy nấc gần đích
  // nhất. Xếp theo khoảng cách tới đích thì một nấc lệch 1 điểm nhưng B-D cãi nhau 39 điểm sẽ
  // thắng một nấc lệch 4 điểm mà B-D chỉ chênh 3, trong khi nấc thứ hai đáng tin hơn hẳn: con
  // số hiệu chuẩn là trung bình của B và D, nên nó chỉ có nghĩa khi hai bên không mâu thuẫn.
  // Đo được ở chính L9109: nấc thắng cũ B=96/D=57, còn nấc bị bỏ qua B=80/D=77.
  const inBand = built.filter((x) => Math.abs(x.cal - target) <= BAND);
  if (inBand.length) inBand.sort((a, b) => a.spread - b.spread || Math.abs(a.cal - target) - Math.abs(b.cal - target));
  else built.sort((a, b) => Math.abs(a.cal - target) - Math.abs(b.cal - target) || a.spread - b.spread);
  const pool = inBand.length ? inBand : built;
  const best = pool[0];
  console.log(`\nL${n} — 6 nac gan dich nhat (dich ${target}):`);
  console.log("   B   |  D   | hieu chuan | lech B-D | xe | nac");
  for (const x of pool.slice(0, 6))
    console.log(`  ${String(x.b).padStart(3)}  | ${String(x.d ?? "-").padStart(4)} | ${String(x.cal).padStart(9)}% | ${String(x.spread).padStart(8)} | ${String(x.L.chests.length).padStart(2)} | cap${x.r.cap} w${x.r.wave} p${x.r.pressure} mc${x.r.minCar}`);
  const ok = Math.abs(best.cal - target) <= BAND;
  console.log(`  -> chon: hieu chuan ${best.cal}% (${ok ? "DAT" : "TRUOT " + Math.abs(best.cal - target)}), lech B-D = ${best.spread}`);
  if (best.spread > 40) console.log(`  ⚠ B va D con cai nhau ${best.spread} diem — con so nay khong dang tin, nen DOI BAN`);
  out.push({ n, best, ok });
}

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const o of out) d[o.n] = o.best.L;
writeD(d);
console.log(`\nda ghi ${out.length} level vao designed.json`);
