import sharp from "sharp";

const SRC = "public/art/Notused/art1.png";
const OUT = "public/art";

function isBg(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx - mn < 28 && mx > 185;
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
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (st.length) {
    const p = st.pop();
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    if (!isBg(data[i], data[i + 1], data[i + 2])) continue;
    data[i + 3] = 0;
    const x = p % w,
      y = (p / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

// Label 4-connected components of opaque pixels; return bbox + avg body color.
function components(data, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  const st = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] !== -1 || data[s * 4 + 3] <= 12) continue;
    const id = comps.length;
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0,
      area = 0;
    let sr = 0,
      sg = 0,
      sb = 0,
      sn = 0;
    lab[s] = id;
    st.push(s);
    while (st.length) {
      const p = st.pop();
      const i = p * 4;
      const x = p % w,
        y = (p / w) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45) {
        sr += r;
        sg += g;
        sb += b;
        sn++;
      }
      const nb = [p + 1, p - 1, p + w, p - w];
      const nx = [x + 1, x - 1, x, x];
      const ny = [y, y, y + 1, y - 1];
      for (let k = 0; k < 4; k++) {
        if (nx[k] < 0 || ny[k] < 0 || nx[k] >= w || ny[k] >= h) continue;
        const q = nb[k];
        if (lab[q] === -1 && data[q * 4 + 3] > 12) {
          lab[q] = id;
          st.push(q);
        }
      }
    }
    const n = sn || 1;
    comps.push({
      id,
      area,
      box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      color: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    });
  }
  return comps;
}

const PALETTE = [0xa855f7, 0xff4fa3, 0xff5a4d, 0xffab2e, 0x3d97ff, 0x2ec96b];
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// Greedy: assign the 6 palette colors to the best-matching components.
function assignByColor(list, prefix, clean) {
  const pairs = [];
  list.forEach((c, ci) => PALETTE.forEach((h, pi) => pairs.push([dist2(c.color, rgb(h)), ci, pi])));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedC = new Set(),
    usedP = new Set(),
    out = {};
  for (const [, ci, pi] of pairs) {
    if (usedC.has(ci) || usedP.has(pi)) continue;
    usedC.add(ci);
    usedP.add(pi);
    out[pi] = list[ci];
  }
  return Promise.all(
    Object.entries(out).map(async ([pi, c]) => {
      await sharp(clean).extract(c.box).png().toFile(`${OUT}/${prefix}-${pi}.png`);
      console.log(`${prefix}-${pi}`.padEnd(14), `${c.box.width}x${c.box.height}`, "rgb", c.color);
    }),
  );
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width,
  H = info.height;
clearBackgroundGlobal(data, W, H);
const CLEAN = `${OUT}/_clean.png`;
await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(CLEAN);

const comps = components(data, W, H).filter((c) => c.area > 3000);
comps.sort((a, b) => b.area - a.area);

// Forest = the biggest blob (opaque rectangle).
const forest = comps[0];
await sharp(CLEAN).extract(forest.box).png().toFile(`${OUT}/theme-forest.png`);
console.log("theme-forest".padEnd(14), `${forest.box.width}x${forest.box.height}`);

const rest = comps.slice(1);
const slimes = rest.filter((c) => c.cy < 690);
const cars = rest.filter((c) => c.cy >= 690);
console.log("slime blobs:", slimes.length, " car blobs:", cars.length);

await assignByColor(slimes, "slime", CLEAN);
await assignByColor(cars, "car", CLEAN);
console.log("done");
