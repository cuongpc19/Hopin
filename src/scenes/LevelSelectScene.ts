import Phaser from "phaser";
import { t as tr, tf as trf, getLang, setLang, type Lang } from "../game/i18n";
import { getLives, msToNextHeart, formatCountdown, showHeartsModal } from "../game/lives";
import { GAME_W, GAME_H, setPageBackground } from "./GameScene";
import { levelDifficulty } from "../game/level";
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

// Home screen (redesign 2026-08-01, user): BỎ bản đồ dây-level cuộn — nền là bức tranh
// background2 (xe vàng + slime giữa rừng), dưới xe có Ô LEVEL hiển thị level hiện tại
// (tap = chơi luôn, nút PLAY bên dưới vẫn giữ). Tier HARD/SUPER hiện tag ở ô + banner
// cảnh báo khi vào level (GameScene.showTierBanner).
export class LevelSelectScene extends Phaser.Scene {
  private gold = 0;
  private viewTop = 0;
  private heartTx?: Phaser.GameObjects.Text; // hearts held (top-bar pill)
  private goldTx?: Phaser.GameObjects.Text; // Coin held — refreshed after buying hearts
  private heartTimerTx?: Phaser.GameObjects.Text; // countdown to the next heart

  constructor() {
    super("select");
  }

  preload() {
    this.load.image("background", "art/background.png"); // shared theme background
    this.load.image("background2", "art/background2.jpg"); // Home mới: xe + slime giữa rừng (user 2026-08-01)
    this.load.image("avatar", "art/slime-3.png"); // a cute face for the profile chip
    this.load.image("star-icon", "art/star.png"); // xu sao — icon vàng thống nhất (user 2026-08-01)
    this.load.image("heart-icon", "art/heart.png?v=1"); // trái tim (lives) — art thật thay emoji ❤
    // Start-nav mascot. Placeholder for now → swap to the real cute-slime art when ready.
    this.load.image("start-slime", "art/slime-3.png");
    // Nav icons (user 2026-08-02): nút Shop & Cup đã cắt-viền tròn, thay emoji 🛒/🏆.
    this.load.image("nav-shop", "art/nav-shop.png");
    this.load.image("nav-trophy", "art/nav-trophy.png");
    // Lucky Clover event: booster sprites for the reward previews (clover drawn/emoji).
    for (const b of ["add", "hand", "refresh", "magnet"]) this.load.image(`booster-${b}`, `art/booster-${b}.png`);
  }

  create() {
    const dpr = this.scale.gameSize.width / GAME_W;
    this.cameras.main.setZoom(dpr);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
    // Home keeps the leafy green in the letterbox / safe-area bands, matching the forest
    // art (the play screen swaps it for the checkerboard tone — see GameScene.create).
    setPageBackground(0xbfe3a0);

    this.gold = this.readInt("pf_gold", 0);
    const progress = Math.max(1, this.readInt("pf_progress", 1));
    // WHERE the player currently is (may be below the highest unlocked, e.g. after a reset
    // or replaying an earlier level). Home features THIS level. Falls back to progress for
    // players from before pf_current existed. (user 2026-07-31)
    const current = Phaser.Math.Clamp(this.readInt("pf_current", progress), 1, LEVEL_COUNT);

    // Lucky Clover event bar sits under the top bar when active.
    const showEvent = isEventUnlocked() && !isEventComplete();
    this.viewTop = showEvent ? 194 : 88;
    void this.viewTop; // giữ lại cho các popup sau này định vị
    void progress; // tiến độ cao nhất vẫn lưu pf_progress (Ô LEVEL hiển thị pf_current)

    this.buildBackground();
    this.buildTopBar();
    this.buildStage(current);
    // Nút PLAY riêng đã BỎ — Ô LEVEL (buildStage) đã tap-để-chơi (user 2026-08-01).
    this.buildBottomNav();
    if (showEvent) this.buildEventBar();
  }

