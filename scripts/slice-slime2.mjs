import sharp from "sharp";

// Sheet of 8 new slimes on a GREEN checkerboard background (2 rows × 4).
// Reading order maps to colour ids 11..18. The slimes have SOFT (not dark) outlines
// and one of them is green like the bg, so we remove the background by COLOUR MATCH
// (border-connected pixels close to the corner green), not by brightness.
const SRC = "public/art/Notused/slime2.png";
const OUT = "public/art";
const IDS = [11, 12, 13, 14, 15, 16, 17, 18];
const TOL2 = 56 * 56; // rgb distance from the bg green that still counts as background

function clearBackground(data, w, h) {
  // background colour = average of the 4 corners
  const cs = [0, (w - 1) * 4, (h - 1) * w * 4, (w * h - 1) * 4];
  const bg = [0, 0, 0];
  for (const c of cs) { bg[0] += data[c]; bg[1] += data[c + 1]; bg[2] += data[c + 2]; }
  bg[0] /= 4; bg[1] /= 4; bg[2] /= 4;
  const near = (i) => {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db < TOL2;
  };
  const seen = new Uint8Array(w * h), st = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1; st.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) {
    const p = st.pop(), i = p * 4;
    if (data[i + 3] === 0 || !near(i)) continue; // stop at anything off the bg colour
    data[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

function components(data, w, h) {
  const lab = new Int32Array(w * h).fill(-1), comps = [], st = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] !== -1 || data[s * 4 + 3] <= 12) continue;
    const id = comps.length;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    lab[s] = id; st.push(s);
    while (st.length) {
      const p = st.pop(), x = p % w, y = (p / w) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [p + 1, p - 1, p + w, p - w], nx = [x + 1, x - 1, x, x], ny = [y, y, y + 1, y - 1];
      for (let k = 0; k < 4; k++) {
        if (nx[k] < 0 || ny[k] < 0 || nx[k] >= w || ny[k] >= h) continue;
        const q = nb[k];
        if (lab[q] === -1 && data[q * 4 + 3] > 12) { lab[q] = id; st.push(q); }
      }
    }
    comps.push({ area, box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
  }
  return comps;
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
clearBackground(data, W, H);
const clean = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

let comps = components(data, W, H).filter((c) => c.area > 20000).sort((a, b) => b.area - a.area);
console.log("blobs kept:", comps.length, comps.map((c) => c.area).slice(0, 12));
comps = comps.slice(0, 8);
comps.sort((a, b) => a.cy - b.cy);
const ordered = [
  ...comps.slice(0, 4).sort((a, b) => a.cx - b.cx),
  ...comps.slice(4, 8).sort((a, b) => a.cx - b.cx),
];

for (let k = 0; k < ordered.length; k++) {
  const c = ordered[k], name = `slime-${IDS[k]}.png`;
  await sharp(clean).extract(c.box).png().toFile(`${OUT}/${name}`);
  console.log(name.padEnd(13), `${c.box.width}x${c.box.height}`, "area", c.area);
}
console.log("done → slime-11 … slime-18");
