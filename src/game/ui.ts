// Shared UI button, drawn as a KEYCAP — the same material as the tiles on the board.
//
// Redrawn 2026-08-08 (user: the Revive / Replay / Home row "xấu quá", wants something
// simple with a bit of 3D "như ô vuông trong level"). The old version stacked a vertical
// gradient, a drop shadow, a 3px border and a big top sheen; four competing highlights on
// one small button is what made it look cheap.
//
// The board tile recipe is three flat steps and nothing else (GameScene.makeTileTexture):
//   1. a slightly darker slab, shade(colour, 0.82)
//   2. the pure flat colour on top of it, inset, sitting high so the slab shows as a lip
//   3. one small soft gloss bar near the top
// Copying it exactly means a button reads as the same object family as the tiles.
//
// Used by GameScene: the lose screen's Revive / Replay / Home row, and the Play-again and
// Go-Home confirm dialogs. (The hearts modal in lives.ts still draws its own flat buttons —
// worth pointing at this once someone is looking at that screen.)
import Phaser from "phaser";
import { shade as mul } from "./palette";

const shade = (c: number, amt: number): number => {
  const r = Math.max(0, Math.min(255, ((c >> 16) & 0xff) + amt));
  const g = Math.max(0, Math.min(255, ((c >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (c & 0xff) + amt));
  return (r << 16) | (g << 8) | b;
};

export interface TileBtnCfg {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  fill: number; // base colour, e.g. green 0x35b04a
  dark: number; // border + shadow colour, e.g. 0x1f7d33
  onClick?: () => void;
  enabled?: boolean;
  depth?: number;
  fontSize?: number;
  sub?: string; // optional inner-pill text under the label, e.g. "900"
  coin?: boolean; // draw a little coin after the sub text
}

// Returns the created objects (already depth-sorted) so the caller can collect them
// into its own teardown list.
export function tileButton(scene: Phaser.Scene, cfg: TileBtnCfg): Phaser.GameObjects.GameObject[] {
  const { x, y, w, h, label } = cfg;
  const enabled = cfg.enabled !== false;
  const d = cfg.depth ?? 402;
  // A keycap, not a capsule: the tiles round at ~24% of their side, so the radius follows
  // the height rather than halving it. h/2 turned every button into a pill.
  const r = Math.min(Math.round(h * 0.28), 18);
  const base = enabled ? cfg.fill : 0xa39b8c;
  const dark = enabled ? cfg.dark : 0x7d766a;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const LIP = Math.max(4, Math.round(h * 0.13)); // slab left showing below the face = the 3D
  // Text centres on the FACE, which sits LIP/2 above the middle of the whole button —
  // centring on `y` would leave every label looking low.
  const faceY = y - LIP / 2 + 1;

  const g = scene.add.graphics().setDepth(d);
  // 1. The slab. Same 0.82 multiplier the tiles use, so the depth reads identically.
  g.fillStyle(mul(base, 0.82), 1);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
  // 2. The face: pure flat colour, inset a hair on the sides and sitting high, so the slab
  //    is left showing along the bottom. That single lip is the whole 3D effect.
  g.fillStyle(base, 1);
  g.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 2, w - 6, h - LIP - 2, r * 0.9);
  // 3. One soft gloss bar near the top — the tile's only highlight, and the only one here.
  g.fillStyle(0xffffff, 0.18);
  g.fillRoundedRect(x - w / 2 + 12, y - h / 2 + 7, (w - 24) * 0.52, Math.max(5, h * 0.16), h * 0.09);
  objs.push(g);

  const hasSub = !!cfg.sub;
  const labelY = hasSub ? faceY - h * 0.17 : faceY;
  const fs = cfg.fontSize ?? Math.round((hasSub ? h * 0.3 : h * 0.36));
  objs.push(
    scene.add
      .text(x, labelY, label, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: `${fs}px`,
        color: enabled ? "#ffffff" : "#efe9dc",
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(d + 1)
  );

  if (hasSub) {
    // Inner darker pill holding the price (+ optional coin), like "900 🪙".
    const subFs = Math.round(h * 0.26);
    const subY = faceY + h * 0.2;
    const coinR = cfg.coin ? subFs * 0.55 : 0;
    const t = scene.add
      .text(x + (cfg.coin ? -coinR - 3 : 0), subY, cfg.sub!, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: `${subFs}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(d + 2);
    const pillW = t.width + (cfg.coin ? coinR * 2 + 12 : 22);
    const pillH = subFs + 10;
    const pg = scene.add.graphics().setDepth(d + 1);
    pg.fillStyle(shade(dark, -14), 0.9);
    pg.fillRoundedRect(x - pillW / 2, subY - pillH / 2, pillW, pillH, pillH / 2);
    objs.push(pg, t);
    if (cfg.coin) {
      const cg = scene.add.graphics().setDepth(d + 2);
      const cxp = x + t.width / 2 + 4;
      cg.fillStyle(0xffcf3f, 1);
      cg.fillCircle(cxp, subY, coinR);
      cg.lineStyle(2, 0xd79a1e, 1);
      cg.strokeCircle(cxp, subY, coinR);
      cg.fillStyle(0xffe98a, 1);
      cg.fillCircle(cxp - coinR * 0.28, subY - coinR * 0.28, coinR * 0.32);
      objs.push(cg);
    }
  }

  if (enabled && cfg.onClick) {
    const hit = scene.add
      .rectangle(x, y, w, h + 6, 0xffffff, 0.001)
      .setDepth(d + 3)
      .setInteractive({ useHandCursor: true });
    hit.on("pointerdown", () => {
      scene.tweens.add({ targets: objs, y: "+=3", duration: 70, yoyo: true, ease: "Quad.out" });
      cfg.onClick!();
    });
    objs.push(hit);
  }
  return objs;
}
