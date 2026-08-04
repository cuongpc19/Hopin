// Re-anchor the keycap board tiles to the game palette.
//
// WHY: the tile art (public/art/slime/tile-<id>.png) was drawn independently of
// src/game/palette.ts, so every tile sits BELOW its palette colour in saturation —
// measured on tile-5, even the most saturated pixel in the cap (0.652) never reaches
// the palette's 0.744. The baked top-lit gloss then pulls the bright band down to 0.44.
// On the dark navy mat that reads as "màu ô không rõ".
//
// HOW: per tile, convert the opaque cap to HSV, take the MEDIAN hue-carrying pixel as
// the tile's representative colour, and scale S and V so that median lands exactly on
// the palette entry. Hue is snapped to the palette hue. Relative shading is preserved
// (every pixel keeps its ratio to the median), so the gloss and the bevel survive —
// only the colour anchor moves.
//
// Greys (palette saturation ~0) skip the hue/sat step and only get the value anchor.
//
// Writes candidates to scripts/_tiles-resat/ and a before/after preview; it does NOT
// touch the live art. Run with APPLY=1 to copy the candidates over public/art/slime/
// (originals are backed up to art-orig/slime/ first — revert with
//   cp art-orig/slime/* public/art/slime/ ).
//
// ⚠ ĐỪNG thay cách này bằng "keycap xám + setTint" (2026-08-04, đã thử và loại). Tint là
// phép NHÂN nên không pixel nào sáng hơn được màu palette — mà highlight 2.5D theo định
// nghĩa là chỗ sáng hơn màu khối. Kết quả: ô bẹt hoàn toàn, mất 55% chênh lệch sáng-tối
// của art. Không mốc chuẩn hoá nào cứu được, đây là giới hạn cứng. Cách nhân-theo-tỉ-lệ
// dưới đây giữ được 53/55%.
import sharp from "sharp";
import fs from "fs";
import path from "path";

const PALETTE = [
  0xfe4038, 0xfe8f28, 0xfed734, 0x37cb5c, 0x2ac0cc, 0x408afa, 0x9756fd, 0xfd55a5,
  0xffffff, 0xcbcbcb, 0x4a4a4a, 0x985828, 0x262630, 0x3050a0, 0xe0b888, 0x98d0f0,
  0x208038, 0xf8c0c8, 0x902030,
];

const SRC = "public/art/slime";
const OUT = "scripts/_tiles-resat";
const BOARD_BG = { r: 0x2b, g: 0x2f, b: 0x4a }; // the dark navy mat

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round(Math.min(255, Math.max(0, (r + m) * 255))),
    Math.round(Math.min(255, Math.max(0, (g + m) * 255))),
    Math.round(Math.min(255, Math.max(0, (b + m) * 255))),
  ];
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

fs.mkdirSync(OUT, { recursive: true });

const report = [];

for (let id = 0; id < PALETTE.length; id++) {
  const file = path.join(SRC, `tile-${id}.png`);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;

  const pal = PALETTE[id];
  const [pH, pS, pV] = rgb2hsv((pal >> 16) & 255, (pal >> 8) & 255, pal & 255);

  // Sample the fully-opaque cap only — the drop shadow and the AA fringe would drag
  // the median toward black and make every tile over-brighten.
  const sats = [], vals = [];
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4 + 3] < 250) continue;
    const [, s, v] = rgb2hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    sats.push(s); vals.push(v);
  }
  const mS = median(sats), mV = median(vals);
  const xS = Math.max(...sats), xV = Math.max(...vals);
  // Anchor the median on the palette — but NEVER hard enough to clip the brightest pixel.
  // Without the cap, a palette colour near the ceiling (white, V=1.0) forces the whole
  // upper half of the cap to clamp at 255: the body goes flat and only the dark bevel
  // survives, which reads as a hard rim on a blank slab (user 2026-08-04, ô trắng "lởm
  // chởm"). Clipping destroys exactly the 2.5D shading this whole approach exists to keep.
  // So the peak lands at most ON the ceiling, and the median settles wherever that allows.
  const rS = mS > 0.02 ? Math.min(pS / mS, xS > 0 ? 1 / xS : 1) : 0;
  const rV = mV > 0.02 ? Math.min(pV / mV, 1 / xV) : 1;

  const out = Buffer.from(data);
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) continue;
    const [, s, v] = rgb2hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const nS = Math.min(1, s * rS);
    const nV = Math.min(1, v * rV);
    const [r, g, b] = hsv2rgb(pH, nS, nV);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b;
  }

  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(path.join(OUT, `tile-${id}.png`));

  report.push(
    `${String(id).padStart(2)}  medS ${mS.toFixed(3)} → ${pS.toFixed(3)}   medV ${mV.toFixed(3)} → ${pV.toFixed(3)}`,
  );
}

console.log("anchor per tile (median of the opaque cap → palette):");
console.log(report.join("\n"));

// ---------------------------------------------------------------- preview
// Render one designed level's mosaic twice — current art vs candidates — on the navy
// mat, so the comparison is the thing that actually matters: a picture, not swatches.
const LEVEL = process.env.LEVEL || "22";
const designed = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const lv = designed[LEVEL];
if (!lv) { console.log(`no designed level ${LEVEL} — skipping mosaic preview`); process.exit(0); }

const CELL = 22;
const { cols, rows, board } = lv;

async function renderBoard(dir) {
  const tiles = {};
  for (let id = 0; id < PALETTE.length; id++) {
    tiles[id] = await sharp(path.join(dir, `tile-${id}.png`))
      .resize(Math.round(CELL * 1.3), Math.round(CELL * 1.3)) // matches makeKey's ×1.3
      .toBuffer();
  }
  const layers = [];
  const off = Math.round((CELL * 1.3 - CELL) / 2);
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (typeof v !== "number" || v < 0 || v >= PALETTE.length) continue;
    const r = Math.floor(i / cols), c = i % cols;
    layers.push({ input: tiles[v], left: c * CELL - off, top: r * CELL - off });
  }
  return sharp({
    create: { width: cols * CELL, height: rows * CELL, channels: 4, background: { ...BOARD_BG, alpha: 1 } },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

const GAP = 24;
const before = await renderBoard(SRC);
const after = await renderBoard(OUT);
const bw = cols * CELL, bh = rows * CELL;

await sharp({
  create: { width: bw * 2 + GAP * 3, height: bh + GAP * 2, channels: 4, background: { r: 18, g: 18, b: 24, alpha: 1 } },
})
  .composite([
    { input: before, left: GAP, top: GAP },
    { input: after, left: GAP * 2 + bw, top: GAP },
  ])
  .png()
  .toFile("scripts/_tile-preview.png");

console.log(`\npreview → scripts/_tile-preview.png   (level ${LEVEL}: left = now, right = re-anchored)`);

if (process.env.APPLY === "1") {
  // Backup lives OUTSIDE public/ — vite copies all of public/ into the build, so a
  // backup folder in there would ship 19 duplicate PNGs inside the APK.
  const bak = "art-orig/slime";
  fs.mkdirSync(bak, { recursive: true });
  for (let id = 0; id < PALETTE.length; id++) {
    const live = path.join(SRC, `tile-${id}.png`);
    const keep = path.join(bak, `tile-${id}.png`);
    if (!fs.existsSync(keep)) fs.copyFileSync(live, keep);
    fs.copyFileSync(path.join(OUT, `tile-${id}.png`), live);
  }
  console.log(`APPLIED to ${SRC} (originals kept in ${bak})`);
}
