// Vẽ các level ứng viên ra MỘT TẤM ẢNH để nhìn bằng mắt — điểm số không nói được tranh nào dễ thương.
//   node scripts/_sheet11.mjs      → scripts/_cand11.png
import sharp from "sharp";
import fs from "node:fs";
import { readD } from "./genlib.mjs";

const COL = ["#fe4038", "#fe8f28", "#fed734", "#37cb5c", "#2ac0cc", "#408afa", "#9756fd", "#fd55a5", "#ffffff",
  "#cbcbcb", "#4a4a4a", "#985828", "#262630", "#3050a0", "#e0b888", "#98d0f0", "#208038", "#f8c0c8", "#902030"];
const d = readD();

// ứng viên: sau L30, không chia hết 5, ít xe, KHÔNG có xe vụn (xe nhỏ nhất ≥ 20 slime)
const cand = [];
for (const k of Object.keys(d).map(Number).sort((a, b) => a - b)) {
  if (k <= 30 || k % 5 === 0) continue;
  const L = d[k];
  if (L.chests.length > 9 || L.cols > 31) continue;
  const min = Math.min(...L.chests.map((c) => c.count));
  if (min < 20) continue;
  const cnt = {}; for (const v of L.board) if (v >= 0 && v < 90) cnt[v] = (cnt[v] || 0) + 1;
  if (Object.keys(cnt).length < 4) continue;      // 2-3 màu nhìn trống
  cand.push({ n: k, L, cols: Object.keys(cnt).length });
}
console.log(`${cand.length} ung vien:`, cand.map((c) => "L" + c.n).join(" "));

const C = 8, BOARD = 150, LB = 20, CW = BOARD + 10, CH = BOARD + LB;
const R = Math.ceil(cand.length / C), W = C * CW, H = R * CH + 8;
const parts = [];
for (let i = 0; i < cand.length; i++) {
  const { n, L, cols } = cand[i];
  const x0 = (i % C) * CW + 5, y0 = Math.floor(i / C) * CH + 4;
  const px = Math.max(1, Math.floor(BOARD / L.cols));
  const sz = px * L.cols, off = Math.floor((BOARD - sz) / 2);
  const rects = [];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    const v = L.board[r * L.cols + c];
    if (v < 0) continue;
    const fill = v >= 90 ? "#3a3a44" : COL[v] || "#888";
    rects.push(`<rect x="${c * px}" y="${r * px}" width="${px}" height="${px}" fill="${fill}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}">${rects.join("")}</svg>`;
  parts.push({ input: Buffer.from(svg), left: x0 + off, top: y0 + off });
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD}" height="${LB}">
    <text x="2" y="14" font-family="Arial" font-size="12" fill="#fff">L${n} · ${L.chests.length} xe · ${cols} màu</text></svg>`;
  parts.push({ input: Buffer.from(label), left: x0, top: y0 + BOARD });
}
await sharp({ create: { width: W, height: H, channels: 3, background: "#2b2f4a" } })
  .composite(parts).png().toFile("scripts/_cand11.png");
console.log("da ve scripts/_cand11.png", W + "x" + H);
