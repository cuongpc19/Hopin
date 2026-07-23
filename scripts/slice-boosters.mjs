import sharp from "sharp";

const DIR = "public/art/Notused/booster";
const OUT = "public/art";

// Solid magenta background key.
function isBg(r, g, b) {
  return r > 150 && b > 150 && g < Math.min(r, b) - 40;
}

const MAP = {
  "Gemini_Generated_Image_byb0vgbyb0vgbyb0.png": "booster-add",
  "Gemini_Generated_Image_aedj3aedj3aedj3a.png": "booster-hand",
  "Gemini_Generated_Image_9gjsd29gjsd29gjs.png": "booster-refresh",
  "Gemini_Generated_Image_rp93qtrp93qtrp93.png": "booster-magnet",
};

for (const [src, name] of Object.entries(MAP)) {
  const { data, info } = await sharp(`${DIR}/${src}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width,
    H = info.height;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (isBg(data[i], data[i + 1], data[i + 2])) data[i + 3] = 0;
  }
  // tight bbox of what remains
  let minX = W,
    minY = H,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toFile(`${OUT}/${name}.png`);
  console.log(name.padEnd(16), `${maxX - minX + 1}x${maxY - minY + 1}`);
}
console.log("done");
