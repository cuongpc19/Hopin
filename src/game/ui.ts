// Shared "juicy" UI button — glossy gradient body, top sheen, drop shadow, rounded
// border, a tap bounce, and an optional darker inner pill (for a price + coin), so the
// lose / heart screens read like a polished casual game instead of flat rectangles.
// Used by GameScene (revive + heart-cost confirm) and lives.ts (hearts modal).
import Phaser from "phaser";

const shade = (c: number, amt: number): number => {
  const r = Math.max(0, Math.min(255, ((c >> 16) & 0xff) + amt));
  const g = Math.max(0, Math.min(255, ((c >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (c & 0xff) + amt));
  return (r << 16) | (g << 8) | b;
};

export interface GlossyBtnCfg {
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
export function glossyButton(scene: Phaser.Scene, cfg: GlossyBtnCfg): Phaser.GameObjects.GameObject[] {
  const { x, y, w, h, label } = cfg;
  const enabled = cfg.enabled !== false;
  const d = cfg.depth ?? 402;
  const r = Math.min(h / 2, 22);
  const base = enabled ? cfg.fill : 0xa39b8c;
  const dark = enabled ? cfg.dark : 0x7d766a;
  const objs: Phaser.GameObjects.GameObject[] = [];

  const g = scene.add.graphics().setDepth(d);
  // Drop shadow / bottom rim (the button sits ON a darker slab, giving depth).
  g.fillStyle(shade(dark, -30), enabled ? 0.55 : 0.35);
  g.fillRoundedRect(x - w / 2, y - h / 2 + 6, w, h, r);
  g.fillStyle(dark, 1);
  g.fillRoundedRect(x - w / 2, y - h / 2 + 3, w, h, r);
  // Body: vertical gradient, lighter at the top.
  g.fillGradientStyle(shade(base, 46), shade(base, 46), shade(base, -22), shade(base, -22), 1);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
  // Border.
  g.lineStyle(3, dark, 1);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r);
  // Top sheen — a bright soft cap over the upper ~42%.
  g.fillStyle(0xffffff, 0.24);
  g.fillRoundedRect(x - w / 2 + 5, y - h / 2 + 4, w - 10, h * 0.42, { tl: r - 3, tr: r - 3, bl: 6, br: 6 });
  objs.push(g);

  const hasSub = !!cfg.sub;
  const labelY = hasSub ? y - h * 0.17 : y;
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
    const subY = y + h * 0.2;
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
