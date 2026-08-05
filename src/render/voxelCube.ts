/**
 * voxelCube.ts — draw one pixel-art cell as a raised candy block.
 *
 * SELF-CONTAINED. No imports, no framework, no build step: a Canvas 2D context is the only thing
 * it needs. Copy this file into any project and call `drawVoxelPainting`.
 *
 *   drawVoxelPainting(ctx, grid, palette, cellPx)
 *
 * `grid[row][col]` is an index into `palette`, or `null` for an empty cell.
 *
 * ── What you get ───────────────────────────────────────────────────────────────────────────
 * Every cell becomes a rounded block with a flat top ("lid"), a darker front face, a bright bevel
 * on the top/left edges and a dark one on the bottom/right, plus a soft cast shadow down-right.
 * The light is fixed at top-left. All of it is derived from ONE base colour per cell — there is no
 * texture, no asset, and no per-pixel sampling.
 *
 * ── Two rules you cannot break ─────────────────────────────────────────────────────────────
 * 1. PAINT TOP TO BOTTOM. A block's lid reaches UP into the row above it, so a lower row must be
 *    drawn after (over) the row above it. `drawVoxelPainting` already does this; if you write your
 *    own loop, keep the order.
 * 2. A BLOCK PAINTS OUTSIDE ITS OWN CELL — up by `voxelFrontOverlap(h)`, right and down by the
 *    cast shadow. If you ever erase, fade or redraw a SINGLE cell, you must cover that overhang
 *    too, or you leave a permanent streak of the old block behind. `voxelHaloPixels()` computes
 *    exactly which pixels those are. See PLAYBOOK.md §6.
 *
 * Provenance: extracted 2026-08-05 from AntFlow ("Crab Cove"), `src/sim/voxelCube.ts` on branch
 * `ant-crazygames-native`. Every constant below is a value that was tuned by eye and signed off —
 * PLAYBOOK.md §8 says which knob does what. Do not "tidy" the numbers.
 */

/** `[r, g, b]`, each 0..255. */
export type RGB = [number, number, number];

/** Supersample factor used when baking a tile sprite (draw at N×, downscale once). */
export const VOXEL_SUPERSAMPLE = 2;

/* ══ canvas factory ═════════════════════════════════════════════════════════════════════════
 * The sprite cache needs to create offscreen canvases. In a browser that is `document`; in Node,
 * a worker, or an engine with its own canvas type, hand us a factory instead. Only the CACHED
 * paths use this — `drawVoxelCube` and `drawVoxelPainting` never allocate.
 */
export interface VoxelCanvas {
  width: number;
  height: number;
  getContext(id: '2d', opts?: { willReadFrequently?: boolean }): CanvasRenderingContext2D | null;
}

let canvasFactory: (() => VoxelCanvas) | null = null;

/** Override how offscreen sprite canvases are created (Node, OffscreenCanvas, engine-specific). */
export function setVoxelCanvasFactory(fn: (() => VoxelCanvas) | null): void {
  canvasFactory = fn;
  clearTileSpriteCache();
}

function makeCanvas(): VoxelCanvas {
  if (canvasFactory) return canvasFactory();
  if (typeof document === 'undefined') {
    throw new Error('voxelCube: no document — call setVoxelCanvasFactory() first');
  }
  return document.createElement('canvas') as unknown as VoxelCanvas;
}

/* ══ colour ═════════════════════════════════════════════════════════════════════════════════ */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Shift every channel by `amt` (may be negative), clamped to a byte.
 *
 * THIS IS THE WHOLE LIGHTING MODEL. Every face, bevel and shadow below is `shadeColor(base, k)`
 * for some k in [-96, +84]. An equal shift on all three channels keeps the hue and the saturation
 * ratio intact, so a face reads as "the same colour, lit differently". Multiplying instead
 * (`c * 0.7`) drags saturated colours toward grey and the block stops looking like one material.
 */
export function shadeColor(base: RGB, amt: number): RGB {
  return [clamp255(base[0] + amt), clamp255(base[1] + amt), clamp255(base[2] + amt)];
}

