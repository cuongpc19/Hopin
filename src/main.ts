import Phaser from "phaser";
import { GameScene, GAME_W, GAME_H } from "./scenes/GameScene";
import { SplashScene } from "./scenes/SplashScene";
import { LevelSelectScene } from "./scenes/LevelSelectScene";

// Render the canvas at the device's real pixel density so sprites stay crisp
// when the FIT scaler stretches the game to fill the screen. World coordinates
// stay 480x854 (see the camera zoom in GameScene.create).
const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: Math.round(GAME_W * DPR),
  height: Math.round(GAME_H * DPR),
  backgroundColor: "#bfe3a0",
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [SplashScene, LevelSelectScene, GameScene],
});
