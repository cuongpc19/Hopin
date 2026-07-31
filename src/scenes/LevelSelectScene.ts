import Phaser from "phaser";
import { GAME_W, GAME_H } from "./GameScene";
import { levelDifficulty, type Difficulty } from "../game/level";
import {
  getProgress,
  isEventUnlocked,
  isEventComplete,
  rewardLabel,
  CLOVER_ICON,
  EVENT_NAME,
  MILESTONES,
  type EventReward,
} from "../game/cloverEvent";

const LEVEL_COUNT = 185; // L1-185 (kid pack L200-300 + rock-wall/logic L301-330 removed 2026-07-30)
const SPACING = 104; // vertical gap between level nodes
const BASE_R = 34; // base hex radius (harder tiers are bigger)

interface NodeHit {
  level: number;
  x: number;
  worldY: number;
  r: number;
  locked: boolean; // sequential mode: not yet reachable (level > progress)
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
    this.load.image("backgroundHome", "art/backgroundHome.png"); // premium dark Home art
    this.load.image("avatar", "art/slime-3.png"); // a cute face for the profile chip
    // Start-nav mascot. Placeholder for now → swap to the real cute-slime art when ready.
    this.load.image("start-slime", "art/slime-3.png");
    // Lucky Clover event: booster sprites for the reward previews (clover drawn/emoji).
    for (const b of ["add", "hand", "refresh", "magnet"]) this.load.image(`booster-${b}`, `art/booster-${b}.png`);
  }

  create() {
    const dpr = this.scale.gameSize.width / GAME_W;
    this.cameras.main.setZoom(dpr);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);

    this.gold = this.readInt("pf_gold", 0);
    const progress = Math.max(1, this.readInt("pf_progress", 1));
    // WHERE the player currently is (may be below the highest unlocked, e.g. after a reset
    // or replaying an earlier level). Home features THIS level. Falls back to progress for
    // players from before pf_current existed. (user 2026-07-31)
    const current = Phaser.Math.Clamp(this.readInt("pf_current", progress), 1, LEVEL_COUNT);

    // Lucky Clover event bar sits between the top bar and the map when active.
    const showEvent = isEventUnlocked() && !isEventComplete();
    this.viewTop = showEvent ? 194 : 88;
    this.viewBottom = GAME_H - 152;
    this.nodes = [];

    this.buildBackground();
    this.buildMap(progress, current);
    this.buildTopBar();
    this.buildPlay(current);
    this.buildBottomNav();
    this.setupScroll();
    if (showEvent) this.buildEventBar();

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
    // Premium dark Home art (already moody/twilight) → only a LIGHT veil + vignette so
    // the golden path + gem nodes pop, without over-darkening the picture.
    const key = this.textures.exists("backgroundHome") ? "backgroundHome" : "background";
    const img = this.add.image(GAME_W / 2, GAME_H / 2, key).setDepth(-100);
    img.setDisplaySize(GAME_W, GAME_H);
    const veil = this.add.graphics().setDepth(-99);
    veil.fillStyle(0x061308, 0.22);
    veil.fillRect(0, 0, GAME_W, GAME_H);
    // Soft top/bottom vignette to focus the eye on the centre climb.
    const vig = this.add.graphics().setDepth(-98);
    vig.fillStyle(0x020704, 0.4);
    vig.fillRect(0, 0, GAME_W, 60);
    vig.fillRect(0, GAME_H - 80, GAME_W, 80);
  }

  // ---- Scrollable level map -------------------------------------------
  private worldY(level: number) {
    return -(level - 1) * SPACING; // level 1 at 0, higher levels rise (negative)
  }
  private waveX(level: number) {
    return GAME_W / 2 + Math.sin(level * 0.7) * 46; // gentle side-to-side wave
  }

  private buildMap(progress: number, current: number) {
    const map = this.add.container(0, 0).setDepth(5);
    this.map = map;

    // The winding path ("dây") behind the nodes. A smooth Catmull-Rom SPLINE (not a
    // gappy polyline) stroked in layers so it reads as a clean rope that POPS against
    // the forest: soft shadow → crisp dark casing → warm amber body → bright core.
    const pts: Phaser.Math.Vector2[] = [];
    pts.push(new Phaser.Math.Vector2(this.waveX(1), this.worldY(1) + 60)); // run off-screen at the base
    for (let L = 1; L <= LEVEL_COUNT; L++) pts.push(new Phaser.Math.Vector2(this.waveX(L), this.worldY(L)));
    pts.push(new Phaser.Math.Vector2(this.waveX(LEVEL_COUNT), this.worldY(LEVEL_COUNT) - 60)); // and off the top
    const spline = new Phaser.Curves.Spline(pts);
    const SAMPLES = LEVEL_COUNT * 6; // smooth enough across the whole climb
    const road = this.add.graphics();
    const stroke = (w: number, color: number, alpha = 1) => {
      road.lineStyle(w, color, alpha);
      spline.draw(road, SAMPLES);
    };
    stroke(28, 0x08170c, 0.45); // soft outer shadow
    stroke(21, 0x3b2a12, 1);    // crisp dark casing → strong edge on the busy bg
    stroke(14, 0xf0a828, 1);    // warm amber body
    stroke(9, 0xffcb54, 1);     // inner glow
    stroke(4, 0xfff0c2, 0.95);  // bright core highlight
    map.add(road);

    for (let L = 1; L <= LEVEL_COUNT; L++) this.makeNode(map, L, progress, current);

    // Clip the map to the window between the HUD and the Play button.
    const mg = this.make.graphics();
    mg.fillStyle(0xffffff, 1);
    mg.fillRect(0, this.viewTop, GAME_W, this.viewBottom - this.viewTop);
    map.setMask(mg.createGeometryMask());

    // Scroll clamps + initial position (centre the current level in the window).
    const viewMid = (this.viewTop + this.viewBottom) / 2;
    const bottomPad = 60; // lift the tree so level 1 clears the bottom edge (fully visible)
    this.scrollMin = this.viewBottom - bottomPad; // level 1 rests just above the bottom
    this.scrollMax = this.viewTop + (LEVEL_COUNT - 1) * SPACING; // level N reaches the top
    this.scrollC = Phaser.Math.Clamp(viewMid + (current - 1) * SPACING, this.scrollMin, this.scrollMax);
    map.y = this.scrollC;
  }

  private diffColors(_d: Difficulty): { face: number; edge: number; hi: number } {
    // Unified PREMIUM tone: one deep emerald-teal gem for every level, gold-rimmed
    // (added in makeNode) — minimal & luxe. Difficulty still reads via node size + the
    // 🔥/💀 icon + HARD/SUPER tag; the CURRENT level stays gold to pop.
    return { face: 0x1c8f79, edge: 0x0a3b30, hi: 0x8fe8d0 };
  }

  private makeNode(map: Phaser.GameObjects.Container, level: number, progress: number, curLevel: number) {
    const d = levelDifficulty(level);
    const cleared = level < progress; // beaten history (highest reached) → star badge
    const current = level === curLevel; // where the player is NOW → gold highlight (wins over cleared)
    // Sequential mode locks anything past the reached level; "Any Level" unlocks all.
    const locked = !this.freeSelect() && level > progress;
    const x = this.waveX(level);
    const y = this.worldY(level);
    const R = BASE_R + (d === "superhard" ? 9 : d === "hard" ? 5 : 0); // harder = bigger

    const col = locked
      ? { face: 0x8b98a1, edge: 0x566068, hi: 0xc4cdd3 } // greyed-out lock
      : current
        ? { face: 0xffc63a, edge: 0xcf8410, hi: 0xffe9a8 }
        : this.diffColors(d);

    // SUPER-HARD gets a pulsing danger ring; the current level a warm glow. (Not when locked.)
    if (d === "superhard" && !locked) {
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
    this.hex(g, x, y + 6, R + 2, 0x02080c, 0.5); // deeper drop shadow → lifts off the dark stage
    this.hex(g, x, y, R + 1.5, 0x02100a, 0.9); // thin dark casing (crisp silhouette)
    this.hex(g, x, y, R, col.edge); // outer edge ring
    this.hex(g, x, y, R - 4.5, col.face); // face
    this.hex(g, x, y + R * 0.34, R * 0.66, col.edge, 0.35); // soft lower shade → rounded volume
    this.hex(g, x, y - R * 0.3, R * 0.62, col.hi, 0.68); // glossy top bevel (brighter)
    // Thin bright rim on the upper edge for a coated sheen.
    g.lineStyle(2, 0xffffff, 0.4);
    this.hexStroke(g, x, y - 0.5, R - 1.5);
    g.lineStyle(current ? 4 : d === "normal" ? 2.5 : 3.5, current ? 0xfff4cf : col.edge, 1);
    this.hexStroke(g, x, y, R);
    // Gold hairline rim on every gem (skip locked) — a unifying luxe accent, matches
    // the golden path. Sits just outside the coloured edge.
    if (!locked) {
      g.lineStyle(1.5, current ? 0xfff0b0 : 0xf0c463, current ? 1 : 0.9);
      this.hexStroke(g, x, y, R + 2);
    }
    if (locked) g.setAlpha(0.6);
    else if (cleared && !current) g.setAlpha(0.72); // beaten levels dim back
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
    if (locked) num.setAlpha(0.55);
    else if (cleared && !current) num.setAlpha(0.85);
    map.add(num);

    // Beaten → star badge; current → warm glow (above). Locked levels just dim (no lock icon).
    if (cleared && !current) {
      const star = this.add.text(x + R - 6, y - R + 4, "⭐", { fontSize: "16px" }).setOrigin(0.5);
      map.add(star);
    }

    // Difficulty flair — always visible so hard tiers read at a glance.
    if (d !== "normal") {
      const icon = this.add.text(x, y - R - 4, d === "superhard" ? "💀" : "🔥", { fontSize: "20px" }).setOrigin(0.5, 1);
      if (locked) icon.setAlpha(0.5);
      map.add(icon);
      this.diffTag(map, x, y + R + 3, d);
    }

    this.nodes.push({ level, x, worldY: y, r: R, locked });
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
        if (n.locked) {
          // Sequential mode: can't jump ahead. Red deny pulse + hint.
          const ring = this.add
            .circle(n.x, sy, n.r, 0xffffff, 0.001)
            .setStrokeStyle(4, 0xe23b3b, 0.9)
            .setDepth(200);
          this.tweens.add({ targets: ring, scale: 1.4, alpha: 0, duration: 240, onComplete: () => ring.destroy() });
          this.toast("Locked — finish the levels in order");
          return;
        }
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
    // Gold coin: a slightly bigger golden disc with a dark-gold rim, no letter.
    this.statPill(300, y, 108, 0xf9c22e, "", String(this.gold), "＋", "#8a5a10", 0xc98a10, 17);

    const s = this.add
      .circle(GAME_W - 34, y, 22, 0x2f6fd0, 1)
      .setStrokeStyle(3, 0x8fc0ff, 1)
      .setDepth(D)
      .setInteractive({ useHandCursor: true });
    this.add.text(GAME_W - 34, y - 1, "⚙", { fontSize: "24px", color: "#ffffff" }).setOrigin(0.5).setDepth(D + 1);
    s.on("pointerdown", () => this.openSettings());
  }

  // Level-select mode: false = Sequential (default), true = Any Level.
  private freeSelect(): boolean {
    try {
      return localStorage.getItem("pf_freeselect") === "1";
    } catch {
      return false;
    }
  }
  private setFreeSelect(v: boolean) {
    try {
      localStorage.setItem("pf_freeselect", v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }

  // ---- Settings popup -------------------------------------------------
  private openSettings() {
    const D = 400;
    const pw = 320;
    const ph = 346;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const progress = Math.max(1, this.readInt("pf_progress", 1));
    const objs: Phaser.GameObjects.GameObject[] = [];

    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0xf7edd0, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 20);
    panel.lineStyle(4, 0x8a5a12, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 20);
    objs.push(dim, panel);

    objs.push(
      this.add
        .text(GAME_W / 2, y0 + 28, "Settings", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "22px", color: "#6a4a12",
        })
        .setOrigin(0.5)
        .setDepth(D + 2),
      this.add
        .text(x0 + 22, y0 + 66, "Level Select", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#6a4a12",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
      this.add
        .text(x0 + 22, y0 + 88, "How you choose which level to play", {
          fontFamily: "Arial, sans-serif", fontSize: "12px", color: "#8a6a2a",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
    );

    // Two-option segmented toggle: Sequential | Any Level.
    const free = this.freeSelect();
    const segY = y0 + 128;
    const segW = (pw - 44 - 12) / 2;
    const segH = 46;
    const mkSeg = (bx: number, label: string, sub: string, on: boolean, onPick: () => void) => {
      const g = this.add.graphics().setDepth(D + 2);
      g.fillStyle(on ? 0x35b04a : 0xe4d3a3, 1);
      g.fillRoundedRect(bx, segY, segW, segH, 12);
      g.lineStyle(3, on ? 0x1f7d33 : 0xb79a5a, 1);
      g.strokeRoundedRect(bx, segY, segW, segH, 12);
      objs.push(g);
      objs.push(
        this.add
          .text(bx + segW / 2, segY + 15, label, {
            fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px",
            color: on ? "#ffffff" : "#6a4a12",
          })
          .setOrigin(0.5)
          .setDepth(D + 3),
        this.add
          .text(bx + segW / 2, segY + 33, sub, {
            fontFamily: "Arial, sans-serif", fontSize: "10px",
            color: on ? "#eafff0" : "#8a6a2a",
          })
          .setOrigin(0.5)
          .setDepth(D + 3),
      );
      const hit = this.add
        .rectangle(bx + segW / 2, segY + segH / 2, segW, segH, 0xffffff, 0.001)
        .setDepth(D + 4)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", onPick);
      objs.push(hit);
    };
    const close = () => objs.forEach((o) => o.destroy());
    // Picking a DIFFERENT mode saves it and rebuilds the map (locks update live).
    mkSeg(x0 + 22, "Sequential", "In order", !free, () => {
      if (!free) return close();
      this.setFreeSelect(false);
      this.scene.restart();
    });
    mkSeg(x0 + 22 + segW + 12, "Any Level", "Free pick", free, () => {
      if (free) return close();
      this.setFreeSelect(true);
      this.scene.restart();
    });

    // ---- Jump to a level by number --------------------------------------
    // Type any level number and start it straight away (handy for testing / replaying
    // far-ahead levels without scrolling the whole map). makeLevel() has a procedural
    // fallback, so every number 1..LEVEL_COUNT is playable even if it isn't hand-designed.
    objs.push(
      this.add
        .text(x0 + 22, segY + segH + 24, "Jump to Level", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#6a4a12",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
      this.add
        .text(x0 + 22, segY + segH + 44, `Type a number (1–${LEVEL_COUNT}) to start there`, {
          fontFamily: "Arial, sans-serif", fontSize: "12px", color: "#8a6a2a",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
    );

    const jumpY = segY + segH + 60;
    const jumpH = 46;
    const jumpW = pw - 44;
    const jumpG = this.add.graphics().setDepth(D + 2);
    jumpG.fillStyle(0x2f6fd0, 1);
    jumpG.fillRoundedRect(x0 + 22, jumpY, jumpW, jumpH, 12);
    jumpG.lineStyle(3, 0x1c4a94, 1);
    jumpG.strokeRoundedRect(x0 + 22, jumpY, jumpW, jumpH, 12);
    const jumpLabel = this.add
      .text(GAME_W / 2, jumpY + jumpH / 2, "✏  Enter Level Number", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(D + 3);
    const jumpHit = this.add
      .rectangle(x0 + 22 + jumpW / 2, jumpY + jumpH / 2, jumpW, jumpH, 0xffffff, 0.001)
      .setDepth(D + 4)
      .setInteractive({ useHandCursor: true });
    objs.push(jumpG, jumpLabel, jumpHit);
    jumpHit.on("pointerdown", () => {
      const raw = window.prompt(`Start at which level? (1–${LEVEL_COUNT})`, String(progress));
      if (raw == null) return; // cancelled
      const n = parseInt(raw.trim(), 10);
      if (!Number.isFinite(n) || n < 1 || n > LEVEL_COUNT) {
        this.toast(`Enter a number from 1 to ${LEVEL_COUNT}`);
        return;
      }
      close();
      this.scene.start("game", { level: n });
    });

    const closeBtn = this.add
      .text(GAME_W / 2, y0 + ph - 26, "CLOSE", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff",
        backgroundColor: "#8a5a12", padding: { x: 24, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(D + 3)
      .setInteractive({ useHandCursor: true });
    objs.push(closeBtn);
    closeBtn.on("pointerdown", close);
    dim.on("pointerdown", close);
  }

  private statPill(
    x: number,
    y: number,
    w: number,
    color: number,
    icon: string,
    value: string,
    tail: string,
    iconTextColor = "#ffffff",
    rim = 0xffffff,
    iconR = 15,
  ) {
    const D = 60;
    const g = this.add.graphics().setDepth(D);
    g.fillStyle(0x0e2f2b, 0.85);
    g.fillRoundedRect(x - w / 2, y - 17, w, 34, 17);
    g.lineStyle(2.5, 0xffe08a, 0.6);
    g.strokeRoundedRect(x - w / 2, y - 17, w, 34, 17);
    this.add.circle(x - w / 2 + 17, y, iconR, color).setStrokeStyle(2, rim, 0.85).setDepth(D + 1);
    if (icon)
      this.add
        .text(x - w / 2 + 17, y - 1, icon, {
          fontFamily: "Arial, sans-serif",
          fontStyle: "bold",
          fontSize: "15px",
          color: iconTextColor,
        })
        .setOrigin(0.5)
        .setDepth(D + 2);
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
  // A reward's icon (coin for Gold, booster sprite for Booster, both for Grand),
  // centred at (x,y) sized ~s. Returns created objects (for modal cleanup).
  private drawRewardIcon(
    x: number, y: number, s: number, reward: EventReward, depth: number,
  ): Phaser.GameObjects.GameObject[] {
    const out: Phaser.GameObjects.GameObject[] = [];
    const coin = (cx: number, cy: number, r: number) =>
      out.push(this.add.circle(cx, cy, r, 0xf9c22e).setStrokeStyle(Math.max(2, r * 0.2), 0xc98a10).setDepth(depth));
    const boosterImg = (cx: number, cy: number, size: number, key: string) => {
      if (this.textures.exists(`booster-${key}`)) out.push(this.add.image(cx, cy, `booster-${key}`).setDisplaySize(size, size).setDepth(depth));
      else coin(cx, cy, size * 0.5);
    };
    if (reward.kind === "gold") coin(x, y, s * 0.5);
    else if (reward.kind === "booster") boosterImg(x, y, s, reward.key);
    else {
      coin(x - s * 0.16, y, s * 0.42);
      boosterImg(x + s * 0.2, y, s * 0.66, reward.key);
    }
    return out;
  }

  // A clover medallion: dark disc + gold ring + 🍀 emoji, centred at (x,y).
  private drawCloverMedallion(x: number, y: number, r: number, depth: number): Phaser.GameObjects.GameObject[] {
    const g = this.add.graphics().setDepth(depth);
    g.fillStyle(0x1a3a1c, 1);
    g.fillCircle(x, y, r);
    g.lineStyle(3, 0xefd98a, 1);
    g.strokeCircle(x, y, r);
    const leaf = this.add.text(x, y + 1, CLOVER_ICON, { fontSize: `${Math.round(r * 1.15)}px` }).setOrigin(0.5).setDepth(depth + 1);
    return [g, leaf];
  }

  // ---- Lucky Clover event bar (Home) — "Sunny Banner" style ----------
  private buildEventBar() {
    const p = getProgress();
    const D = 74;
    const x0 = 10;
    const w = GAME_W - 20;
    const y0 = 100;
    const h = 74;

    // Card: soft shadow + forest-foliage green gradient (matches the bushes in the
    // background) + soft sunlit-gold border (matches the yellow flowers).
    const shadow = this.add.graphics().setDepth(D - 1);
    shadow.fillStyle(0x000000, 0.26);
    shadow.fillRoundedRect(x0, y0 + 5, w, h, 20);
    const card = this.add.graphics().setDepth(D);
    card.fillGradientStyle(0x4a7a3c, 0x4a7a3c, 0x2c5330, 0x2c5330, 1);
    card.fillRoundedRect(x0, y0, w, h, 20);
    card.lineStyle(3, 0xefd98a, 1);
    card.strokeRoundedRect(x0, y0, w, h, 20);
    card.lineStyle(1, 0xffffff, 0.14);
    card.strokeRoundedRect(x0 + 3, y0 + 3, w - 6, h - 6, 17);

    // Ribbon banner across the top edge (warm flower-yellow).
    const ribLabel = this.add
      .text(GAME_W / 2, y0, `${CLOVER_ICON}  LUCKY CLOVER  ${CLOVER_ICON}`, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "13px", color: "#33280c",
      })
      .setOrigin(0.5)
      .setDepth(D + 3);
    const rw = ribLabel.width + 34;
    const rh = 24;
    const rib = this.add.graphics().setDepth(D + 2);
    rib.fillStyle(0x000000, 0.22);
    rib.fillRoundedRect(GAME_W / 2 - rw / 2, y0 - rh / 2 + 3, rw, rh, rh / 2);
    rib.fillGradientStyle(0xf6d55a, 0xf6d55a, 0xe7bb3e, 0xe7bb3e, 1);
    rib.fillRoundedRect(GAME_W / 2 - rw / 2, y0 - rh / 2, rw, rh, rh / 2);
    rib.lineStyle(2, 0xfff2c8, 1);
    rib.strokeRoundedRect(GAME_W / 2 - rw / 2, y0 - rh / 2, rw, rh, rh / 2);
    ribLabel.setDepth(D + 3); // keep label above the ribbon fill

    // Clover medallion (left).
    const mx = x0 + 42;
    const my = y0 + 44;
    this.drawCloverMedallion(mx, my, 26, D + 1);

    // Middle: big count, pip bar, next-reward line.
    const textX = mx + 40;
    const chipCx = x0 + w - 40;
    const chipLeft = chipCx - 28;

    const big = this.add
      .text(textX, y0 + 28, p.done ? "DONE" : `${p.total}`, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "22px", color: "#fbfae8",
      })
      .setOrigin(0, 0.5)
      .setDepth(D + 2);
    this.add
      .text(textX + big.width + 6, y0 + 31, p.done ? "" : `/ ${p.next!.threshold}  ·  ${p.remaining} more`, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "12px", color: "#dcecc6",
      })
      .setOrigin(0, 0.5)
      .setDepth(D + 2);

    // Pip progress bar.
    const pipN = 12;
    const pipGap = 3;
    const pipsW = chipLeft - 8 - textX;
    const pipW = (pipsW - (pipN - 1) * pipGap) / pipN;
    const pipY = y0 + 45;
    const onCount = p.done ? pipN : Math.round(p.fraction * pipN);
    const pips = this.add.graphics().setDepth(D + 1);
    for (let i = 0; i < pipN; i++) {
      const px = textX + i * (pipW + pipGap);
      if (i < onCount) {
        pips.fillGradientStyle(0xf6d55a, 0xf6d55a, 0xe8b23a, 0xe8b23a, 1);
        pips.fillRoundedRect(px, pipY, pipW, 9, 4);
      } else {
        pips.fillStyle(0x0d2b12, 0.55);
        pips.fillRoundedRect(px, pipY, pipW, 9, 4);
      }
    }

    // Next-reward line.
    this.add
      .text(textX, y0 + 61, p.done ? "All rewards claimed!" : `Next: ${rewardLabel(p.next!.reward)}`, {
        fontFamily: "Arial, sans-serif", fontSize: "12px", color: "#e9f4d6",
      })
      .setOrigin(0, 0.5)
      .setDepth(D + 1);

    // Reward preview chip (right).
    const chip = this.add.graphics().setDepth(D + 1);
    chip.fillStyle(0x173318, 0.92);
    chip.fillRoundedRect(chipCx - 28, my - 28, 56, 56, 14);
    chip.lineStyle(2.5, 0xefd98a, 1);
    chip.strokeRoundedRect(chipCx - 28, my - 28, 56, 56, 14);
    if (!p.done) this.drawRewardIcon(chipCx, my, 40, p.next!.reward, D + 2);
    else this.add.text(chipCx, my, "🏆", { fontSize: "30px" }).setOrigin(0.5).setDepth(D + 2);

    // Whole card tappable → the reward roadmap.
    const hit = this.add
      .rectangle(x0 + w / 2, y0 + h / 2, w, h, 0xffffff, 0.001)
      .setDepth(D + 4)
      .setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => this.showEventRoadmap());
  }

  // A modal roadmap: a vertical ladder of milestone rewards with icons — claimed
  // (green ✓), the next one (glowing), and upcoming (locked).
  private showEventRoadmap() {
    const p = getProgress();
    const D = 400;
    const pw = 340;
    const ph = 468;
    const x0 = GAME_W / 2 - pw / 2;
    const y0 = GAME_H / 2 - ph / 2;
    const objs: Phaser.GameObjects.GameObject[] = [];

    const dim = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.62)
      .setDepth(D)
      .setInteractive();
    const panel = this.add.graphics().setDepth(D + 1);
    panel.fillStyle(0x1e3a20, 1);
    panel.fillRoundedRect(x0, y0, pw, ph, 22);
    panel.lineStyle(4, 0xefd98a, 1);
    panel.strokeRoundedRect(x0, y0, pw, ph, 22);
    objs.push(dim, panel);

    // Header medallion + title.
    const hx = x0 + 40;
    const hy = y0 + 38;
    objs.push(...this.drawCloverMedallion(hx, hy, 24, D + 2));
    objs.push(
      this.add.text(hx + 36, y0 + 26, EVENT_NAME.toUpperCase(), {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "18px", color: "#f4ecc6",
      }).setOrigin(0, 0.5).setDepth(D + 2),
      this.add.text(hx + 36, y0 + 48, `${p.total} ${CLOVER_ICON}  ·  ${p.claimed}/${MILESTONES.length} rewards`, {
        fontFamily: "Arial, sans-serif", fontSize: "12px", color: "#bfe0b0",
      }).setOrigin(0, 0.5).setDepth(D + 2),
    );

    // Ladder window around the current milestone.
    const start = Math.max(0, Math.min(p.claimed - 2, MILESTONES.length - 8));
    const rows = MILESTONES.slice(Math.max(0, start), Math.max(0, start) + 8);
    const nodeX = x0 + 42;
    const top = y0 + 84;
    const step = 42;

    // Connector line behind the nodes.
    const conn = this.add.graphics().setDepth(D + 2);
    conn.lineStyle(4, 0x2f5a33, 1);
    conn.lineBetween(nodeX, top, nodeX, top + (rows.length - 1) * step);
    objs.push(conn);

    rows.forEach((m, i) => {
      const ny = top + i * step;
      const claimed = m.index <= p.claimed;
      const isNext = m.index === p.claimed + 1;
      const ring = claimed ? 0x6fc24a : isNext ? 0xefd98a : 0x437049;
      const labelColor = claimed ? "#b6e6a4" : isNext ? "#f4ecc6" : "#a2c0a6";

      const node = this.add.graphics().setDepth(D + 3);
      node.fillStyle(0x122e17, 1); node.fillCircle(nodeX, ny, 17);
      node.lineStyle(3, ring, 1); node.strokeCircle(nodeX, ny, 17);
      objs.push(node);
      objs.push(...this.drawRewardIcon(nodeX, ny, 24, m.reward, D + 4));

      if (claimed) {
        const chk = this.add.text(nodeX + 13, ny - 13, "✓", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "13px", color: "#ffffff",
          backgroundColor: "#2f9f4a", padding: { x: 3, y: 0 },
        }).setOrigin(0.5).setDepth(D + 5);
        objs.push(chk);
      } else if (isNext) {
        const glow = this.add.circle(nodeX, ny, 22).setStrokeStyle(2, 0xefd98a, 0.7).setDepth(D + 3);
        this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.2, duration: 780, yoyo: true, repeat: -1 });
        objs.push(glow);
      }

      objs.push(
        this.add.text(nodeX + 32, ny - 8, rewardLabel(m.reward), {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "14px", color: labelColor,
        }).setOrigin(0, 0.5).setDepth(D + 3),
        this.add.text(nodeX + 32, ny + 9, claimed ? "Claimed" : `${m.threshold} ${CLOVER_ICON}`, {
          fontFamily: "Arial, sans-serif", fontSize: "11px", color: claimed ? "#7ab585" : "#92b498",
        }).setOrigin(0, 0.5).setDepth(D + 3),
      );
    });

    const close = this.add
      .text(GAME_W / 2, y0 + ph - 28, "CLOSE", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#33280c",
        backgroundColor: "#efd98a", padding: { x: 26, y: 9 },
      })
      .setOrigin(0.5)
      .setDepth(D + 4)
      .setInteractive({ useHandCursor: true });
    objs.push(close);
    const kill = () => objs.forEach((o) => o.destroy());
    close.on("pointerdown", kill);
    dim.on("pointerdown", kill);
  }

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
