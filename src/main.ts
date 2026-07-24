import Phaser from "phaser";
import { GameScene, GAME_W, GAME_H } from "./scenes/GameScene";
import { SplashScene } from "./scenes/SplashScene";
import { LevelSelectScene } from "./scenes/LevelSelectScene";

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
      Object.keys(localStorage)
        .filter((k) => k.startsWith("pf_"))
        .forEach((k) => localStorage.removeItem(k));
    } else {
      ["pf_boost_gifted", "pf_boost_counts", "pf_twin_intro"].forEach((k) => localStorage.removeItem(k));
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
const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

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
