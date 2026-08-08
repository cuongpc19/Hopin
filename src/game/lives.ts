// Hearts (lives) — the soft gate on how much you can play in one sitting.
//
// Rules (user 2026-08-02):
//   • MAX 5 hearts. One regenerates every 5 minutes (offline time counts).
//   • A heart is spent on a FAILED attempt: losing and then choosing Replay/Home,
//     or quitting a level mid-run from Settings → Home (so bailing out when a loss
//     looks certain costs the same as losing).
//   • Revive does NOT touch hearts — it costs Coin and continues the same attempt.
//   • You need at least one heart in the bank to be playing: at 0 the game blocks
//     entry and offers "buy with Coin" or "wait for the refill".
//
// State lives in localStorage:
//   pf_lives       — hearts currently held (0..MAX)
//   pf_lives_next  — epoch ms when the NEXT heart lands (0 = full, no timer running)
//   pf_grace_until — epoch ms the free-play window ends (0 = never opened). See GRACE_MS.
import Phaser from "phaser";
import { t as tr, tf as trf } from "./i18n";
import { platform } from "../platform";

export const MAX_LIVES = 5;
export const REGEN_MS = 5 * 60 * 1000; // one heart per 5 minutes
export const HEART_PRICE = 150; // Coin for a single heart
export const REFILL_PRICE = 500; // Coin to top straight back up to MAX

// Free-play window opened the FIRST time a player runs out of hearts, on hosts
// that ask for it (platform.graceOnEmpty — web portals). Rationale: a drive-by web
// player who meets "out of hearts, wait 30 minutes" closes the tab and never
// returns, and the wall works against the one thing CrazyGames asks of a game —
// that players land in gameplay immediately. Once only, then the normal gate applies.
export const GRACE_MS = 60 * 60 * 1000; // one hour
const GRACE_KEY = "pf_grace_until";

function readInt(key: string, dflt: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? "", 10);
    return Number.isFinite(v) ? v : dflt;
  } catch {
    return dflt;
  }
}
function write(lives: number, nextAt: number) {
  try {
    localStorage.setItem("pf_lives", String(lives));
    localStorage.setItem("pf_lives_next", String(nextAt));
  } catch {
    /* storage unavailable — hearts stay in-memory for this session */
  }
}

// Apply any regeneration that came due (including while the game was closed) and
// return the settled state. Every read goes through here, so the timer is always
// consistent no matter how long the app was away.
function sync(): { lives: number; nextAt: number } {
  let lives = Phaser.Math.Clamp(readInt("pf_lives", MAX_LIVES), 0, MAX_LIVES);
  let nextAt = readInt("pf_lives_next", 0);
  const now = Date.now();
  if (lives >= MAX_LIVES) {
    nextAt = 0; // full → no timer
  } else if (nextAt <= 0) {
    nextAt = now + REGEN_MS; // missing timer (fresh save / edited storage) → start one
  } else if (nextAt > now + REGEN_MS) {
    nextAt = now + REGEN_MS; // clock jumped backwards → don't strand the player
  } else {
    while (lives < MAX_LIVES && now >= nextAt) {
      lives++;
      nextAt += REGEN_MS;
    }
    if (lives >= MAX_LIVES) nextAt = 0;
  }
  write(lives, nextAt);
  return { lives, nextAt };
}

export function getLives(): number {
  return sync().lives;
}

// Milliseconds until the next heart lands; 0 when hearts are full.
export function msToNextHeart(): number {
  const { lives, nextAt } = sync();
  if (lives >= MAX_LIVES || nextAt <= 0) return 0;
  return Math.max(0, nextAt - Date.now());
}

// "4:37" — countdown label for the heart pill.
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Spend one heart on a failed attempt. Returns the hearts left.
export function spendLife(): number {
  const { lives, nextAt } = sync();
  if (lives <= 0) return 0;
  const left = lives - 1;
  // Dropping below MAX for the first time starts the regen clock; an already
  // running clock keeps its schedule (a loss never delays the pending heart).
  write(left, lives >= MAX_LIVES ? Date.now() + REGEN_MS : nextAt);
  return left;
}

// ---- Free-play grace window ---------------------------------------------