function rgbStr(c: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/* ══ geometry contract ══════════════════════════════════════════════════════════════════════
 * Three pure functions describing how far a block paints outside its own cell. They are the
 * SINGLE SOURCE OF TRUTH: the painter, the sprite cache and any per-cell erase/fade all read
 * them, so changing the look in one place cannot desync the others.
 */

/**
 * Height of the front face — which is also how far the lid reaches UP into the row above.
 * `0.2 * cellH` is the "puffy" look; raise it for a chunkier block, lower it for a flatter one.
 */
// KHÁC BẢN GỐC (2026-08-05): hằng 0.2 tách ra thành biến chỉnh được, để thử độ dày thân mà
// không phải sửa mã. `voxelLidStripPx` gọi chính hàm này nên dải halo tự bám theo — đúng luật
// "đổi chiều cao mặt trước thì phải đổi dải halo" ở PLAYBOOK §6.2. Bóng đổ không phụ thuộc
// hằng này nên `voxelShadowSpillPx` giữ nguyên.
let FRONT_RATIO = 0.2;
/** Đổi tỉ lệ chiều cao mặt trước (mặc định 0.2 = look "puffy" gốc). Cao hơn = khối dày hơn. */
export function setVoxelFrontRatio(r: number): void {
  FRONT_RATIO = Math.max(0.05, Math.min(0.6, r));
}
export function voxelFrontOverlap(cellH: number): number {
  return Math.max(1.4, cellH * FRONT_RATIO);
}

/**
 * Whole-pixel strip a tile of height `tileH` may paint ABOVE its own top edge.
 * `+1` covers the sub-pixel `gap` inset and the antialiasing fringe, so a region you redraw is
 * never a hair short. Over-covering costs nothing; under-covering leaves a visible streak.
 */
export function voxelLidStripPx(tileH: number): number {
  return Math.ceil(voxelFrontOverlap(tileH)) + 1;
}

/**
 * Whole-pixel spill of the cast shadow past a `w×h` cell's RIGHT and BOTTOM edges.
 *
 * ⚠️ MUST stay in step with the cast-shadow block inside `drawVoxelCube` (`sox`/`soy` and the
 * penumbra rect). The penumbra's right edge is `x + w - gap + 1.1*sox`, its bottom edge is
 * `y + h - gap + soy`; we ignore the `gap` inset as safety margin and add `+1` for AA fringe.
 * Change the shadow, change this, in the same commit.
 */
export function voxelShadowSpillPx(w: number, h: number): { right: number; bottom: number } {
  const m = Math.min(w, h);
  const sox = Math.max(0.9, m * 0.11);
  const soy = Math.max(1.1, m * 0.15);
  return { right: Math.ceil(1.1 * sox) + 1, bottom: Math.ceil(soy) + 1 };
}

/**
 * Every pixel a single tile touches OUTSIDE its own cell, plus the rectangle that bounds tile +
 * overhang. Use this when you erase, fade or redraw one cell in place.
 *
 * - `bbox` = `[x, y, w, h]` of the cell, in canvas px.
 * - `canvasW`/`canvasH` clamp the result to the canvas (a tile flush against an edge simply has
 *   no halo on that side). `canvasW` is also the row stride for the returned flat indices
 *   (`y * canvasW + x`), matching an `ImageData.data` layout.
 * - `ss` (optional) — if your pixel buffer is supersampled by an integer factor, pass it: the
 *   bbox stays in unscaled px and the result comes back in buffer px.
 *
 * Returns `rect` (redraw/upload bounds) and `haloPix` (rect MINUS the cell itself — the cell's own
 * pixels you presumably already handle).
 *
 * ⚠️ The margins are the 1× margins MULTIPLIED by `ss` — never recomputed at the scaled height.
 * Recomputing rounds the other way and UNDER-covers by a pixel or two, which is exactly the
 * streak this whole contract exists to prevent.
 */
export function voxelHaloPixels(
  bbox: readonly [number, number, number, number],
  canvasW: number,
  canvasH: number,
  ss = 1,
): { haloPix: number[]; rect: readonly [number, number, number, number] } {
  const [bx0, by0, bw0, bh0] = bbox;
  const stripH = voxelLidStripPx(bh0) * ss;
  const spill0 = voxelShadowSpillPx(bw0, bh0);
  const bx = bx0 * ss;
  const by = by0 * ss;
  const bw = bw0 * ss;
  const bh = bh0 * ss;
  const pw = canvasW * ss;
  const ph = canvasH * ss;
  const x0 = Math.max(0, bx);
  const y0 = Math.max(0, by - stripH);
  const x1 = Math.min(pw, bx + bw + spill0.right * ss);
  const y1 = Math.min(ph, by + bh + spill0.bottom * ss);
  const haloPix: number[] = [];
  for (let y = y0; y < y1; y++) {
    const inBboxRows = y >= by && y < by + bh;
    for (let x = x0; x < x1; x++) {
      if (inBboxRows && x >= bx && x < bx + bw) continue; // the cell's own footprint
      haloPix.push(y * pw + x);
    }
  }
  const rect = [x0, y0, x1 - x0, y1 - y0] as const;
  return { haloPix, rect };
}

/* ══ the painter ════════════════════════════════════════════════════════════════════════════ */

/**
 * Draw ONE block. `x,y,w,h` is the NOMINAL cell rect; the block painted is taller than that —
 * it reaches up by `voxelFrontOverlap(h)` and its shadow spills right/down (see above).
 *
 * Draw order is a contract: shadow first (the body covers its own umbra), then the groove, then
 * everything else clipped to the rounded body, then the outer stroke last. PLAYBOOK.md §4 lists
 * every step and what each constant changes visually.
 */
export function drawVoxelCube(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: RGB,
): void {
  const m = Math.min(w, h);
  const overlap = voxelFrontOverlap(h);
  const frontH = overlap;
  // Visual rect: the lid reaches into the row above; the front sits at the bottom of this cell.
  const vx = x;
  const vy = y - overlap;
  const vw = w;
  const vh = h + overlap;

  // Seam between neighbouring blocks. Tighter = less muddy when the canvas is upscaled.
  const gap = Math.max(0.2, Math.min(0.55, m * 0.02));
  const bx = vx + gap;
  const by = vy + gap;
  const bw = vw - gap * 2;
  const bh = vh - gap * 2;
  if (bw <= 0 || bh <= 0) return;

  // Corner radius. 0.2 is the "puffy candy" read; drop toward 0.07 for a hard-edged voxel.
  const r = Math.max(0.3, Math.min(bw, bh) * 0.2);
  const lidH = bh - frontH;
  const frontY = by + lidH;
  const rim = Math.max(0.7, Math.min(bw, Math.max(lidH, 1)) * 0.11);

  // ── 1. Cast shadow ────────────────────────────────────────────────────────────────────────
  // Light is top-left, so the shadow falls down-right and peeks past this cell onto its
  // neighbours. Drawn BEFORE the body so the block covers its own umbra.
  // ⚠️ Any change to sox/soy or the penumbra rect MUST update `voxelShadowSpillPx`.
  {
    const sox = Math.max(0.9, m * 0.11);
    const soy = Math.max(1.1, m * 0.15);
    c.fillStyle = 'rgba(35,24,14,0.16)'; // soft outer penumbra
    c.beginPath();
    c.roundRect(bx + sox * 0.55, by + soy * 0.55, bw + sox * 0.55, bh + soy * 0.45, r * 1.05);
    c.fill();
    c.fillStyle = 'rgba(28,18,10,0.28)'; // tighter, darker core umbra
    c.beginPath();
    c.roundRect(bx + sox, by + soy, bw * 0.98, bh * 0.96, r);
    c.fill();
  }

  // ── 2. Groove ─────────────────────────────────────────────────────────────────────────────
  // Under the OWN cell footprint only (not the upward lip): the separation line that keeps two
  // adjacent blocks of the SAME colour from reading as one slab.
  c.fillStyle = rgbStr(shadeColor(base, -52));
  c.beginPath();
  c.roundRect(x + gap * 0.5, y + gap * 0.5, w - gap, h - gap, Math.max(0.3, r * 0.85));
  c.fill();

  c.save();
  c.beginPath();
  c.roundRect(bx, by, bw, bh, r);
  c.clip();

  // ── 3. Front face ─────────────────────────────────────────────────────────────────────────
  const frontGrad = c.createLinearGradient(bx, frontY, bx, by + bh);
  frontGrad.addColorStop(0, rgbStr(shadeColor(base, -26)));
  frontGrad.addColorStop(0.4, rgbStr(shadeColor(base, -48)));
  frontGrad.addColorStop(1, rgbStr(shadeColor(base, -70)));
  c.fillStyle = frontGrad;
  c.fillRect(bx, frontY, bw, frontH);

  // ── 4. Front side lighting — left catches light, right falls away ─────────────────────────
  const sideW = Math.min(bw * 0.18, Math.max(1.1, rim * 1.1));
  const leftFront = c.createLinearGradient(bx, frontY, bx + sideW, frontY);
  leftFront.addColorStop(0, rgbStr(shadeColor(base, -6), 0.55));
  leftFront.addColorStop(1, rgbStr(shadeColor(base, -6), 0));
  c.fillStyle = leftFront;
  c.fillRect(bx, frontY, sideW, frontH);

  const rightFront = c.createLinearGradient(bx + bw, frontY, bx + bw - sideW, frontY);
  rightFront.addColorStop(0, rgbStr(shadeColor(base, -85), 0.78));
  rightFront.addColorStop(1, rgbStr(shadeColor(base, -85), 0));
  c.fillStyle = rightFront;
  c.fillRect(bx + bw - sideW, frontY, sideW, frontH);

  // ── 5. Shelf crease where the lid meets the front ─────────────────────────────────────────
  const shelf = c.createLinearGradient(bx, frontY - 0.5, bx, frontY + Math.min(3.2, frontH));
  shelf.addColorStop(0, 'rgba(0,0,0,0)');
  shelf.addColorStop(0.2, 'rgba(0,0,0,0.38)');
  shelf.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = shelf;
  c.fillRect(bx, frontY - 0.5, bw, Math.min(3.5, frontH + 0.5));

  // ── 6. Thin lit line at the very top of the front ─────────────────────────────────────────
  c.fillStyle = rgbStr(shadeColor(base, 30), 0.4);
  c.fillRect(bx, frontY, bw, Math.max(0.55, frontH * 0.1));

  // ── 7. Bottom bounce light — light reflecting back up onto the lip ────────────────────────
  {
    const blh = Math.max(0.8, Math.min(frontH * 0.55, 3.2));
    const bl = c.createLinearGradient(bx, by + bh, bx, by + bh - blh);
    bl.addColorStop(0, rgbStr(shadeColor(base, 46), 0.6));
    bl.addColorStop(0.6, rgbStr(shadeColor(base, 24), 0.28));
    bl.addColorStop(1, rgbStr(shadeColor(base, 24), 0));
    c.fillStyle = bl;
    c.fillRect(bx, by + bh - blh, bw, blh);
  }

  // ── 8. Top lid ────────────────────────────────────────────────────────────────────────────
  // Skipped on a block too short to have a readable lid — it would be all bevel and no face.
  if (lidH > 1.5) {
    c.fillStyle = rgbStr(shadeColor(base, 4)); // base fill, a touch brighter than the front
    c.fillRect(bx, by, bw, lidH);

    // Pillow: a broad soft dome, off-centre toward the light.
    const cx = bx + bw * 0.38;
    const cy = by + lidH * 0.36;
    const pillowR = Math.max(bw, lidH) * 0.85;
    const pillow = c.createRadialGradient(cx, cy, 0, cx, cy, pillowR);
    pillow.addColorStop(0, rgbStr(shadeColor(base, 28), 0.21));
    pillow.addColorStop(0.45, rgbStr(shadeColor(base, 8), 0.09));
    pillow.addColorStop(0.8, rgbStr(base, 0));
    pillow.addColorStop(1, rgbStr(shadeColor(base, -22), 0.2));
    c.fillStyle = pillow;
    c.fillRect(bx, by, bw, lidH);

    // The lid darkens toward its own bottom edge, where it turns into the front face.
    const lidFall = c.createLinearGradient(bx, by, bx, by + lidH);
    lidFall.addColorStop(0, 'rgba(0,0,0,0)');
    lidFall.addColorStop(0.7, 'rgba(0,0,0,0)');
    lidFall.addColorStop(1, 'rgba(0,0,0,0.2)');
    c.fillStyle = lidFall;
    c.fillRect(bx, by, bw, lidH);

    // Four bevel rims: bright top/left, dark bottom/right. The mid stop sits late (0.5..0.68) so
    // the bevel reads as a defined edge rather than a wide soft blend.
    const rimT = Math.min(rim, lidH * 0.38);
    const rimL = Math.min(rim, bw * 0.38);
    const rimB = Math.min(rim * 0.95, lidH * 0.3);
    const rimR = Math.min(rim * 1.1, bw * 0.4);

    const topRim = c.createLinearGradient(bx, by, bx, by + rimT);
    topRim.addColorStop(0, rgbStr(shadeColor(base, 84), 0.72));
    topRim.addColorStop(0.62, rgbStr(shadeColor(base, 35), 0.35));
    topRim.addColorStop(1, rgbStr(shadeColor(base, 35), 0));
    c.fillStyle = topRim;
    c.fillRect(bx, by, bw, rimT);

    const leftRim = c.createLinearGradient(bx, by, bx + rimL, by);
    leftRim.addColorStop(0, rgbStr(shadeColor(base, 58), 0.62));
    leftRim.addColorStop(0.68, rgbStr(shadeColor(base, 22), 0.28));
    leftRim.addColorStop(1, rgbStr(shadeColor(base, 22), 0));
    c.fillStyle = leftRim;
    c.fillRect(bx, by, rimL, lidH);

    const botRim = c.createLinearGradient(bx, by + lidH, bx, by + lidH - rimB);
    botRim.addColorStop(0, rgbStr(shadeColor(base, -78), 0.85));
    botRim.addColorStop(0.5, rgbStr(shadeColor(base, -35), 0.35));
    botRim.addColorStop(1, rgbStr(shadeColor(base, -35), 0));
    c.fillStyle = botRim;
    c.fillRect(bx, by + lidH - rimB, bw, rimB);

    const rightRim = c.createLinearGradient(bx + bw, by, bx + bw - rimR, by);
    rightRim.addColorStop(0, rgbStr(shadeColor(base, -96), 0.92));
    rightRim.addColorStop(0.68, rgbStr(shadeColor(base, -45), 0.45));
    rightRim.addColorStop(1, rgbStr(shadeColor(base, -45), 0));
    c.fillStyle = rightRim;
    c.fillRect(bx + bw - rimR, by, rimR, lidH);

    // Broad convex sheen — THIS is what makes the lid read as rounded rather than flat.
    {
      const px = bx + bw * 0.5;
      const py = by + lidH * 0.3;
      const pR = Math.max(bw, lidH) * 0.72;
      const sheen = c.createRadialGradient(px, py, 0, px, py, pR);
      sheen.addColorStop(0, 'rgba(255,255,255,0.39)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sheen;
      c.fillRect(bx, by, bw, lidH);
    }

    // Small specular dot on top of the sheen — a crisp highlight point, not more haze.
    const glossR = Math.min(bw, lidH) * 0.2;
    const gx = bx + bw * 0.28;
    const gy = by + lidH * 0.26;
    const gloss = c.createRadialGradient(gx, gy, 0, gx, gy, glossR);
    gloss.addColorStop(0, 'rgba(255,255,255,0.3)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gloss;
    c.beginPath();
    c.arc(gx, gy, glossR, 0, Math.PI * 2);
    c.fill();
  }

  c.restore();

  // ── 9. Outer stroke — keeps each block's silhouette defined when the canvas is upscaled ────
  c.strokeStyle = rgbStr(shadeColor(base, -70), 0.36);
  c.lineWidth = Math.max(0.35, m * 0.022);
  c.beginPath();
  c.roundRect(bx + c.lineWidth / 2, by + c.lineWidth / 2, bw - c.lineWidth, bh - c.lineWidth, r);
  c.stroke();
}

/**
 * Draw a whole grid, row by row, TOP TO BOTTOM so each lower block occludes the one above it.
 *
 * Cell edges are rounded to whole pixels (`round(col * cellPx)` .. `round((col+1) * cellPx)`)
 * rather than each cell being `cellPx` wide: with a fractional `cellPx` that keeps neighbouring
 * blocks flush instead of accumulating a sub-pixel drift into visible cracks.
 *
 * Draws every block directly — right for a ONE-OFF bake. If you repaint every frame, or repaint
 * regions often, use `drawVoxelPaintingCached` instead.
 */
export function drawVoxelPainting(
  c: CanvasRenderingContext2D,
  grid: (number | null)[][],
  palette: RGB[],
  cellPx: number,
): void {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0]!.length : 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = grid[row]![col]!;
      if (idx === null || idx === undefined) continue;
      const cx0 = Math.round(col * cellPx);
      const cy0 = Math.round(row * cellPx);
      const cx1 = Math.round((col + 1) * cellPx);
      const cy1 = Math.round((row + 1) * cellPx);
      drawVoxelCube(c, cx0, cy0, cx1 - cx0, cy1 - cy0, palette[idx]!);
    }
  }
}

