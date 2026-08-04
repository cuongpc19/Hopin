// soften-tile-outline.mjs — bỏ VIỀN ĐEN nướng trong ảnh ô (public/art/slime/tile-*.png).
//
// Vấn đề (user 2026-08-03, thấy rõ nhất trên ô BE id 14): mỗi keycap có một vòng pixel ĐEN
// TUYỀN (rgb ~0) bán trong suốt (alpha ~50-110) chạy quanh mép. Hai ô kề nhau → hai viền
// chồng cạnh → một vạch tối ở GIỮA cạnh chung, nhạt dần ở góc bo → đọc ra như "dấu gạch đen".
// Đo trên bản render thật: nền ô be luminance ~187, chỗ ron tụt còn ~125.
// (Khác với BÓNG ĐỔ đã bóc ở strip-tile-shadow.mjs: bóng nằm NGOÀI hình keycap, viền này nằm
// TRÊN mép hình, nên mask "trong/ngoài" của script kia không đụng tới.)
//
// Cách sửa: pixel viền = alpha < 250 VÀ max(r,g,b) < 40. Hai điều kiện, không phải một:
//   • chỉ lọc màu thì ăn nhầm thân ô tối (tile-12 navy #262630 → max 48, tile-10 → 74);
//   • chỉ lọc alpha thì ăn cả mép khử răng cưa màu bình thường.
// Pixel viền được đổi sang MÀU THÂN × FACTOR (giữ nguyên alpha) → mép vẫn có độ sâu, vẫn tách
// được ô kề nhau, nhưng là một vạch cùng tông chứ không phải vạch đen.
//
// Chạy:  node scripts/soften-tile-outline.mjs           (ghi đè tại chỗ)
//        DRY=1 node scripts/soften-tile-outline.mjs      (chỉ đo)
//        FACTOR=0.72 …                                   (0 = đen như cũ, 1 = mất hẳn viền)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = "public/art/slime";
const FACTOR = Number(process.env.FACTOR || 0.72);
const DRY = process.env.DRY === "1";

const files = fs.readdirSync(DIR).filter((f) => /^tile-\d+\.png$/.test(f)).sort();
if (!files.length) throw new Error(`không thấy tile-*.png trong ${DIR}`);

for (const f of files) {
  const p = path.join(DIR, f);
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const { width: W, height: H } = info;
  // màu thân = pixel đặc hay gặp nhất (không lấy pixel giữa: có vệt gloss)
  const tally = new Map();
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] !== 255) continue;
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  let body = 0, bn = -1;
  for (const [k, n] of tally) if (n > bn) { bn = n; body = k; }
  const br = (body >> 16) & 0xff, bg = (body >> 8) & 0xff, bb = body & 0xff;
  const nr = Math.round(br * FACTOR), ng = Math.round(bg * FACTOR), nb = Math.round(bb * FACTOR);

  let touched = 0, maxAlpha = 0;
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0 || a >= 250) continue; // thân ô đặc: không đụng
    if (Math.max(out[i], out[i + 1], out[i + 2]) >= 40) continue; // không phải viền đen
    out[i] = nr; out[i + 1] = ng; out[i + 2] = nb;
    touched++; if (a > maxAlpha) maxAlpha = a;
  }
  console.log(`${f.padEnd(12)} viền ${String(touched).padStart(4)} px · thân #${body.toString(16).padStart(6, "0")} → viền #${((nr << 16) | (ng << 8) | nb).toString(16).padStart(6, "0")} · alpha viền tối đa ${maxAlpha}`);
  if (!DRY) await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(p);
}
console.log(`\n${DRY ? "[DRY] " : ""}${files.length} file · FACTOR=${FACTOR}. Nhớ nâng ?v= trong GameScene.load.image.`);
