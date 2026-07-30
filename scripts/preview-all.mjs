// preview-all.mjs — render TRẠNG THÁI CUỐI của các level (board + đá + vệt layer2 + "?" ẩn)
// ra PNG để QA bằng mắt. Khác preview của build-one: có TƯỜNG ĐÁ (đặt sau build) + chấm chôn.
//   node scripts/preview-all.mjs 1-25          → scripts/_level-preview/final-L<n>.png
//   node scripts/preview-all.mjs 131-152
import sharp from "sharp";
import fs from "fs";

const PAL = ["#fe4038", "#fe8f28", "#fed734", "#37cb5c", "#2ac0cc", "#408afa", "#9756fd", "#fd55a5", "#ffffff", "#cbcbcb", "#4a4a4a", "#985828", "#262630", "#3050a0", "#e0b888", "#98d0f0", "#208038", "#f8c0c8", "#902030"];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const MAT = hex("#17301c");
const ROCK = hex("#6a6a72");

const range = (process.argv[2] || "1-25").split("-").map(Number);
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
fs.mkdirSync("scripts/_level-preview", { recursive: true });

for (let lvl = range[0]; lvl <= (range[1] ?? range[0]); lvl++) {
  const L = d[lvl];
  if (!L) continue;
  const { cols, rows } = L;
  const S = Math.max(12, Math.round(760 / cols));
  const W = cols * S, H = rows * S;
  const buf = Buffer.alloc(W * H * 3);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const v = L.board[i];
    const [R, G, B] = v >= 90 ? ROCK : v >= 0 && v < PAL.length ? hex(PAL[v]) : MAT;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = ((r * S + y) * W + (c * S + x)) * 3;
      buf[px] = R; buf[px + 1] = G; buf[px + 2] = B;
    }
    // vệt layer2 (chấm đen giữa ô) + "?" ẩn (chấm trắng góc)
    const dot = (ox, oy, rgb, sz) => { for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) { const px = ((r * S + oy + y) * W + (c * S + ox + x)) * 3; buf[px] = rgb[0]; buf[px + 1] = rgb[1]; buf[px + 2] = rgb[2]; } };
    if (L.layer2 && L.layer2[i] >= 0) dot(Math.floor(S / 2) - 2, Math.floor(S / 2) - 2, [10, 10, 10], 4);
    if (L.hidden && L.hidden[i] >= 0) dot(2, 2, [255, 255, 255], 3);
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`scripts/_level-preview/final-L${lvl}.png`);
  console.log(`final-L${lvl}.png`);
}
