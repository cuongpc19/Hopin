// Vẽ BÀN THẬT của một danh sách level ra ảnh ghép, để chọn bằng MẮT.
//   LV=286,284,... OUT=/tmp/sheet.png COLS=8 node scripts/_sheetC.mjs
//
// Vì sao cần: điểm "đẹp" trong _pretty.mjs chỉ đếm số màu, độ liền mảng và độ phủ — nó không
// biết bàn vẽ ra CÁI GÌ. Đã bốn lần nó chấm cao những bàn nhìn tận mắt là hỏng (8 tấm biển cấm
// giống hệt nhau, một bức tường gạch, một mặt quầy xám). Lọc bằng điểm, chốt bằng mắt.
import sharp from "sharp";
import fs from "node:fs";
import { readD, isC } from "./genlib.mjs";

const COL = ["#fe4038","#fe8f28","#fed734","#37cb5c","#2ac0cc","#408afa","#9756fd","#fd55a5","#ffffff",
  "#cbcbcb","#4a4a4a","#985828","#262630","#3050a0","#e0b888","#98d0f0","#208038","#f8c0c8","#902030"];
const d = readD();
const LV = (process.env.LV || "").split(",").map(Number).filter(Boolean);
const CELL = Number(process.env.CELL || 5);
const COLS = Number(process.env.COLS || 8);
const PAD = 10, LABEL = 14;

const tiles = [];
for (const n of LV) {
  const L = d[n];
  if (!L?.board) { console.log(`L${n}: khong co ban`); continue; }
  const W = L.cols, H = L.rows;
  const px = Buffer.alloc(W * CELL * H * CELL * 3, 0x22);
  const put = (x, y, hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) {
      const o = ((y * CELL + dy) * W * CELL + (x * CELL + dx)) * 3;
      px[o] = r; px[o + 1] = g; px[o + 2] = b;
    }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = L.board[y * W + x];
    if (isC(v)) put(x, y, COL[v] || "#888888");
    else if (v >= 90) put(x, y, "#5a5a5a");           // đá
  }
  tiles.push({ n, W, H, buf: await sharp(px, { raw: { width: W * CELL, height: H * CELL, channels: 3 } }).png().toBuffer() });
}

const TW = Math.max(...tiles.map((t) => t.W * CELL));
const TH = Math.max(...tiles.map((t) => t.H * CELL));
const rows = Math.ceil(tiles.length / COLS);
const sheetW = COLS * (TW + PAD), sheetH = rows * (TH + PAD + LABEL);
const comp = [];
for (let i = 0; i < tiles.length; i++) {
  const cx = (i % COLS) * (TW + PAD) + PAD / 2, cy = ((i / COLS) | 0) * (TH + PAD + LABEL) + PAD / 2;
  comp.push({ input: tiles[i].buf, left: Math.round(cx), top: Math.round(cy) });
  const lab = Buffer.from(`<svg width="${TW}" height="${LABEL}"><text x="2" y="11" font-size="11"
    font-family="monospace" fill="#ffffff">L${tiles[i].n} ${tiles[i].W}x${tiles[i].H}</text></svg>`);
  comp.push({ input: lab, left: Math.round(cx), top: Math.round(cy + TH + 1) });
}
await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: "#1a1a22" } })
  .composite(comp).png().toFile(process.env.OUT || "sheet.png");
console.log(`${tiles.length} ban -> ${process.env.OUT || "sheet.png"}`);
