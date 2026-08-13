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
//
// ⚠ Hai khoá cũ ở đây — "hopin.png" và "background.png" — KHÔNG KHỚP tên file nào: hai ảnh
// nền thật tên là splash-hopin.jpg và background2.jpg. Mà vòng tối ưu bên dưới lại bỏ qua mọi
// file không phải .png, nên suốt thời gian qua CẢ HAI ảnh nặng nhất chưa từng được đụng tới:
// 274 KB + 270 KB tải nguyên bản, gấp đôi cả bundle JS sau khi gzip (2026-08-13).
const CAPS = {
  // Icon booster: ảnh gốc 512² nhưng trong game vẽ ở 52px thiết kế (60px ở popup tutorial),
  // tức tối đa ~240px thật ở dpr 4. 256 vừa đủ VÀ là luỹ thừa 2 nên vẫn được mipmap.
  "booster-add.png": 256, "booster-hand.png": 256,
  "booster-refresh.png": 256, "booster-magnet.png": 256,
};
const DEFAULT_CAP = 512;
// Ảnh nền phủ kín màn: giữ nguyên cỡ (thu nhỏ là thấy ngay ở màn hình đầu tiên), chỉ nén lại.
const JPEG_QUALITY = 78;

if (!existsSync(ART_DIR)) {
  console.log("[optimize-art] no dist/art — did vite build run? skipping");
  process.exit(0);
}

// Drop folders the game never loads at runtime (source scraps + design references).
// "tmp" is the art scratch folder — gitignored, but vite copies all of public/ regardless,
// and at ~18MB it would more than double the APK if it shipped.
// "newbackground" = the Gemini renders the store covers are cut from. Source material for
// store/crazygames/, never loaded by the game — same class as the folders beside it.
for (const junk of ["Notused", "level art", "tmp", "newbackground"]) {
  const p = join(ART_DIR, junk);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`[optimize-art] removed dist/art/${junk}`);
  }
}

// ---- Cars & runner slimes → power-of-two, so they finally get MIPMAPS ---------------
//
// Phaser only mipmaps power-of-two textures (main.ts, render.mipmapFilter). The board
// tiles are 128x128 so they get proper minification; the cars ship at 373x420 and do not,
// and they are drawn at ~140-184 device px — a 2-3x shrink taking ONE texel sample per
// pixel. Detail drops out at random, which is exactly the "nhoe" the user saw: crisp tiles
// and soft cars side by side on the same screen (2026-08-08).
//
// Fix: fit each into 256 (comfortably above the ~184px they are ever drawn at) and pad to
// a transparent 256x256. GameScene.trimTexture crops the padding straight back off, so
// nothing moves on screen — the texture is simply power-of-two now.
//
// dist ONLY. public/art keeps the originals at full size.
const POT = 256;
for (const file of [...walk(ART_DIR)]) {
  const b = basename(file);
  if (!/^(car|slime)-\d+\.png$/.test(b)) continue;
  const tmp = file + ".pot.png";
  await sharp(file)
    .resize(POT, POT, { fit: "inside", withoutEnlargement: true })
    .extend({ top: 0, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(POT, POT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 90 })
    .toFile(tmp);
  rmSync(file, { force: true });
  renameSync(tmp, file);
}
console.log(`[optimize-art] cars/slimes padded to ${POT}x${POT} (power-of-two → mipmaps)`);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

// ---- JPEG: nén lại, GIỮ NGUYÊN kích thước ------------------------------------------------
// Chúng phủ kín màn hình nên thu nhỏ là thấy ngay ở màn đầu tiên; nhưng chúng chưa từng qua
// một bước nén nào, nên chỉ mã hoá lại ở q78 (mozjpeg) đã đủ.
{
  let b4 = 0, af = 0, k = 0;
  for (const file of walk(ART_DIR)) {
    if (!/\.jpe?g$/i.test(file)) continue;
    const orig = statSync(file).size;
    const tmp = file + ".tmp";
    try {
      await sharp(file).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(tmp);
      const now = statSync(tmp).size;
      if (now < orig) { rmSync(file); renameSync(tmp, file); b4 += orig; af += now; k++; }
      else rmSync(tmp);
    } catch (e) {
      if (existsSync(tmp)) rmSync(tmp);
      console.warn(`[optimize-art] bo qua ${file}: ${e.message}`);
    }
  }
  if (k) console.log(`[optimize-art] nen lai ${k} JPEG: ${(b4 / 1048576).toFixed(2)}MB -> ${(af / 1048576).toFixed(2)}MB`);
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