/** Milliseconds left in the free-play window; 0 when it is closed or never opened. */
export function graceMsLeft(): number {
  if (!platform.graceOnEmpty) return 0;
  const until = readInt(GRACE_KEY, 0);
  if (until <= 0) return 0;
  return Math.max(0, until - Date.now());
}

/**
 * Can the player start a level right now?
 *
 * A heart in the bank is the normal answer. On a host with `graceOnEmpty`, the
 * FIRST time they run dry we open GRACE_MS of free play instead of showing a wall.
 *
 * ⚠ Calling this OPENS the window as a side effect, so call it at the gate and
 * nowhere else — use `graceMsLeft() > 0` for read-only checks (HUD, labels).
 */
export function canEnterLevel(): boolean {
  if (getLives() > 0) return true;
  if (!platform.graceOnEmpty) return false;

  const until = readInt(GRACE_KEY, 0);
  if (until > 0) return Date.now() < until; // opened before: still good, or spent
  try {
    localStorage.setItem(GRACE_KEY, String(Date.now() + GRACE_MS));
  } catch {
    return true; // no storage — let them play rather than strand them on a wall
  }
  return true;
}

export function addLives(n: number): number {
  const { lives, nextAt } = sync();
  const next = Phaser.Math.Clamp(lives + n, 0, MAX_LIVES);
  write(next, next >= MAX_LIVES ? 0 : nextAt);
  return next;
}

// ---- Shared hearts popup -------------------------------------------------
// Used by BOTH scenes (Home tap / out-of-hearts gate / a retry that spends the
// last heart), so the panel and its pricing only exist once.
export interface HeartsModalOpts {
  getGold: () => number;
  spendGold: (n: number) => void; // scene updates its own gold display
  onChanged?: () => void; // hearts or gold changed → refresh the caller's HUD
  onClose?: () => void;
  // Extra button under the buy options, e.g. "Home" on the out-of-hearts gate.
  extra?: { label: string; onTap: () => void };
}