/* ══ sprite cache ═══════════════════════════════════════════════════════════════════════════
 * One block costs ~8 gradients and a dozen fills. But its rendering depends ONLY on
 * (width, height, colour) — and a pixel-art grid has very few distinct combinations (usually one
 * or two sizes × a handful of palette entries). So rasterize each unique block ONCE and blit it
 * from then on. Measured on the source project: rebuilding a region went from ~1-2.5 ms to
 * ~0.1 ms.
 */

const tileSpriteCache = new Map<string, { cv: VoxelCanvas; top: number }>();
const tileSprite1xCache = new Map<string, { cv: VoxelCanvas; top: number }>();
const TILE_SPRITE_CACHE_MAX = 300;

/** Rasterize one block at scale `f` into its own canvas, including the overhang. */
function tileSprite(w: number, h: number, color: RGB, f: number): { cv: VoxelCanvas; top: number } {
  const key = `${f}|${w}x${h}|${color[0]},${color[1]},${color[2]}`;
  const hit = tileSpriteCache.get(key);
  if (hit) return hit;
  if (tileSpriteCache.size >= TILE_SPRITE_CACHE_MAX) tileSpriteCache.clear();
  // Full visual footprint: lid overhangs UP, shadow spills RIGHT/BOTTOM, nothing goes left.
  const top = voxelLidStripPx(h);
  const spill = voxelShadowSpillPx(w, h);
  const cv = makeCanvas();
  cv.width = Math.ceil((w + spill.right) * f);
  cv.height = Math.ceil((top + h + spill.bottom) * f);
  // `willReadFrequently` keeps the sprite CPU-rasterized. GPU and CPU canvas antialiasing differ
  // visibly at these edges (measured alpha 210 vs 179 on the same lid pixel), so a GPU-rasterized
  // sprite blitted into a CPU pixel buffer diverges from a direct draw by more than gradient
  // rounding noise. Drop this flag only if you never read the pixels back.
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(f, 0, 0, f, 0, top * f);
  drawVoxelCube(ctx, 0, 0, w, h, color);
  const s = { cv, top };
  tileSpriteCache.set(key, s);
  return s;
}