  // ---- Background -----------------------------------------------------
  private buildBackground() {
    // background2: tranh sáng (xe + slime giữa rừng) — COVER toàn màn (crop 2 bên),
    // chỉ vignette nhẹ trên/dưới cho HUD với nav nổi chữ, KHÔNG phủ veil tối.
    const key = this.textures.exists("background2") ? "background2" : "background";
    // Đẩy tranh (xe + slime) LÊN một chút để Ô LEVEL bên dưới không che gầm xe
    // (user 2026-08-01). Đáy lộ ra ≤ RAISE bị thanh nav (cao 74) che nên không hở.
    const RAISE = 50;
    const img = this.add.image(GAME_W / 2, GAME_H / 2 - RAISE, key).setDepth(-100);
    const sc = Math.max(GAME_W / img.width, GAME_H / img.height);
    img.setScale(sc);
    // Top shade so the HUD row keeps its contrast over the bright forest art. It used to
    // be a flat 64px rectangle, whose bottom edge cut a hard line straight across the
    // picture and read as a "filter band" (user 2026-08-02); it's now a soft fade that
    // dissolves into the art with no visible seam. The matching band along the BOTTOM is
    // gone entirely — the nav bar there is fully opaque and already covers that strip, so
    // all the rectangle ever contributed was a 10px lip peeking out above it.
    const vig = this.add.graphics().setDepth(-98);
    const FADE_H = 96;
    const STEPS = 24;
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS; // 0 at the very top → 1 where the fade ends
      vig.fillStyle(0x0a2410, 0.34 * (1 - t) * (1 - t)); // ease out, so the tail is invisible
      vig.fillRect(0, (FADE_H * i) / STEPS, GAME_W, FADE_H / STEPS + 1); // +1: no hairline gaps
    }
  }

  // ---- Sân khấu Home (user 2026-08-01: BỎ dây level/bản đồ cuộn) ------------
  // Nền background2 đã có sẵn xe + slime giữa rừng; dưới xe là Ô LEVEL (pill vàng
  // "LEVEL N", tap = chơi luôn) + tag 🔥HARD/💀SUPER khi level hiện tại thuộc tier đó.
  private buildStage(current: number) {
    const D = 40;
    const d = levelDifficulty(current);
    const px = GAME_W / 2;
    const py = GAME_H * 0.755; // ngay dưới gầm xe trong ảnh nền
    const label = `LEVEL ${current}`;
    const t = this.add
      .text(px, py, label, {
        fontFamily: '"Lilita One", "Arial Black", Arial, sans-serif',
        fontSize: "30px",
        color: "#ffffff",
        stroke: "#8a5a12",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    const w = Math.max(196, t.width + 56);
    const h = 56;
    const g = this.add.graphics().setDepth(D);
    g.fillStyle(0xb9760d, 1);
    g.fillRoundedRect(px - w / 2, py - h / 2 + 4, w, h, 18); // đế nổi khối
    g.fillStyle(0xf9c22e, 1);
    g.fillRoundedRect(px - w / 2, py - h / 2, w, h, 18);
    g.fillStyle(0xffd95e, 0.8); // gloss nửa trên (đồng bộ banner màn thắng)
    g.fillRoundedRect(px - w / 2 + 5, py - h / 2 + 4, w - 10, 24, 12);
    g.lineStyle(3, 0xfff0c0, 0.9);
    g.strokeRoundedRect(px - w / 2, py - h / 2, w, h, 18);
    this.tweens.add({ targets: t, scale: 1.05, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });

    // tag tier ngay dưới ô — cùng ngôn ngữ với banner cảnh báo trong GameScene
    if (d !== "normal") {
      const tag = this.add
        .text(px, py + h / 2 + 17, d === "superhard" ? tr("tagSuper") : tr("tagHard"), {
          fontFamily: "Arial, sans-serif",
          fontStyle: "bold",
          fontSize: "14px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setDepth(D + 2);
      const tw = tag.width + 22;
      const tg = this.add.graphics().setDepth(D + 1);
      tg.fillStyle(d === "superhard" ? 0xd11e5e : 0xe06a12, 1);
      tg.fillRoundedRect(px - tw / 2, py + h / 2 + 6, tw, 22, 11);
      tg.lineStyle(2, 0xffffff, 0.9);
      tg.strokeRoundedRect(px - tw / 2, py + h / 2 + 6, tw, 22, 11);
    }

    const hit = this.add
      .rectangle(px, py, w, h, 0xffffff, 0.001)
      .setDepth(D + 3)
      .setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => {
      if (!this.canPlay()) return;
      this.tweens.add({ targets: t, scale: 0.9, duration: 90, yoyo: true, onComplete: () => this.scene.start("game", { level: current }) });
    });
  }


  // ---- Top bar --------------------------------------------------------
  private buildTopBar() {
    const y = 46;
    const D = 60;
    // Avatar góc trái = con slime Ở GIỮA nav (start-slime), không khung xanh (user 2026-08-02).
    this.add.image(42, y, "start-slime").setDisplaySize(54, 54).setDepth(D + 1);

    this.heartTx = this.statPill(150, y, 120, 0xef3f5a, "❤", String(getLives()), "", "#ffffff", 0xffffff, 15, true);
    // Countdown chip under the pill — only while hearts are regenerating.
    this.heartTimerTx = this.add
      .text(150, y + 30, "", {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "13px",
        color: "#ffffff", stroke: "#8a2a2a", strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(D + 2);
    this.refreshHearts();
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refreshHearts() });
    this.add
      .rectangle(150, y, 120, 40, 0xffffff, 0.001)
      .setDepth(D + 3)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.openHearts());
    // Gold coin: a slightly bigger golden disc with a dark-gold rim, no letter.
    // Wider pill so multi-digit gold never overflows on phone (user 2026-08-02). Value centred.
    this.goldTx = this.statPill(334, y, 158, 0xf9c22e, "", String(this.gold), "＋", "#8a5a10", 0xc98a10, 17, true);

    const s = this.add
      .circle(GAME_W - 34, y, 22, 0xe23b3b, 1) // đỏ như gear trong game (user 2026-08-02)
      .setStrokeStyle(3, 0xffffff, 0.95)
      .setDepth(D)
      .setInteractive({ useHandCursor: true });
    this.add.text(GAME_W - 34, y - 1, "⚙", { fontSize: "24px", color: "#ffffff" }).setOrigin(0.5).setDepth(D + 1);
    s.on("pointerdown", () => this.openSettings());
  }

  // Keep the hearts pill and its countdown in step with the regen clock.
  private refreshHearts() {
    const n = getLives();
    this.heartTx?.setText(String(n));
    const ms = msToNextHeart();
    this.heartTimerTx?.setText(ms > 0 ? formatCountdown(ms) : "");
  }

  // The hearts panel (info + buy). Shared with GameScene so pricing lives in one place.
  private openHearts() {
    showHeartsModal(this, {
      getGold: () => this.gold,
      spendGold: (n) => {
        this.gold = Math.max(0, this.gold - n);
        try { localStorage.setItem("pf_gold", String(this.gold)); } catch { /* ignore */ }
        this.goldTx?.setText(String(this.gold));
      },
      onChanged: () => this.refreshHearts(),
    });
  }

  // Gate every route into a level: you need a heart in the bank to play. At 0 the
  // hearts panel opens instead (buy with Coin, or watch the refill timer).
  private canPlay(): boolean {
    if (getLives() > 0) return true;
    this.openHearts();
    return false;
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
    const ph = 412;
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
        .text(GAME_W / 2, y0 + 28, tr("selSettings"), {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "22px", color: "#6a4a12",
        })
        .setOrigin(0.5)
        .setDepth(D + 2),
      this.add
        .text(x0 + 22, y0 + 66, tr("selMode"), {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#6a4a12",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
      this.add
        .text(x0 + 22, y0 + 88, tr("selModeSub"), {
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
    mkSeg(x0 + 22, tr("seqTitle"), tr("seqSub"), !free, () => {
      if (!free) return close();
      this.setFreeSelect(false);
      this.scene.restart();
    });
    mkSeg(x0 + 22 + segW + 12, tr("anyTitle"), tr("anySub"), free, () => {
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
        .text(x0 + 22, segY + segH + 24, tr("jump"), {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#6a4a12",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
      this.add
        .text(x0 + 22, segY + segH + 44, trf("jumpSub", { n: LEVEL_COUNT }), {
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
      .text(GAME_W / 2, jumpY + jumpH / 2, tr("enterLevel"), {
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
      const raw = window.prompt(trf("jumpPrompt", { n: LEVEL_COUNT }), String(progress));
      if (raw == null) return; // cancelled
      const n = parseInt(raw.trim(), 10);
      if (!Number.isFinite(n) || n < 1 || n > LEVEL_COUNT) {
        this.toast(trf("jumpRange", { n: LEVEL_COUNT }));
        return;
      }
      close();
      if (!this.canPlay()) return;
      this.scene.start("game", { level: n });
    });

    // ---- Language (user 2026-08-02): Tiếng Việt (default) | English ------
    const langY = jumpY + jumpH + 18;
    objs.push(
      this.add
        .text(x0 + 22, langY + 8, "Ngôn ngữ / Language", {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "16px", color: "#6a4a12",
        })
        .setOrigin(0, 0.5)
        .setDepth(D + 2),
    );
    const lY = langY + 24;
    const mkLang = (bx: number, label: string, on: boolean, pick: Lang) => {
      const g = this.add.graphics().setDepth(D + 2);
      g.fillStyle(on ? 0x35b04a : 0xe4d3a3, 1);
      g.fillRoundedRect(bx, lY, segW, 40, 12);
      g.lineStyle(3, on ? 0x1f7d33 : 0xb79a5a, 1);
      g.strokeRoundedRect(bx, lY, segW, 40, 12);
      const tx = this.add
        .text(bx + segW / 2, lY + 20, label, {
          fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px",
          color: on ? "#ffffff" : "#6a4a12",
        })
        .setOrigin(0.5)
        .setDepth(D + 3);
      const hit = this.add
        .rectangle(bx + segW / 2, lY + 20, segW, 40, 0xffffff, 0.001)
        .setDepth(D + 4)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        if (getLang() === pick) return;
        setLang(pick);
        this.scene.restart(); // redraw the whole Home in the new language
      });
      objs.push(g, tx, hit);
    };
    mkLang(x0 + 22, "Tiếng Việt", getLang() === "vi", "vi");
    mkLang(x0 + 22 + segW + 12, "English", getLang() === "en", "en");

    const closeBtn = this.add
      .text(GAME_W / 2, y0 + ph - 26, tr("closeCaps"), {
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
    centerVal = false, // căn GIỮA value trong khoảng phải của icon (dùng cho ô Tim)
  ): Phaser.GameObjects.Text {
    const D = 60;
    const g = this.add.graphics().setDepth(D);
    // Pill GỖ như trong game (user 2026-08-02): đáy tối → thân gỗ → đỉnh bắt sáng + viền sẫm.
    const px = x - w / 2, py = y - 20, pph = 40; // pill cao hơn (user 2026-08-02)
    g.fillStyle(0x5e3d1e, 1); g.fillRoundedRect(px, py, w, pph, 20); // đáy gỗ tối
    g.fillStyle(0x9c6a3a, 1); g.fillRoundedRect(px + 2, py + 2, w - 4, pph - 5, 18); // thân gỗ chủ đạo
    g.fillStyle(0xc79a6b, 0.85); g.fillRoundedRect(px + 3, py + 3, w - 6, 13, 9); // đỉnh bắt sáng
    g.lineStyle(2.5, 0x4a2f16, 1); g.strokeRoundedRect(px, py, w, pph, 20); // viền gỗ sẫm
    // Pill VÀNG (icon rỗng) → dùng ảnh XU SAO thay đĩa vẽ tay (user 2026-08-01)
    const heartImg = icon === "❤" && this.textures.exists("heart-icon");
    if (!icon && this.textures.exists("star-icon")) {
      const st = this.add.image(x - w / 2 + 17, y, "star-icon").setDepth(D + 1);
      st.setScale((iconR * 2.15) / Math.max(st.width, st.height));
    } else if (heartImg) {
      const ht = this.add.image(x - w / 2 + 17, y, "heart-icon").setDepth(D + 1);
      ht.setScale((iconR * 1.95) / Math.max(ht.width, ht.height)); // real heart art (a touch smaller so it sits inside the pill)
    } else {
      this.add.circle(x - w / 2 + 17, y, iconR, color).setStrokeStyle(2, rim, 0.85).setDepth(D + 1);
    }
    if (icon && !heartImg)
      this.add
        .text(x - w / 2 + 17, y - 1, icon, {
          fontFamily: "Arial, sans-serif",
          fontStyle: "bold",
          fontSize: "15px",
          color: iconTextColor,
        })
        .setOrigin(0.5)
        .setDepth(D + 2);
    let valueTx: Phaser.GameObjects.Text;
    if (centerVal) {
      // căn GIỮA số trong vùng giữa icon và mép phải — né nút "+" nếu có tail
      const rightB = tail === "＋" || tail === "+" ? x + w / 2 - 32 : x + w / 2 - 8;
      const vx = (x - w / 2 + 17 + iconR + rightB) / 2;
      valueTx = this.add
        .text(vx, y, value, { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "18px", color: "#ffffff" })
        .setOrigin(0.5, 0.5)
        .setDepth(D + 2);
    } else {
      valueTx = this.add
        .text(x - w / 2 + 36, y, value, { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "18px", color: "#ffffff" })
        .setOrigin(0, 0.5)
        .setDepth(D + 2);
    }
    if (tail === "＋" || tail === "+") {
      // Nút "+" XANH bóng như trong game (thay chữ ＋)
      const tx = x + w / 2 - 15;
      this.add.circle(tx, y + 1, 12, 0x3f9b45).setDepth(D + 1); // đế xanh đậm
      this.add.circle(tx, y, 12, 0x5cb85c).setStrokeStyle(2, 0xffffff, 0.95).setDepth(D + 1);
      this.add.text(tx, y - 1, "+", { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "18px", color: "#ffffff" }).setOrigin(0.5).setDepth(D + 2);
    } else {
      this.add
        .text(x + w / 2 - 14, y, tail, { fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "13px", color: "#ffffff" })
        .setOrigin(0.5)
        .setDepth(D + 2);
    }
    return valueTx;
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
    // Icon art thật (nút Shop/Cup đã cắt-viền tròn) thay emoji 🛒/🏆 (user 2026-08-02).
    const items: Array<[number, string, boolean]> = [
      [GAME_W * 0.2, "nav-shop", false],
      [GAME_W * 0.5, "start-slime", true],
      [GAME_W * 0.8, "nav-trophy", false],
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
        if (this.textures.exists(icon)) this.add.image(x, y, icon).setDisplaySize(50, 50).setDepth(D + 2);
        else this.add.text(x, y, icon, { fontSize: "34px" }).setOrigin(0.5).setDepth(D + 2);
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
      .text(GAME_W / 2, y0, `${CLOVER_ICON}  ${tr("cloverTitle")}  ${CLOVER_ICON}`, {
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
      .text(textX, y0 + 28, p.done ? tr("done") : `${p.total}`, {
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
      .text(textX, y0 + 61, p.done ? tr("allClaimed") : trf("nextReward", { r: rewardLabel(p.next!.reward) }), {
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
        this.add.text(nodeX + 32, ny + 9, claimed ? tr("claimed") : `${m.threshold} ${CLOVER_ICON}`, {
          fontFamily: "Arial, sans-serif", fontSize: "11px", color: claimed ? "#7ab585" : "#92b498",
        }).setOrigin(0, 0.5).setDepth(D + 3),
      );
    });

    const close = this.add
      .text(GAME_W / 2, y0 + ph - 28, tr("closeCaps"), {
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