export function showHeartsModal(scene: Phaser.Scene, opts: HeartsModalOpts) {
  const W = scene.scale.gameSize.width / scene.cameras.main.zoom;
  const H = scene.scale.gameSize.height / scene.cameras.main.zoom;
  const cx = W / 2;
  const D = 600; // above every other popup in either scene
  const out = getLives() <= 0;
  const pw = 300;
  const ph = opts.extra ? 320 : 274;
  const x0 = cx - pw / 2;
  const y0 = H / 2 - ph / 2;

  const objs: Phaser.GameObjects.GameObject[] = [];
  const dim = scene.add.rectangle(cx, H / 2, W, H, 0x000000, 0.6).setDepth(D).setInteractive();
  const panel = scene.add.graphics().setDepth(D + 1);
  panel.fillStyle(0xf7edd0, 1);
  panel.fillRoundedRect(x0, y0, pw, ph, 20);
  panel.lineStyle(4, 0x8a5a12, 1);
  panel.strokeRoundedRect(x0, y0, pw, ph, 20);
  objs.push(dim, panel);

  objs.push(
    scene.add
      .text(cx, y0 + 30, out ? tr("heartsOut") : tr("heartsTitle"), {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "21px", color: "#6a4a12",
      })
      .setOrigin(0.5)
      .setDepth(D + 2),
  );

  // Row of 5 hearts: held ones in full colour, spent ones greyed.
  const hearts: Phaser.GameObjects.GameObject[] = [];
  const drawHearts = () => {
    hearts.forEach((h) => h.destroy());
    hearts.length = 0;
    const lives = getLives();
    const step = 40;
    const sx = cx - ((MAX_LIVES - 1) * step) / 2;
    for (let i = 0; i < MAX_LIVES; i++) {
      const on = i < lives;
      if (scene.textures.exists("heart-icon")) {
        const im = scene.add.image(sx + i * step, y0 + 78, "heart-icon").setDepth(D + 2);
        im.setScale(30 / Math.max(im.width, im.height));
        if (!on) im.setTint(0x8f8f8f).setAlpha(0.5);
        hearts.push(im);
      } else {
        hearts.push(
          scene.add
            .text(sx + i * step, y0 + 78, "❤", { fontSize: "27px", color: on ? "#ef3f5a" : "#b8b0a0" })
            .setOrigin(0.5)
            .setDepth(D + 2),
        );
      }
    }
  };
  drawHearts();

  // Countdown line, ticking once a second while the panel is open.
  const info = scene.add
    .text(cx, y0 + 116, "", {
      fontFamily: "Arial, sans-serif", fontSize: "14px", color: "#6a4a12", align: "center",
      wordWrap: { width: pw - 44 },
    })
    .setOrigin(0.5)
    .setDepth(D + 2);
  objs.push(info);
  const refreshInfo = () => {
    // The free-play window takes priority: while it is open the refill timer is
    // not what the player needs to know — they can already play.
    const free = graceMsLeft();
    if (free > 0) {
      info.setText(trf("heartsFree", { t: formatCountdown(free) }));
      return;
    }
    const ms = msToNextHeart();
    info.setText(ms > 0 ? trf("heartsNext", { t: formatCountdown(ms) }) : tr("heartsFull"));
  };
  refreshInfo();
  const ticker = scene.time.addEvent({
    delay: 1000,
    loop: true,
    callback: () => {
      refreshInfo();
      drawHearts(); // a heart may have just landed
    },
  });

  const mkBtn = (by: number, label: string, fill: number, edge: number, onTap: () => void, enabled = true) => {
    const bw = pw - 56;
    const bh = 42;
    const g = scene.add.graphics().setDepth(D + 2);
    g.fillStyle(enabled ? fill : 0xa39b8c, 1);
    g.fillRoundedRect(cx - bw / 2, by - bh / 2, bw, bh, 12);
    g.lineStyle(3, enabled ? edge : 0x8a8375, 1);
    g.strokeRoundedRect(cx - bw / 2, by - bh / 2, bw, bh, 12);
    const tx = scene.add
      .text(cx, by, label, {
        fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(D + 3);
    objs.push(g, tx);
    if (!enabled) return;
    const hit = scene.add
      .rectangle(cx, by, bw, bh, 0xffffff, 0.001)
      .setDepth(D + 4)
      .setInteractive({ useHandCursor: true });
    hit.on("pointerdown", onTap);
    objs.push(hit);
  };

  // silent = tear down WITHOUT the onClose branch — used by the extra button, which
  // takes the player somewhere specific of its own.
  const close = (silent = false) => {
    ticker.remove();
    hearts.forEach((h) => h.destroy());
    objs.forEach((o) => o.destroy());
    if (!silent) opts.onClose?.();
  };

  const full = getLives() >= MAX_LIVES;
  const buy = (n: number, price: number) => {
    if (opts.getGold() < price) {
      // Not enough Coin — say so on the info line rather than closing the panel.
      info.setText(trf("needGold", { n: price }));
      return;
    }
    opts.spendGold(price);
    addLives(n);
    drawHearts();
    refreshInfo();
    opts.onChanged?.();
    if (getLives() >= MAX_LIVES) close(); // topped up → nothing left to do here
  };
  mkBtn(y0 + 156, trf("heartsBuy1", { n: HEART_PRICE }), 0x35b04a, 0x1f7d33, () => buy(1, HEART_PRICE), !full);
  mkBtn(y0 + 206, trf("heartsBuyFull", { n: REFILL_PRICE }), 0xd98a2b, 0xa5610f, () => buy(MAX_LIVES, REFILL_PRICE), !full);
  if (opts.extra) {
    mkBtn(y0 + 256, opts.extra.label, 0x6d7b8a, 0x49525d, () => {
      close(true);
      opts.extra!.onTap();
    });
  }

  const closeBtn = scene.add
    .text(cx, y0 + ph - 22, tr("close"), {
      fontFamily: "Arial, sans-serif", fontStyle: "bold", fontSize: "15px", color: "#8a5a12",
    })
    .setOrigin(0.5)
    .setDepth(D + 3)
    .setInteractive({ useHandCursor: true });
  objs.push(closeBtn);
  closeBtn.on("pointerdown", close);
  dim.on("pointerdown", close);
}
