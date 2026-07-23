import Phaser from "phaser";
import { GAME_W, GAME_H } from "./GameScene";
import { levelDifficulty, type Difficulty } from "../game/level";

const LEVEL_COUNT = 60; // how many levels the map shows (all tappable — pick any)
const SPACING = 104; // vertical gap between level nodes
const BASE_R = 34; // base hex radius (harder tiers are bigger)

interface NodeHit {
  level: number;
  x: number;
  worldY: number;
  r: number;
}

// Home screen: a long, SCROLLABLE "climb the map" of hexagon level nodes. Drag to
// scroll (replay earlier levels / preview later ones). The current level glows;
// HARD (every 5th) and SUPER-HARD (every 15th) levels stand out with colour,
// an icon badge and a tag.
export class LevelSelectScene extends Phaser.Scene {
  private gold = 0;
  private map!: Phaser.GameObjects.Container;
  private nodes: NodeHit[] = [];
  private scrollC = 0;
  private scrollMin = 0;
  private scrollMax = 0;
  private viewTop = 0;
  private viewBottom = 0;

  constructor() {
    super("select");
  }

  preload() {
    this.load.image("background", "art/background.png"); // shared theme background
    this.load.image("avatar", "art/slime-3.png"); // a cute face for the profile chip
    // Start-nav mascot. Placeholder for now → swap to the real cute-slime art when ready.
    this.load.image("start-slime", "art/slime-3.png");
  }

  create() {
    const dpr = this.scale.gameSize.width / GAME_W;
    this.cameras.main.setZoom(dpr);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);

    this.gold = this.readInt("pf_gold", 0);
    const progress = Math.max(1, this.readInt("pf_progress", 1));

    this.viewTop = 88;
    this.viewBottom = GAME_H - 152;
    this.nodes = [];

    this.buildBackground();
    this.buildMap(progress);
    this.buildTopBar();
    this.buildPlay(progress);
    this.buildBottomNav();
    this.setupScroll();

    // Discoverability: make it clear every level is pickable.
    this.add
      .text(GAME_W / 2, this.viewTop - 12, "Tap any level to play · Drag to scroll", {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "12px",
        color: "#eaf6df",
        stroke: "#12305e",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(70);
  }

  // ---- Background -----------------------------------------------------
  private buildBackground() {
    const img = this.add.image(GAME_W / 2, GAME_H / 2, "background").setDepth(-100);
    img.setDisplaySize(GAME_W, GAME_H);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14260f, 0.32).setDepth(-99);
  }

  // ---- Scrollable level map -------------------------------------------
  private worldY(level: number) {
    return -(level - 1) * SPACING; // level 1 at 0, higher levels rise (negative)
  }
  private waveX(level: number) {
    return GAME_W / 2 + Math.sin(level * 0.7) * 46; // gentle side-to-side wave
  }

  private buildMap(progress: number) {
    const map = this.add.container(0, 0).setDepth(5);
    this.map = map;

    // Winding golden road behind the nodes, stroked wide→narrow.
    const road = this.add.graphics();
    const trace = () => {
      road.beginPath();
      road.moveTo(this.waveX(1), this.worldY(1) + 40);
      for (let L = 1; L <= LEVEL_COUNT; L++) road.lineTo(this.waveX(L), this.worldY(L));
      road.lineTo(this.waveX(LEVEL_COUNT), this.worldY(LEVEL_COUNT) - 40);
    };
    road.lineStyle(22, 0x0d2c1a, 0.45); trace(); road.strokePath(); // soft shadow
    road.lineStyle(15, 0xf3af33, 1); trace(); road.strokePath(); // gold road
    road.lineStyle(5, 0xffe6a0, 0.95); trace(); road.strokePath(); // bright core
    map.add(road);

    for (let L = 1; L <= LEVEL_COUNT; L++) this.makeNode(map, L, progress);

    // Clip the map to the window between the HUD and the Play button.
    const mg = this.make.graphics();
    mg.fillStyle(0xffffff, 1);
    mg.fillRect(0, this.viewTop, GAME_W, this.viewBottom - this.viewTop);
    map.setMask(mg.createGeometryMask());

    // Scroll clamps + initial position (centre the current level in the window).
    const viewMid = (this.viewTop + this.viewBottom) / 2;
    this.scrollMin = this.viewBottom; // level 1 rests at the bottom
    this.scrollMax = this.viewTop + (LEVEL_COUNT - 1) * SPACING; // level N reaches the top
    this.scrollC = Phaser.Math.Clamp(viewMid + (progress - 1) * SPACING, this.scrollMin, this.scrollMax);
    map.y = this.scrollC;
  }