/**
 * A 1× sprite, baked at `VOXEL_SUPERSAMPLE`× and high-quality-downscaled ONCE.
 *
 * Why not just draw at 1×: the bevels and the stroke are sub-pixel features, and rasterizing them
 * at 2× before downscaling keeps them crisp instead of muddy. Why not keep everything at 2×: then
 * every consumer pays the downscale. Baking it here means every later draw is a plain blit AND
 * every draw of the same block is byte-identical — which matters if you ever compare or blend two
 * renders of the same region.
 */
function tileSprite1x(w: number, h: number, color: RGB): { cv: VoxelCanvas; top: number } {
  const key = `${w}x${h}|${color[0]},${color[1]},${color[2]}`;
  const hit = tileSprite1xCache.get(key);
  if (hit) return hit;
  if (tileSprite1xCache.size >= TILE_SPRITE_CACHE_MAX) tileSprite1xCache.clear();
  const hi = tileSprite(w, h, color, VOXEL_SUPERSAMPLE);
  const cv = makeCanvas();
  cv.width = Math.max(1, Math.round(hi.cv.width / VOXEL_SUPERSAMPLE));
  cv.height = Math.max(1, Math.round(hi.cv.height / VOXEL_SUPERSAMPLE));
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    hi.cv as unknown as CanvasImageSource,
    0, 0, hi.cv.width, hi.cv.height,
    0, 0, cv.width, cv.height,
  );
  const s = { cv, top: hi.top };
  tileSprite1xCache.set(key, s);
  return s;
}

