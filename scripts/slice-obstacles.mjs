import sharp from "sharp";

// Key the solid-magenta background out of the obstacle / special-car art and trim
// tight to the object. Reads the raw magenta originals from Notused/obstacle-src and
// writes clean transparent PNGs to public/art (same names the game loads).
const SRC = "public/art/Notused/obstacle-src";
const OUT = "public/art";
const NAMES = ["rock-hard", "rock-soft", "rock-soft-cracked", "wood", "car-hammer", "car-wood"];

// A pixel is background if it's clearly magenta (high R+B, low G).
function isBg(r, g, b) {
  return r > 150 && b > 150 && g < Math.min(r, b) - 45;
}

for (const name of NAMES) {
  const { data, info } = await sharp(`${SRC}/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width,
    H = info.height;
  // Key out magenta; also soften a 1px magenta fringe by knocking down alpha on
  // pixels that are still magenta-ish but not pure background.
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (isBg(r, g, b)) {
      data[i + 3] = 0;
    } else if (r > 130 && b > 130 && g < Math.min(r, b) - 20) {
      data[i + 3] = Math.min(data[i + 3], 90); // fringe → semi-transparent
    }
  }
  // Tight bounding box of what remains.
  let minX = W,
    minY = H,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const w = maxX - minX + 1,
    h = maxY - minY + 1;
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: w, height: h })
    .resize({ width: 256, height: 256, fit: "inside" }) // down to game-friendly size
    .png()
    .toFile(`${OUT}/${name}.png`);
  console.log(`${name.padEnd(20)} ${W}x${H} → ${w}x${h} → ≤256`);
}
console.log("done");
