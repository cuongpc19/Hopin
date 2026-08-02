import Phaser from "phaser";
import { GAME_W, GAME_H, setPageBackground } from "./GameScene";
import { Audio } from "../game/audio";
import { t as tr } from "../game/i18n";

// Fade out and remove the pre-boot loading screen baked into index.html.
function hideBootScreen() {
  const el = document.getElementById("boot");
  if (!el) return;
  el.classList.add("hide");
  setTimeout(() => el.remove(), 350);
}

// First screen on launch: the "Hop In!" poster, full-screen, tap to play.
export class SplashScene extends Phaser.Scene {
  constructor() {
    super("splash");
  }

  preload() {
    this.load.image("splash", "art/hopin2.jpg"); // poster mới (user 2026-08-01)
  }

  create() {
    // The instant HTML boot screen (index.html #boot) has done its job now that
    // the engine is up and the poster is decoded — fade it out.
    hideBootScreen();

    // Dev convenience: ?level=N jumps straight into the game, skipping the splash.
    if (new URLSearchParams(location.search).has("level")) {
      this.scene.start("game");
      return;
    }

    // Match GameScene's camera setup so world coords stay 480x854 at any DPR.
    const dpr = this.scale.gameSize.width / GAME_W;
    this.cameras.main.setZoom(dpr);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
    this.cameras.main.setBackgroundColor(0xf4efe0); // cream, matches poster top
    setPageBackground(0xf4efe0); // …and the bands outside the canvas, so the poster floats on cream

    // Poster, scaled to COVER the screen (crop overflow, no stretch).
    const img = this.add.image(GAME_W / 2, GAME_H / 2, "splash");
    img.setScale(Math.max(GAME_W / img.width, GAME_H / img.height));

    // "Loading…" — CHỈ chữ (bỏ nền button/pill), đặt THẤP hơn (user 2026-08-02).
    const y = Math.round(GAME_H * 0.78);
    const label = this.add
      .text(GAME_W / 2, y, tr("loading") + "…", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "24px", // +20% (user 2026-08-02)
        color: "#ffffff",
        stroke: "#5a3a12",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(1);
    // animated dots so it reads as "working"
    this.time.addEvent({
      delay: 420, loop: true,
      callback: () => { const n = ((label.text.match(/\./g)?.length ?? 0) % 3) + 1; label.setText(tr("loading") + ".".repeat(n)); },
    });
    this.tweens.add({
      targets: label,
      scale: 1.06,
      alpha: 0.85,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });

    // Build version (bottom, small) — so you can confirm a fresh deploy loaded.
    this.add
      .text(GAME_W / 2, GAME_H - 16, `v${__APP_VERSION__} · ${__APP_BUILD__}`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "12px",
        color: "#ffffff",
        stroke: "#5a3a12",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.85);

    // Auto-advance to Home: show the loading screen for a MINIMUM of 3s, but if the
    // Home assets ("load các level") are still loading past that, wait until they finish
    // first — then fade to the picker. No tap required (user 2026-08-01).
    const MIN_MS = 3000;
    const t0 = this.time.now;
    let went = false;
    let loadDone = false;

    // Thanh PROGRESS (chuyên nghiệp hơn dấu "…"): track bo tròn + fill vàng chạy mượt theo
    // thời gian tối thiểu; đầy 100% ngay trước khi fade sang Home (user 2026-08-02).
    const barW = 264, barH = 15, barX = GAME_W / 2 - barW / 2, barY = y + 40; // +20% (user 2026-08-02)
    const track = this.add.graphics().setDepth(1);
    track.fillStyle(0x2a1c0a, 0.35); track.fillRoundedRect(barX, barY, barW, barH, barH / 2);
    track.lineStyle(2, 0xffffff, 0.55); track.strokeRoundedRect(barX, barY, barW, barH, barH / 2);
    const barFill = this.add.graphics().setDepth(2);
    const prog = { v: 0 };
    const drawBar = () => {
      barFill.clear();
      const w = Phaser.Math.Clamp(prog.v, 0, 1) * (barW - 4);
      if (w > 0.5) { barFill.fillStyle(0xffd95e, 1); barFill.fillRoundedRect(barX + 2, barY + 2, w, barH - 4, (barH - 4) / 2); }
    };
    this.tweens.add({ targets: prog, v: 0.92, duration: MIN_MS, ease: "Sine.out", onUpdate: drawBar });

    const goHome = () => {
      if (went) return;
      went = true;
      prog.v = 1; drawBar(); // đầy 100% trước khi chuyển
      this.cameras.main.fadeOut(350, 244, 239, 224);
      this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("select"));
    };

    // Preload the Home (level picker) art here so switching to it is instant and this
    // screen genuinely reflects "loading the levels". Phaser skips already-cached keys.
    this.load.image("background2", "art/background2.jpg");
    this.load.image("avatar", "art/slime-3.png");
    this.load.image("star-icon", "art/star.png");
    this.load.image("start-slime", "art/slime-3.png");
    for (const b of ["add", "hand", "refresh", "magnet"]) this.load.image(`booster-${b}`, `art/booster-${b}.png`);
    this.load.once("complete", () => { loadDone = true; });
    this.load.start();
    // Splash CỐ ĐỊNH ~3s rồi sang Home — KHÔNG chờ load lâu hơn (user 2026-08-02: nhanh hơn,
    // asset nhỏ đã cache + Home tự preload). Sau này load level thật sẽ chạy theo tiến độ thực.
    this.time.delayedCall(MIN_MS, goHome);
    void t0;

    // A tap only skips ahead once loading is DONE (so Home never shows unloaded art); it
    // also serves as the audio-unlock gesture browsers require.
    this.input.on("pointerdown", () => { Audio.unlock(); if (loadDone) goHome(); });
  }
}
