// Re-apply every hand-made tweak to the generated android/ folder, so that folder can
// stay OUT of git and still be rebuilt exactly: `npx cap add android` regenerates a
// stock project, then this script turns it back into ours.
//
// 1. LAUNCHER ICONS from the game's own art. Source = public/art/slime3D.png, a 3x3
//    sheet of glossy slime cubes on white; we take one cube, knock the white background
//    out to transparency and drop it on the dark navy board colour so the icon glows on
//    any home screen. Per density bucket it writes:
//      ic_launcher.png            legacy square icon (rounded corners)
//      ic_launcher_round.png      legacy circular icon
//      ic_launcher_foreground.png adaptive-icon foreground (transparent, safe-zone sized)
//    plus drawable/ic_launcher_background.xml (the adaptive background gradient).
// 2. PORTRAIT LOCK in AndroidManifest.xml — the game is designed portrait-only.
//
// Run: node scripts/setup-android.mjs     (then rebuild the APK — see FEATURES.txt §26)
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = root + "public/art/slime3D.png";
const RES = root + "android/app/src/main/res/";

// Which cube on the 3x3 sheet to use: row 1, col 1 (0-based) = the cyan one.
const CELL_ROW = 1;
const CELL_COL = 1;

// Board navy, lightened at the top so the square reads as a lit surface.
const BG_TOP = "#3d4370";
const BG_BOTTOM = "#20233a";

// density bucket -> [legacy icon px, adaptive foreground px (108dp)]
const BUCKETS = {
  "mdpi": [48, 108],
  "hdpi": [72, 162],
  "xhdpi": [96, 216],
  "xxhdpi": [144, 324],
  "xxxhdpi": [192, 432],
};

// White page + the soft grey drop shadow -> transparent. Both are NEUTRAL (r≈g≈b), while
// every part of the cube — including its white gloss — keeps a colour cast, so keying on
// "bright AND unsaturated" removes the backdrop without punching holes in the art. The
// alpha ramps instead of switching so the cube keeps its anti-aliased outline.
async function cutout(buf) {
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const HI = 250; // brighter than this = background
  const LO = 196; // darker than this = keep
  const SAT = 22; // max-min above this = coloured, so it's the cube, not the page
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const min = Math.min(r, g, b);
    const sat = Math.max(r, g, b) - min;
    if (sat >= SAT || min <= LO) continue; // coloured or dark → part of the cube
    if (min >= HI) data[i + 3] = 0;
    else data[i + 3] = Math.round((data[i + 3] * (HI - min)) / (HI - LO));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

const bgSvg = (size) => Buffer.from(
  `<svg width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>` +
  `</linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/></svg>`
);
const roundMask = (size, r) => Buffer.from(
  `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
);
const circleMask = (size) => Buffer.from(
  `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
);

// Slime scaled to `frac` of the canvas, centred, on a transparent square.
async function slimeLayer(slime, size, frac) {
  const inner = Math.round(size * frac);
  const s = await sharp(slime).resize(inner, inner, { fit: "inside" }).toBuffer();
  const m = await sharp(s).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: s, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png()
    .toBuffer();
}

const meta = await sharp(SRC).metadata();
const cw = Math.floor(meta.width / 3);
const ch = Math.floor(meta.height / 3);
const cell = await sharp(SRC)
  .extract({ left: CELL_COL * cw, top: CELL_ROW * ch, width: cw, height: ch })
  .toBuffer();
// knock out the white, then crop tight to what's left
const slime = await sharp(await cutout(cell)).trim({ threshold: 1 }).png().toBuffer();

for (const [bucket, [icon, fg]] of Object.entries(BUCKETS)) {
  const dir = `${RES}mipmap-${bucket}/`;
  mkdirSync(dir, { recursive: true });

  // legacy icons: slime on the navy square, rounded / circular
  const square = await sharp(bgSvg(icon))
    .composite([{ input: await slimeLayer(slime, icon, 0.74) }])
    .png()
    .toBuffer();
  await sharp(square)
    .composite([{ input: roundMask(icon, Math.round(icon * 0.2)), blend: "dest-in" }])
    .png()
    .toFile(dir + "ic_launcher.png");
  await sharp(square)
    .composite([{ input: circleMask(icon), blend: "dest-in" }])
    .png()
    .toFile(dir + "ic_launcher_round.png");

  // adaptive foreground: transparent, art kept inside the 66% safe zone
  writeFileSync(dir + "ic_launcher_foreground.png", await slimeLayer(slime, fg, 0.56));
  console.log(`[icons] ${bucket}: ${icon}px icon, ${fg}px foreground`);
}

// Adaptive background as a gradient drawable (the flat @color stays for old launchers).
mkdirSync(RES + "drawable", { recursive: true });
mkdirSync(RES + "mipmap-anydpi-v26", { recursive: true });
writeFileSync(
  RES + "drawable/ic_launcher_background.xml",
  `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n` +
  `    <gradient android:startColor="${BG_TOP}" android:endColor="${BG_BOTTOM}" android:angle="270"/>\n</shape>\n`
);
writeFileSync(
  RES + "mipmap-anydpi-v26/ic_launcher.xml",
  `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `    <background android:drawable="@drawable/ic_launcher_background"/>\n` +
  `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`
);
mkdirSync(RES + "mipmap-anydpi-v26", { recursive: true });
writeFileSync(
  RES + "mipmap-anydpi-v26/ic_launcher_round.xml",
  `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `    <background android:drawable="@drawable/ic_launcher_background"/>\n` +
  `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`
);
console.log("[icons] done");

// ---- Portrait lock ---------------------------------------------------------
// Capacitor's stock manifest lets the activity rotate; the board layout is portrait-only,
// so pin it. Idempotent: skips if the attribute is already there.
const MANIFEST = root + "android/app/src/main/AndroidManifest.xml";
if (existsSync(MANIFEST)) {
  const xml = readFileSync(MANIFEST, "utf8");
  if (xml.includes("android:screenOrientation")) {
    console.log("[manifest] portrait lock already present");
  } else {
    const anchor = '            android:name=".MainActivity"';
    if (!xml.includes(anchor)) throw new Error("MainActivity line not found — manifest layout changed");
    writeFileSync(MANIFEST, xml.replace(anchor, '            android:screenOrientation="portrait"\n' + anchor));
    console.log("[manifest] portrait lock added");
  }
} else {
  console.log("[manifest] android/ not generated yet — run `npx cap add android` first");
}
