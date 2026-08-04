// flatten-tile-gloss.mjs — làm PHẲNG chuyển sắc trong từng ô (public/art/slime/tile-*.png).
//
// Vấn đề (user 2026-08-03, sau khi đã bỏ bóng + viền đen + cho ô chạm nhau): "vẫn có mấy gợn
// gợn này". Cái gợn còn lại KHÔNG phải ron giữa hai ô nữa mà là CHUYỂN SẮC BÊN TRONG mỗi ô —
// keycap sáng ở trên-trái, tối dần xuống dưới-phải → cả bàn trông như mặt chăn dập ô.
// Đo trên render thật (ô be, một hàng ngang cắt qua 4 ô): biên độ 181-193.
//
// Cách làm: kéo mọi pixel về gần MÀU TRUNG BÌNH của thân ô — new = mean + (old - mean)×(1-FLAT).
// FLAT=0 giữ nguyên, FLAT=1 phẳng lì hoàn toàn. Alpha giữ nguyên nên hình dạng/bo góc không đổi.
//
// ⚠ CỘNG DỒN: chạy 2 lần là phẳng gấp đôi. Muốn đổi FLAT thì
//    git checkout <commit trước> -- public/art/slime   rồi chạy lại MỘT lần.
//
// Chạy:  FLAT=0.75 node scripts/flatten-tile-gloss.mjs      ·  DRY=1 để chỉ đo
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = "public/art/slime";
const FLAT = Math.max(0, Math.min(1, Number(process.env.FLAT ?? 0.75)));
const DRY = process.env.DRY === "1";

for (const f of fs.readdirSync(DIR).filter((x) => /^tile-\d+\.png$/.test(x)).sort()) {
  const p = path.join(DIR, f);
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  // màu trung bình của THÂN (alpha đặc) — pixel mép mờ không được kéo trung bình đi
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 250) continue;
    sr += out[i]; sg += out[i + 1]; sb += out[i + 2]; n++;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let before = { mn: 255, mx: 0 }, after = { mn: 255, mx: 0 };
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const l0 = lum(out[i], out[i + 1], out[i + 2]);
    if (out[i + 3] >= 250) { before.mn = Math.min(before.mn, l0); before.mx = Math.max(before.mx, l0); }
    out[i] = Math.round(mr + (out[i] - mr) * (1 - FLAT));
    out[i + 1] = Math.round(mg + (out[i + 1] - mg) * (1 - FLAT));
    out[i + 2] = Math.round(mb + (out[i + 2] - mb) * (1 - FLAT));
    if (out[i + 3] >= 250) {
      const l1 = lum(out[i], out[i + 1], out[i + 2]);
      after.mn = Math.min(after.mn, l1); after.mx = Math.max(after.mx, l1);
    }
  }
  console.log(`${f.padEnd(12)} biên độ trong ô: ${Math.round(before.mx - before.mn)} → ${Math.round(after.mx - after.mn)}  (thân #${[mr, mg, mb].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")})`);
  if (!DRY) await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(p);
}
console.log(`\n${DRY ? "[DRY] " : ""}FLAT=${FLAT}. Nhớ nâng ?v= trong GameScene.load.image.`);