/** Drop every cached sprite (after changing a constant, or to bound memory). */
export function clearTileSpriteCache(): void {
  tileSpriteCache.clear();
  tileSprite1xCache.clear();
}

let warnedScaled = false;

/**
 * Blitting bitmaps into a scaled context resamples them and softens every bevel — the one mistake
 * that makes the cached path look worse than the direct one for no obvious reason. It is silent
 * otherwise, so say it once. Skipped where `getTransform` is unavailable.
 */
function warnIfScaled(c: CanvasRenderingContext2D): void {
  if (warnedScaled || typeof c.getTransform !== 'function') return;
  const t = c.getTransform();
  if (Math.abs(t.a - 1) < 1e-6 && Math.abs(t.d - 1) < 1e-6 && !t.b && !t.c) return;
  warnedScaled = true;
  // eslint-disable-next-line no-console
  console.warn(
    `voxelCube: drawVoxelPaintingCached() called on a context scaled ${t.a}x${t.d}. Sprites will ` +
      'be resampled and the bevels will look soft. Use drawVoxelPainting() for a zoomed view, or ' +
      'raise cellPx / pass an integer `scale`.',
  );
}

/**
 * Same picture as `drawVoxelPainting`, but every block is blitted from the sprite cache instead of
 * being drawn from scratch. Use this when you repaint often.
 *
 * ⚠️ THE CONTEXT MUST BE AT 1:1. These are BITMAPS sized to the cell's own pixel size, so a
 * scaled/zoomed context resamples them and the result is visibly soft — the crisp bevels are the
 * whole point of the look. If you want the picture bigger, either raise `cellPx` (more pixels per
 * cell, still 1:1) or pass an integer `scale` so the supersampled sprites are blitted at that
 * factor. For a zoomed inspection view, use `drawVoxelPainting` instead — it is vector-drawn and
 * stays sharp at any transform.
 *
 * Not byte-identical to `drawVoxelPainting`: compositing pre-downscaled sprites differs from
 * downscaling a composite at the 1-2px seams where a block's lid/shadow overlaps its neighbour.
 * Measured on a 4x3 grid at 14px: 36% of bytes differ, mean delta 3/255, max 41 at seam pixels —
 * indistinguishable by eye. If you need two renders of the same region to match EXACTLY (e.g. you
 * blend between them), use one path for both, not one each.
 */
