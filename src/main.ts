import Phaser from "phaser";
import { GameScene, GAME_W, GAME_H } from "./scenes/GameScene";
import { SplashScene } from "./scenes/SplashScene";
import { LevelSelectScene } from "./scenes/LevelSelectScene";
import { platform } from "./platform";

// Hâm nóng font game (Lilita One — banner LEVEL COMPLETE!/CLAIM): canvas Phaser chỉ dùng
// được font đã nạp xong; load sớm để tới màn thắng đầu tiên chữ đã đúng font.
try {
  document.fonts?.load('32px "Lilita One"');
} catch {
  /* trình duyệt không hỗ trợ Font Loading API — font vẫn swap khi sẵn sàng */
}

// Dev/testing reset via URL — handy on a phone where DevTools/Console isn't available.
// Runs BEFORE the game boots so scenes read clean state:
//   ?reset=1    → re-arm the booster & twin-car tutorials (keeps gold + progress)
//   ?reset=all  → wipe ALL saved state (gold, progress, boosters, tutorials)
// The ?reset flag is then stripped from the URL so a later refresh won't wipe again.
(() => {
  try {
    const p = new URLSearchParams(location.search);
    const r = p.get("reset");
    if (!r) return;
    if (r === "all") {
      // Keys are ENUMERATED from localStorage — platform.storage has no key listing, and
      // the local copy always mirrors the host store, so it is a complete list. Removal
      // goes through platform.storage so the host's copy is cleared too; wiping only the
      // local one would let the cloud save reappear on the next load.
      Object.keys(localStorage)
        .filter((k) => k.startsWith("pf_"))
        .forEach((k) => platform.storage.removeItem(k));
    } else {
      ["pf_boost_gifted", "pf_boost_counts", "pf_twin_intro"].forEach((k) => platform.storage.removeItem(k));
    }
    p.delete("reset");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } catch {
    /* storage unavailable — ignore */
  }
})();

// Render the canvas at the device's real pixel density so sprites stay crisp
// when the FIT scaler stretches the game to fill the screen. World coordinates
// stay 480x854 (see the camera zoom in GameScene.create).
//
// Capped at 2, not 3: a 3x retina canvas is 1440x2562 and pushes ~2.25x the
// fragments of a 2x one every frame at 60fps — the main reason the game ran hot
// on retina Macs/iPhones. 2x is already pixel-crisp on those screens, so this
// roughly halves GPU fill for no visible quality loss.
//
// devicePixelRatio ALONE is not enough (user 2026-08-08: cars looked blurry on a big
// screen). On an ordinary non-retina monitor it reports 1, so the canvas was built at
// 480x768 and then FIT stretched it up to fill a ~1000px-tall browser window — a 1.3x
// upscale of every sprite. Flat tiles survive that; the cars' faces and numbers do not.
// Phones and retina Macs never showed it because they already report 2.
//
// So take whichever is larger: the device's pixel density, or how much FIT is about to
// stretch us. The 2x ceiling still holds, so the heat fix above is untouched.
const stretch = window.innerHeight > 0 ? window.innerHeight / GAME_H : 1;
const DPR = Math.max(1, Math.min(Math.max(window.devicePixelRatio || 1, stretch), 2));

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: Math.round(GAME_W * DPR),
  height: Math.round(GAME_H * DPR),
  backgroundColor: "#bfe3a0",
  roundPixels: false,
  // Hint the browser to keep WebGL on the low-power (integrated) GPU. On dual-GPU
  // MacBooks this stops a 2D puzzle game from spinning up the discrete GPU — a big
  // heat/battery saver — and browsers that ignore the hint are unaffected.
  render: {
    powerPreference: "low-power",
    // Mipmaps for the small, heavily-minified art. A board tile is a 128px texture drawn at
    // ~32px (cell 12.5 × 1.3 × DPR 2) — a ~4× shrink. Phaser's default is NO mipmaps, so the
    // GPU takes roughly one texel sample per pixel: the keycap's 8px bevel (≈2 device px on
    // screen) lands on a sample for some tiles and is skipped for others, purely from each
    // tile's sub-pixel position. That is why the same beige read with a dark right-hand edge
    // in one column and clean in the next (user 2026-08-04). `this.cell` is fractional
    // (12.509 on a 26×26), so the phase drifts across the board — hence left ≠ right.
    //
    // Safe to set globally: Phaser only applies a mipmap min-filter to power-of-two textures
    //   minFilter = (pow && this.mipmapFilter) ? this.mipmapFilter : gl.LINEAR;
    // and only calls generateMipmap() for those. Our 63 non-POT images (backgrounds, cars,
    // boosters) keep plain LINEAR and are untouched; the 26 POT ones (all 19 tiles, coin,
    // heart, nav icons) gain proper minification. Cost is ~33% more VRAM for those 26 only.
    mipmapFilter: "LINEAR_MIPMAP_LINEAR",
  },
  // Hard-cap the loop at 60fps. On 90/120Hz Android phones, Phaser would otherwise
  // render on every requestAnimationFrame tick (up to 120fps) — double the GPU work
  // and heat for a game designed at 60. With the limit set, the extra ticks skip
  // both update AND render (see Phaser TimeStep.stepLimitFPS), so movement stays
  // correct while the phone runs far cooler.
  fps: {
    target: 60,
    limit: 60,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [SplashScene, LevelSelectScene, GameScene],
});
