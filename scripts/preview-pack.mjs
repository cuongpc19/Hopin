// preview-pack — vẽ NHIỀU level trong designed.json ra một PNG lưới, để MẮT NGƯỜI duyệt tranh
// sau mỗi lần dựng lại. Màu lấy từ src/game/palette.ts (COLORS), ô trống = màu mặt bàn navy.
//
//   node scripts/preview-pack.mjs 2-25            → scripts/_pack.png
//   OUT=scripts/_a.png node scripts/preview-pack.mjs 26-46
import fs from "node:fs";
import { readD, isC } from "./genlib.mjs";

const PAL = fs.readFileSync("src/game/palette.ts", "utf8")
  .split("export const COLORS: number[] = [")[1].split("];")[0]
  .split("\n").map((l) => (l.match(/0x[0-9a-f]{6}/i) || [])[0]).filter(Boolean).map((h) => parseInt(h, 16));

const S = Number(process.env.CELL || 4);
const GAP = 10, PER_ROW = Number(process.env.PER_ROW || 6);
const spec = process.argv[2] || "2-46";
const nums = spec.includes("-")
  ? (() => { const [a, b] = spec.split("-").map(Number); const r = []; for (let i = a; i <= b; i++) r.push(i); return r; })()
  : spec.split(",").map(Number);

const d = readD();
const live = nums.filter((n) => d[n]);
const cw = Math.max(...live.map((n) => d[n].cols)), ch = Math.max(...live.map((n) => d[n].rows));
const rowsN = Math.ceil(live.length / PER_ROW);
const W = PER_ROW * (cw * S) + (PER_ROW - 1) * GAP;
const H = rowsN * (ch * S) + (rowsN - 1) * GAP;
const px = Buffer.alloc(W * H * 3, 0x10);

live.forEach((n, k) => {
  const L = d[n];
  const ox = (k % PER_ROW) * (cw * S + GAP), oy = Math.floor(k / PER_ROW) * (ch * S + GAP);
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    const v = L.board[r * L.cols + c];
    const col = isC(v) ? (PAL[v] ?? 0xff00ff) : (v >= 90 ? 0x6b6b7a : 0x2b2f4a);
    const R = (col >> 16) & 255, G = (col >> 8) & 255, B = col & 255;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const p = ((oy + r * S + y) * W + (ox + c * S + x)) * 3;
      if (p + 2 < px.length) { px[p] = R; px[p + 1] = G; px[p + 2] = B; }
    }
  }
});

const out = process.env.OUT || "scripts/_pack.png";
const sharp = (await import("sharp")).default;
await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log(`L${live[0]}…L${live[live.length - 1]} (${live.length} level) -> ${out}  ${W}x${H}`);
