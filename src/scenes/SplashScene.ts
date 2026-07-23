import Phaser from "phaser";
import { GAME_W, GAME_H } from "./GameScene";
import { Audio } from "../game/audio";

// First screen on launch: the "Hop In!" poster, full-screen, tap to play.
export class SplashScene extends Phaser.Scene {
  constructor() {
    super("splash");
  }

  preload() {
    this.load.image("splash", "art/hopin.png");
  }

  create() {
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

    // Poster, scaled to COVER the screen (crop overflow, no stretch).
    const img = this.add.image(GAME_W / 2, GAME_H / 2, "splash");
    img.setScale(Math.max(GAME_W / img.width, GAME_H / img.height));

    // "Tap to start" pill a bit below the screen centre, gently pulsing.
    const y = Math.round(GAME_H * 0.62);
    const label = this.add
      .text(GAME_W / 2, y, "TAP TO START", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "20px",
        color: "#ffffff",
        stroke: "#5a3a12",
        strokeThickness: 5,
      })
      .setOrigin(0.5);
    const pill = this.add
      .rectangle(GAME_W / 2, y, label.width + 44, 46, 0x6a4a12, 0.55)
      .setStrokeStyle(3, 0xffffff, 0.85);
    pill.setDepth(0);
    label.setDepth(1);
    this.tweens.add({
      targets: [label, pill],
      scale: 1.06,
      alpha: 0.85,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });

    // Tap anywhere → fade to the level picker. Also unlock audio here (this is the
    // first user gesture, which browsers require before any sound can play).
    this.input.once("pointerdown", () => {
      Audio.unlock();
      this.cameras.main.fadeOut(350, 244, 239, 224);
      this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("select"));
    });
  }
}
