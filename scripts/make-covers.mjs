// make-covers — ba tấm bìa CrazyGames từ poster splash.
//
// Quy cách của họ (docs.crazygames.com/requirements/game-covers):
//   ngang  1920×1080 (16:9) · dọc 800×1200 (2:3) · vuông 800×800 (1:1)
//   "ba tấm phải cùng phong cách để người xem nhận ra ngay là một game"
//
// Poster nguồn gần VUÔNG (1656×1600), nên:
//   • vuông  — gần như không phải cắt, đẹp nhất;
//   • dọc    — cắt hẹp hai bên, vẫn giữ đủ tên + slime + xe;
//   • ngang  — KHÔNG cắt, vì cắt xuống 16:9 là mất bánh xe. Thay vào đó đặt nguyên poster
//              giữa khung, hai bên lấp bằng chính poster phóng to + làm mờ. Đây là cách
//              phổ biến và trông có chủ đích, khác hẳn viền đen mà họ dặn tránh.
//
//   node scripts/make-covers.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "public/art/hopin2.jpg";
const OUT = "store/crazygames";

// Poster có viền giấy trắng lởm chởm quanh mép — cắt bỏ trước, nếu không nó lọt vào bìa.
const INSET = 34;

mkdirSync(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
const W = meta.width, H = meta.height;
const trimmed = await sharp(SRC)
  .extract({ left: INSET, top: INSET, width: W - INSET * 2, height: H - INSET * 2 })
  .toBuffer();
const tm = await sharp(trimmed).metadata();
console.log(`nguon ${W}x${H} -> da cat vien ${tm.width}x${tm.height}`);

// ---- vuông 800×800 --------------------------------------------------------
await sharp(trimmed)
  .resize(800, 800, { fit: "cover", position: "centre" })
  .jpeg({ quality: 92 })
  .toFile(`${OUT}/cover-square-800x800.jpg`);

// ---- dọc 800×1200 ---------------------------------------------------------
// Cắt một dải dọc giữa poster: tên game, slime và xe đều nằm trên trục giữa.
{
  const cropW = Math.round(tm.height * (2 / 3));
  await sharp(trimmed)
    .extract({ left: Math.round((tm.width - cropW) / 2), top: 0, width: cropW, height: tm.height })
    .resize(800, 1200, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92 })
    .toFile(`${OUT}/cover-portrait-800x1200.jpg`);
}

// ---- ngang 1920×1080 ------------------------------------------------------
// Nền = chính poster phủ kín khung rồi làm mờ mạnh; tiền cảnh = poster nguyên vẹn,
// cao bằng khung, đặt giữa. Không mất chi tiết nào của tranh.
{
  const fgH = 1080;
  const fgW = Math.round((tm.width / tm.height) * fgH);
  const bg = await sharp(trimmed)
    .resize(1920, 1080, { fit: "cover", position: "centre" })
    .blur(28)
    .modulate({ brightness: 0.82 }) // tối bớt để tấm chính nổi lên
    .toBuffer();
  const fg = await sharp(trimmed).resize(fgW, fgH, { fit: "cover" }).toBuffer();
  await sharp(bg)
    .composite([{ input: fg, left: Math.round((1920 - fgW) / 2), top: 0 }])
    .jpeg({ quality: 92 })
    .toFile(`${OUT}/cover-landscape-1920x1080.jpg`);
}

for (const f of ["cover-landscape-1920x1080", "cover-portrait-800x1200", "cover-square-800x800"]) {
  const m = await sharp(`${OUT}/${f}.jpg`).metadata();
  console.log(`${OUT}/${f}.jpg  ${m.width}x${m.height}`);
}
