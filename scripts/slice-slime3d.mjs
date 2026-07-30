// Slice the slime3D.png 3x3 sheet into 9 transparent slime-<colorId>.png for the game.
// Flood-fills the WHITE background from the cell edges (keeps interior white highlights),
// then trims. Maps grid position → game palette colour id.
import sharp from "sharp";
import fs from "fs";
import path from "path";

const SRC = "C:/CuongPC/Game/Pixel Flow/public/art/slime3D.png";
const OUTDIR = "public/art";
const COLS = 3, ROWS = 3;
// grid order (row-major) → game colour id
const MAP = [0, 1, 2, /*red,orange,yellow*/ 3, 5, 6, /*green,blue,purple*/ 7, 8, 11 /*pink,white,brown*/];
const TOL = 30;      // bg = within this of the corner colour (pure white)
const INSET = 0.04;  // trim a margin off each cell so neighbours don't bleed in

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const IW = info.width, IH = info.height, CH = info.channels;
const cw = Math.floor(IW / COLS), ch = Math.floor(IH / ROWS);

function removeBg(px, w, h) {
  const N = w * h;
  const mask = new Uint8Array(N); // 1 = background
  const bg = [px[0], px[1], px[2]]; // top-left corner = white bg
  const near = (i) => {
    const p = i * 4;
    const dr = px[p] - bg[0], dg = px[p + 1] - bg[1], db = px[p + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= TOL * TOL;
  };
  const q = [];
  const seed = (i) => { if (!mask[i] && near(i)) { mask[i] = 1; q.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (q.length) {
    const i = q.pop(), x = i % w, y = (i / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!mask[ni] && near(ni)) { mask[ni] = 1; q.push(ni); }
    }
  }
  for (let i = 0; i < N; i++) if (mask[i]) px[i * 4 + 3] = 0; // background → transparent
}

for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const id = MAP[r * COLS + c];
  const x0 = Math.round(c * cw + cw * INSET), y0 = Math.round(r * ch + ch * INSET);
  const w = Math.round(cw * (1 - 2 * INSET)), h = Math.round(ch * (1 - 2 * INSET));
  // extract this cell into its own RGBA buffer
  const cell = Buffer.alloc(w * h * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const si = ((y0 + yy) * IW + (x0 + xx)) * CH;
    const di = (yy * w + xx) * 4;
    cell[di] = data[si]; cell[di + 1] = data[si + 1]; cell[di + 2] = data[si + 2];
    cell[di + 3] = CH === 4 ? data[si + 3] : 255;
  }
  removeBg(cell, w, h);
  const out = path.join(OUTDIR, `slime-${id}.png`);
  await sharp(cell, { raw: { width: w, height: h, channels: 4 } }).trim().png().toFile(out);
  console.log(`slime-${id}.png  (grid ${r},${c})`);
}
console.log("done");
