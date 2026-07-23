import sharp from "sharp";

// Sheet of 8 new cars on a GREEN checkerboard "transparent" background (2 rows x 4).
// Reading order maps to color ids 11..18 (see palette).
const SRC = "public/art/Notused/xe 6.png";
const OUT = "public/art";
const IDS = [11, 12, 13, 14, 15, 16, 17, 18];

// The checker background greens are all BRIGHT (max channel > 110); every car is
// walled by a continuous DARK outline (max channel < 90). So flood from the border
// through bright pixels only — it fills the checker and stops dead at each car's
// outline, protecting the interior (works for the green AND the black car, which a
// colour-key can't: bright checker green overlaps the car's body green in every channel).
function isBg(r, g, b) {
  return Math.max(r, g, b) >= 100;
}

function clearBackgroundGlobal(data, w, h) {
  const seen = new Uint8Array(w * h);
  const st = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    st.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) {
    const p = st.pop();
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    if (!isBg(data[i], data[i + 1], data[i + 2])) continue;
    data[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

// 4-connected components of opaque pixels → bbox + centroid + area
function components(data, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  const st = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] !== -1 || data[s * 4 + 3] <= 12) continue;
    const id = comps.length;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    lab[s] = id; st.push(s);
    while (st.length) {
      const p = st.pop();
      const x = p % w, y = (p / w) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [p + 1, p - 1, p + w, p - w];
      const nx = [x + 1, x - 1, x, x];
      const ny = [y, y, y + 1, y - 1];
      for (let k = 0; k < 4; k++) {
        if (nx[k] < 0 || ny[k] < 0 || nx[k] >= w || ny[k] >= h) continue;
        const q = nb[k];
        if (lab[q] === -1 && data[q * 4 + 3] > 12) { lab[q] = id; st.push(q); }
      }
    }
    comps.push({
      area,
      box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    });
  }
  return comps;
}

// Defringe: iteratively erase green-dominant pixels that touch a transparent pixel.
// This eats the thin checker-green fringe / tread flecks from the edges inward. The
// forest-green CAR body never touches transparent (its dark outline sits between), so
// it is untouched; car tires are grey (not green-dominant), also safe.
function defringeGreen(data, w, h, iters) {
  const isGreen = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return g - Math.max(r, b) > 22;
  };
  for (let it = 0; it < iters; it++) {
    const kill = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      if (data[i + 3] === 0 || !isGreen(i)) continue;
      const nb = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
      let edge = false;
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { edge = true; break; }
        if (data[(ny * w + nx) * 4 + 3] === 0) { edge = true; break; }
      }
      if (edge) kill.push(i);
    }
    if (!kill.length) break;
    for (const i of kill) data[i + 3] = 0;
  }
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
clearBackgroundGlobal(data, W, H);
// enclosed BRIGHT checker specks (g > 170) — no car body is that bright a green
// (forest car maxes ~140), so this is safe even for the green car.
for (let p = 0; p < W * H; p++) {
  const i = p * 4;
  if (data[i + 3] && data[i + 1] > 170 && data[i + 1] - Math.max(data[i], data[i + 2]) > 50) data[i + 3] = 0;
}
defringeGreen(data, W, H, 5);
const clean = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

// keep the 8 largest blobs (the cars); drop sparkles / stray specks
let comps = components(data, W, H).filter((c) => c.area > 20000).sort((a, b) => b.area - a.area);
console.log("blobs kept:", comps.length, comps.map((c) => c.area).slice(0, 12));
comps = comps.slice(0, 8);

// reading order: split into 2 rows by cy, sort each row left→right
comps.sort((a, b) => a.cy - b.cy);
const ordered = [
  ...comps.slice(0, 4).sort((a, b) => a.cx - b.cx),
  ...comps.slice(4, 8).sort((a, b) => a.cx - b.cx),
];

for (let k = 0; k < ordered.length; k++) {
  const c = ordered[k];
  const name = `car-${IDS[k]}.png`;
  await sharp(clean).extract(c.box).png().toFile(`${OUT}/${name}`);
  console.log(name.padEnd(12), `${c.box.width}x${c.box.height}`, "area", c.area);
}
console.log("done → car-11 … car-18");