export function drawVoxelPaintingCached(
  c: CanvasRenderingContext2D,
  grid: (number | null)[][],
  palette: RGB[],
  cellPx: number,
  scale = 1,
): void {
  warnIfScaled(c);
  const rows = grid.length;
  const cols = rows > 0 ? grid[0]!.length : 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = grid[row]![col]!;
      if (idx === null || idx === undefined) continue;
      const cx0 = Math.round(col * cellPx);
      const cy0 = Math.round(row * cellPx);
      const w = Math.round((col + 1) * cellPx) - cx0;
      const h = Math.round((row + 1) * cellPx) - cy0;
      const color = palette[idx]!;
      if (scale === 1) {
        const s = tileSprite1x(w, h, color);
        c.drawImage(s.cv as unknown as CanvasImageSource, cx0, cy0 - s.top);
      } else {
        const s = tileSprite(w, h, color, VOXEL_SUPERSAMPLE);
        const dw = (w + voxelShadowSpillPx(w, h).right) * scale;
        const dh = (voxelLidStripPx(h) + h + voxelShadowSpillPx(w, h).bottom) * scale;
        c.drawImage(
          s.cv as unknown as CanvasImageSource,
          0, 0, s.cv.width, s.cv.height,
          cx0 * scale, (cy0 - s.top) * scale, dw, dh,
        );
      }
    }
  }
}
