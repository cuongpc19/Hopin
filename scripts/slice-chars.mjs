// Slice the 5x2 character grid (public/art/level art/1/1.png) into 10 clean cutouts,
// named "<realColors>_<name>.png" so levels can be sorted by colour count.
import sharp from "sharp";
import fs from "fs";
const SRC = "public/art/level art/1/1.png";
const OUTDIR = "public/art/level art/1";
// name + real-colour count (≥5% coverage, from the palette analysis)
const CHARS = [
  { name: "cat", k: 7 }, { name: "robot", k: 7 }, { name: "frog", k: 3 },
  { name: "bear", k: 7 }, { name: "bunny", k: 8 }, { name: "owl", k: 7 },
  { name: "fish", k: 5 }, { name: "dino", k: 7 }, { name: "bee", k: 6 },
  { name: "penguin", k: 3 },
];
const COLS = 5, ROWS = 2;
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const IW = info.width, IH = info.height, cw = Math.floor(IW / COLS), ch = Math.floor(IH / ROWS);
const isWhite = (r, g, b) => r > 225 && g > 225 && b > 225;
for (let idx = 0; idx < 10; idx++) {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const insetX = Math.round(cw * 0.05), insetTop = Math.round(ch * 0.04);
  const insetBot = row === ROWS - 1 ? Math.round(ch * 0.2) : Math.round(ch * 0.04); // drop bottom-row labels
  const cx = col * cw + insetX, cy = row * ch + insetTop;
  const w = cw - 2 * insetX, h = ch - insetTop - insetBot;
  // extract cell → RGBA buffer, key white to transparent
  const cell = Buffer.from(await sharp(data, { raw: { width: IW, height: IH, channels: 4 } })
    .extract({ left: cx, top: cy, width: w, height: h }).raw().toBuffer());
  let minX = w, minY = h, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (cell[i + 3] < 128 || isWhite(cell[i], cell[i + 1], cell[i + 2])) { cell[i + 3] = 0; continue; }
    any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!any) { console.log(CHARS[idx].name, "empty?"); continue; }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const file = `${OUTDIR}/${CHARS[idx].k}_${CHARS[idx].name}.png`;
  await sharp(cell, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize({ width: 256, height: 256, fit: "inside" }).png().toFile(file);
  console.log(`${CHARS[idx].k}_${CHARS[idx].name}.png  (${bw}x${bh})`);
}
console.log("done → " + OUTDIR);
