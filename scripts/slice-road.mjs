import sharp from "sharp";

const SRC = "public/art/Notused/duongray2.png";
const OUT = "public/art";

// duongray2 is on a solid pure-magenta background (no checkerboard this time).
function isBg(r, g, b) {
  return r > 150 && b > 150 && g < Math.min(r, b) - 40;
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width,
  H = info.height;
for (let p = 0; p < W * H; p++) {
  const i = p * 4;
  if (isBg(data[i], data[i + 1], data[i + 2])) data[i + 3] = 0;
}
const CLEAN = `${OUT}/_road_clean.png`;
await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(CLEAN);

// Top-row pieces (bboxes found by component analysis).
const pieces = {
  "road-straight": { left: 43, top: 47, width: 520, height: 298 },
  "road-corner": { left: 610, top: 47, width: 352, height: 328 },
  "road-end": { left: 1009, top: 47, width: 357, height: 298 },
};
for (const [name, box] of Object.entries(pieces)) {
  await sharp(CLEAN).extract(box).png().toFile(`${OUT}/${name}.png`);
  console.log(name.padEnd(14), `${box.width}x${box.height}`);
}
console.log("done");