  private diffColors(d: Difficulty): { face: number; edge: number; hi: number } {
    if (d === "superhard") return { face: 0xef3b7a, edge: 0x8a1246, hi: 0xffa8cd };
    if (d === "hard") return { face: 0xf7902a, edge: 0xb35f0c, hi: 0xffcf86 };
    return { face: 0x4f97ef, edge: 0x2456a8, hi: 0x9ec8ff };
  }

  private makeNode(map: Phaser.GameObjects.Container, level: number, progress: number) {
    const d = levelDifficulty(level);
    const cleared = level < progress;
    const current = level === progress;
    const x = this.waveX(level);
    const y = this.worldY(level);
    const R = BASE_R + (d === "superhard" ? 9 : d === "hard" ? 5 : 0); // harder = bigger

    const col = current ? { face: 0xffc63a, edge: 0xcf8410, hi: 0xffe9a8 } : this.diffColors(d);

    // SUPER-HARD gets a pulsing danger ring; the current level a warm glow.
    if (d === "superhard") {
      const ring = this.add.circle(x, y, R + 12, 0xff2f6e, 0.28);
      map.add(ring);
      this.tweens.add({ targets: ring, scale: 1.14, alpha: 0.12, duration: 850, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    if (current) {
      const glow = this.add.circle(x, y, R + 20, 0xffe14a, 0.42);
      map.add(glow);
      this.tweens.add({ targets: glow, scale: 1.16, alpha: 0.16, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }

    const g = this.add.graphics();
    this.hex(g, x, y + 5, R + 1, 0x061a10, 0.42); // drop shadow
    this.hex(g, x, y, R, col.edge); // outer edge ring
    this.hex(g, x, y, R - 4.5, col.face); // face
    this.hex(g, x, y - R * 0.3, R * 0.6, col.hi, 0.55); // glossy top bevel
    g.lineStyle(current ? 4 : d === "normal" ? 2.5 : 3.5, current ? 0xfff4cf : col.edge, 1);
    this.hexStroke(g, x, y, R);
    if (cleared && !current) g.setAlpha(0.72); // beaten levels dim back
    map.add(g);

    const num = this.add
      .text(x, y + 1, String(level), {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: current ? "30px" : d === "normal" ? "23px" : "26px",
        color: "#ffffff",
        stroke: "#0e2a1a",
        strokeThickness: current ? 6 : 5,
      })
      .setOrigin(0.5);
    if (cleared && !current) num.setAlpha(0.85);
    map.add(num);

    // Beaten levels get a little star; the current level a "you are here" arrow.
    if (cleared && !current) {
      const star = this.add.text(x + R - 6, y - R + 4, "⭐", { fontSize: "16px" }).setOrigin(0.5);
      map.add(star);
    }

    // Difficulty flair — always visible so hard tiers read at a glance.
    if (d !== "normal") {
      const icon = this.add.text(x, y - R - 4, d === "superhard" ? "💀" : "🔥", { fontSize: "20px" }).setOrigin(0.5, 1);
      map.add(icon);
      this.diffTag(map, x, y + R + 3, d);
    }

    this.nodes.push({ level, x, worldY: y, r: R });
  }

  private diffTag(map: Phaser.GameObjects.Container, x: number, y: number, d: Difficulty) {
    const label = d === "superhard" ? "SUPER HARD" : "HARD";
    const color = d === "superhard" ? 0xd11e5e : 0xe06a12;
    const t = this.add
      .text(x, y + 2, label, { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "12px", color: "#ffffff" })
      .setOrigin(0.5, 0);
    const w = t.width + 18;
    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(x - w / 2, y, w, 20, 10);
    bg.lineStyle(2, 0xffffff, 0.9);
    bg.strokeRoundedRect(x - w / 2, y, w, 20, 10);
    map.add(bg);
    map.add(t);
  }

  // Flat-top hexagon fill / stroke.
  private hexPath(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  }
  private hex(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number, alpha = 1) {
    g.fillStyle(color, alpha);
    this.hexPath(g, cx, cy, r);
    g.fillPath();
  }
  private hexStroke(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number) {
    this.hexPath(g, cx, cy, r);
    g.strokePath();
  }

  // ---- Drag-to-scroll + tap-to-play -----------------------------------
  private setupScroll() {
    let downY = 0;
    let downScroll = 0;
    let moved = 0;
    let active = false;

    // Use WORLD coords (worldX/worldY) throughout: the camera is zoomed by dpr, so
    // pointer.x/y (screen space) are dpr× larger than the world coords the nodes
    // live in — comparing those directly made taps miss every node.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      active = p.worldY >= this.viewTop && p.worldY <= this.viewBottom;
      downY = p.worldY;
      downScroll = this.scrollC;
      moved = 0;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!active || !p.isDown) return;
      const dy = p.worldY - downY;
      moved = Math.max(moved, Math.abs(dy));
      this.scrollC = Phaser.Math.Clamp(downScroll + dy, this.scrollMin, this.scrollMax);
      this.map.y = this.scrollC;
    });
    const end = (p: Phaser.Input.Pointer) => {
      if (active && moved < 8) this.tapAt(p.worldX, p.worldY); // a tap, not a drag → play that level
      active = false;
    };
    this.input.on("pointerup", end);
    this.input.on("pointerupoutside", end);
  }

  private tapAt(px: number, py: number) {
    if (py < this.viewTop || py > this.viewBottom) return;
    for (const n of this.nodes) {
      const sy = this.map.y + n.worldY;
      if (Math.hypot(px - n.x, py - sy) <= n.r + 6) {
        // quick "you picked it" pop, then launch that level
        const ring = this.add
          .circle(n.x, sy, n.r, 0xffffff, 0.001)
          .setStrokeStyle(4, 0xffffff, 0.9)
          .setDepth(200);
        this.tweens.add({ targets: ring, scale: 1.5, alpha: 0, duration: 220, onComplete: () => ring.destroy() });
        this.time.delayedCall(110, () => this.scene.start("game", { level: n.level }));
        return;
      }
    }
  }

  // ---- Top bar --------------------------------------------------------
  private buildTopBar() {
    const y = 46;
    const D = 60;
    const av = this.add.graphics().setDepth(D);
    av.fillStyle(0x123a78, 1);
    av.fillRoundedRect(14, y - 26, 56, 56, 14);
    av.lineStyle(3, 0x8fc0ff, 1);
    av.strokeRoundedRect(14, y - 26, 56, 56, 14);
    this.add.image(42, y + 2, "avatar").setDisplaySize(46, 46).setDepth(D + 1);

    this.statPill(148, y, 96, 0xef3f5a, "❤", "5", "MAX");
    this.statPill(300, y, 108, 0x2a2a3a, "🪙", String(this.gold), "＋");

    const s = this.add
      .circle(GAME_W - 34, y, 22, 0x2f6fd0, 1)
      .setStrokeStyle(3, 0x8fc0ff, 1)
      .setDepth(D)
      .setInteractive({ useHandCursor: true });
    this.add.text(GAME_W - 34, y - 1, "⚙", { fontSize: "24px", color: "#ffffff" }).setOrigin(0.5).setDepth(D + 1);
    s.on("pointerdown", () => this.toast("Settings — coming soon"));
  }

  private statPill(x: number, y: number, w: number, color: number, icon: string, value: string, tail: string) {
    const D = 60;
    const g = this.add.graphics().setDepth(D);
    g.fillStyle(0x0e2f2b, 0.85);
    g.fillRoundedRect(x - w / 2, y - 17, w, 34, 17);
    g.lineStyle(2.5, 0xffe08a, 0.6);
    g.strokeRoundedRect(x - w / 2, y - 17, w, 34, 17);
    this.add.circle(x - w / 2 + 17, y, 15, color).setStrokeStyle(2, 0xffffff, 0.85).setDepth(D + 1);
    this.add.text(x - w / 2 + 17, y - 1, icon, { fontSize: "15px" }).setOrigin(0.5).setDepth(D + 2);
    this.add
      .text(x - w / 2 + 36, y, value, { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#ffffff" })
      .setOrigin(0, 0.5)
      .setDepth(D + 2);
    this.add
      .text(x + w / 2 - 14, y, tail, { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "13px", color: "#ffe08a" })
      .setOrigin(0.5)
      .setDepth(D + 2);
  }

  // ---- Play button ----------------------------------------------------
  private buildPlay(progress: number) {
    const D = 40;
    const y = GAME_H - 116;
    const w = 250;
    const h = 60;
    const g = this.add.graphics().setDepth(D);
    const draw = (fill: number) => {
      g.clear();
      g.fillStyle(0xb9760d, 1);
      g.fillRoundedRect(GAME_W / 2 - w / 2, y - h / 2 + 4, w, h, 18);
      g.fillStyle(fill, 1);
      g.fillRoundedRect(GAME_W / 2 - w / 2, y - h / 2, w, h, 18);
      g.lineStyle(3, 0xfff0c0, 0.9);
      g.strokeRoundedRect(GAME_W / 2 - w / 2, y - h / 2, w, h, 18);
    };
    draw(0xf9c22e);
    const label = this.add
      .text(GAME_W / 2, y - 1, `PLAY  ·  ${progress}`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "26px",
        color: "#ffffff",
        stroke: "#8a5a12",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(D + 1);
    const hit = this.add
      .rectangle(GAME_W / 2, y, w, h, 0xffffff, 0.001)
      .setDepth(D + 2)
      .setInteractive({ useHandCursor: true });
    hit.on("pointerover", () => draw(0xffd24a));
    hit.on("pointerout", () => draw(0xf9c22e));
    hit.on("pointerdown", () => {
      this.tweens.add({
        targets: label,
        scale: 0.92,
        duration: 90,
        yoyo: true,
        onComplete: () => this.scene.start("game", { level: progress }),
      });
    });
  }

  // ---- Bottom nav -----------------------------------------------------
  private buildBottomNav() {
    const D = 50;
    const h = 74;
    const y = GAME_H - h / 2;
    const bar = this.add.graphics().setDepth(D);
    bar.fillStyle(0x0e2c1c, 1);
    bar.fillRect(0, GAME_H - h, GAME_W, h);
    bar.lineStyle(2, 0x2f9f5a, 1);
    bar.lineBetween(0, GAME_H - h, GAME_W, GAME_H - h);

    // Icon-only nav (labels removed). The centre "Start" mascot sits on a raised
    // chip. Swap the emoji for the real icon art (nav-shop / nav-trophy) when ready.
    const items: Array<[number, string, boolean]> = [
      [GAME_W * 0.2, "🛒", false],
      [GAME_W * 0.5, "start-slime", true],
      [GAME_W * 0.8, "🏆", false],
    ];
    for (const [x, icon, active] of items) {
      if (active) {
        const chip = this.add.graphics().setDepth(D + 1);
        chip.fillStyle(0x2f9f5a, 1);
        chip.fillRoundedRect(x - 44, y - 40, 88, 70, 18);
        chip.lineStyle(3, 0xbfeecf, 0.9);
        chip.strokeRoundedRect(x - 44, y - 40, 88, 70, 18);
        this.add.image(x, y - 2, "start-slime").setDisplaySize(58, 58).setDepth(D + 2);
      } else {
        this.add.text(x, y, icon, { fontSize: "34px" }).setOrigin(0.5).setDepth(D + 2);
        this.add
          .rectangle(x, y, 88, h, 0xffffff, 0.001)
          .setDepth(D + 3)
          .setInteractive({ useHandCursor: true })
          .on("pointerdown", () => this.toast("Coming soon!"));
      }
    }
  }

  // ---- helpers --------------------------------------------------------
  private toast(msg: string) {
    const t = this.add
      .text(GAME_W / 2, GAME_H * 0.34, msg, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "18px",
        color: "#ffffff",
        stroke: "#12305e",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(300);
    this.tweens.add({ targets: t, y: GAME_H * 0.28, alpha: 0, duration: 1000, ease: "Quad.out", onComplete: () => t.destroy() });
  }

  private readInt(key: string, fallback: number): number {
    try {
      return parseInt(localStorage.getItem(key) ?? String(fallback), 10) || fallback;
    } catch {
      return fallback;
    }
  }
}
