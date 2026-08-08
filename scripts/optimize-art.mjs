// Post-build art optimizer.
// Runs against the *built* copy in dist/art only — the originals in public/art
// stay pristine at full resolution. AI-exported PNGs come out at 1000-2700px but
// display at a few hundred px in game, so we cap the longest side and quantize to
// a palette PNG. This alone cuts the deployed art from ~32MB to a few MB, which is
// the real reason the game felt slow to load on Netlify.
import sharp from "sharp";
import { readdirSync, statSync, rmSync, renameSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

const ART_DIR = "dist/art";

// Longest-side cap per file. Splash + background fill the screen so they get more
// pixels; everything else is a sprite/icon shown small, 512 is generous (retina-safe).
const CAPS = { "hopin.png": 900, "background.png": 900 };
const DEFAULT_CAP = 512;

if (!existsSync(ART_DIR)) {
  console.log("[optimize-art] no dist/art — did vite build run? skipping");
  process.exit(0);
}

// Drop folders the game never loads at runtime (source scraps + design references).
// "tmp" is the art scratch folder — gitignored, but vite copies all of public/ regardless,
// and at ~18MB it would more than double the APK if it shipped.
for (const junk of ["Notused", "level art", "tmp"]) {
  const p = join(ART_DIR, junk);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`[optimize-art] removed dist/art/${junk}`);
  }
}

// Individual files the game never loads. They sit loose in the main art folders rather
// than in the scrap folders above, so the sweep never caught them — 243KB of a build we
// were about to hand to CrazyGames (checked 2026-08-08 by matching every shipped image
// against the source; these five had no reference anywhere the game runs).
//
// ⚠ Removed from dist ONLY. The originals stay in public/art, and slime3D.png in
// particular is still the SOURCE the Android launcher icons are cut from
// (scripts/setup-android.mjs) — it just has no business inside the web build.
for (const dead of [
  "slime3D.png", // 3x3 sheet; only sliced offline by scripts/slice-slime3d.mjs
  "slimeHome.png", // superseded; Home draws background2.jpg
  "backgroundHome.png", // ditto
  "coin/coin_complete.png",
  "slime/tile-gloss.png",
]) {
  const p = join(ART_DIR, dead);
  if (existsSync(p)) {
    rmSync(p, { force: true });
    console.log(`[optimize-art] removed dist/art/${dead} (khong dung toi)`);
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let before = 0, after = 0, n = 0;
for (const file of walk(ART_DIR)) {
  if (extname(file).toLowerCase() !== ".png") continue;
  const cap = CAPS[basename(file)] ?? DEFAULT_CAP;
  const origBytes = statSync(file).size;
  const tmp = file + ".tmp";
  try {
    const img = sharp(file);
    const meta = await img.metadata();
    const longest = Math.max(meta.width || 0, meta.height || 0);
    let pipe = img;
    if (longest > cap) pipe = pipe.resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true });
    // palette PNG (<=256 colours) is perfect for these flat cartoon arts and shrinks them hard
    await pipe.png({ palette: true, quality: 80, compressionLevel: 9, effort: 8 }).toFile(tmp);
    const newBytes = statSync(tmp).size;
    if (newBytes < origBytes) {
      rmSync(file);
      renameSync(tmp, file);
      before += origBytes; after += newBytes; n++;
    } else {
      rmSync(tmp); // optimisation didn't help (already tiny) — keep original
    }
  } catch (e) {
    if (existsSync(tmp)) rmSync(tmp);
    console.warn(`[optimize-art] skip ${file}: ${e.message}`);
  }
}

const mb = (b) => (b / 1048576).toFixed(1);
console.log(`[optimize-art] optimised ${n} PNGs: ${mb(before)}MB -> ${mb(after)}MB`);
