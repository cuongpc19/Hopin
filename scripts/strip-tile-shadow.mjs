// strip-tile-shadow.mjs — bóc BÓNG ĐỔ nướng sẵn khỏi ảnh ô bàn cờ (public/art/slime/tile-*.png).
//
// Vấn đề (user 2026-08-03): mỗi ô trên bàn có một nêm xám ở góc DƯỚI-PHẢI. Không phải marker
// cơ chế nào cả — ảnh keycap có drop-shadow đen dán vào cạnh phải + cạnh dưới (alpha ~4 giữa
// cạnh, ~66 sát góc; cạnh trái/trên alpha 0). GameScene vẽ ô to hơn ô lưới 30% nên ô vẽ sau
// che gần hết vệt bóng — TRỪ khe hình thoi chỗ 4 góc bo tròn gặp nhau, bóng lọt qua đó.
//
// Cách bóc — theo HÌNH, không theo MÀU. (Lọc "pixel tối thì xoá" là SAI: tile-12 là ô navy
// #262630, tile-10 cũng tối → lọc màu ăn mất 7484 px thân ô 12. Đã thử, đừng làm lại.)
//   1. mask = pixel ĐẶC (alpha >= 250) = thân keycap, đúng cho cả ô sáng lẫn ô tối;
//   2. nở mask ra DILATE px để giữ nguyên viền khử răng cưa;
//   3. mọi pixel NGOÀI mask đã nở → alpha = 0. Bóng nằm hẳn ngoài hình keycap nên bay sạch.
// In số pixel thân trước/sau để chắc chắn không ăn vào thân ô.
//
// Chạy:  node scripts/strip-tile-shadow.mjs          (ghi đè tại chỗ)
//        DRY=1 node scripts/strip-tile-shadow.mjs     (chỉ đo, không ghi)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = "public/art/slime";
const DILATE = Number(process.env.DILATE || 2);
const DRY = process.env.DRY === "1";

const files = fs.readdirSync(DIR).filter((f) => /^tile-\d+\.png$/.test(f)).sort();
if (!files.length) throw new Error(`không thấy tile-*.png trong ${DIR}`);

let totalKilled = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const { width: W, height: H } = info;
  let solid = new Uint8Array(W * H);
  let bodyBefore = 0;
  for (let p = 0; p < W * H; p++) if (out[p * 4 + 3] >= 250) { solid[p] = 1; bodyBefore++; }
  for (let d = 0; d < DILATE; d++) {
    const next = new Uint8Array(solid);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (solid[y * W + x]) continue;
      if ((x > 0 && solid[y * W + x - 1]) || (x < W - 1 && solid[y * W + x + 1]) ||
          (y > 0 && solid[(y - 1) * W + x]) || (y < H - 1 && solid[(y + 1) * W + x])) next[y * W + x] = 1;
    }
    solid = next;
  }
  let killed = 0, bodyAfter = 0;
  for (let p = 0; p < W * H; p++) {
    if (!solid[p] && out[p * 4 + 3] !== 0) { out[p * 4 + 3] = 0; killed++; }
    if (out[p * 4 + 3] >= 250) bodyAfter++;
  }
  totalKilled += killed;
  const warn = bodyAfter < bodyBefore ? `  ⚠ THÂN Ô MẤT ${bodyBefore - bodyAfter} px` : "";
  console.log(`${f.padEnd(12)} xoá ${String(killed).padStart(5)} px bóng · thân ${bodyBefore} → ${bodyAfter}${warn}`);
  if (!DRY) await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(p);
}
console.log(`\n${DRY ? "[DRY] " : ""}${files.length} file · tổng ${totalKilled} px bóng.`);
if (!DRY) console.log("Nhớ nâng cache-buster ?v= trong GameScene.load.image('tile-…') nếu chưa.");
