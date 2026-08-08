/**
 * voxelCube.test.ts — the geometry contract, tested without a canvas.
 *
 * These 11 tests cover ONLY the pure functions (`voxelLidStripPx`, `voxelShadowSpillPx`,
 * `voxelHaloPixels`), so they run anywhere vitest runs: no DOM, no canvas, no fixtures.
 *
 * WHY THEY MATTER MORE THAN THEY LOOK: they pin how far a block paints outside its own cell. Get
 * that wrong and nothing crashes — you just get a permanent smear of an erased block left on the
 * canvas, at some sizes only, which is a miserable bug to chase. If you tune the shadow or the
 * front-face height in voxelCube.ts, these go red immediately and tell you what to fix.
 *
 * Runner: vitest (`npx vitest run voxelCube.test.ts`). For jest, swap the import line for
 * `@jest/globals` — nothing else uses vitest-specific API.
 */
import { describe, it, expect } from 'vitest';
import { voxelLidStripPx, voxelShadowSpillPx, voxelHaloPixels } from './voxelCube';

describe('voxelLidStripPx', () => {
  it('is a whole-pixel ceil of the overlap plus a 1px AA margin', () => {
    // voxelFrontOverlap(h) = max(1.4, 0.2h).
    // voxelFrontOverlap(20) = max(1.4, 4) = 4 -> ceil 4 -> +1 = 5
    expect(voxelLidStripPx(20)).toBe(5);
    // voxelFrontOverlap(8) = max(1.4, 1.6) = 1.6 -> ceil 2 -> +1 = 3
    expect(voxelLidStripPx(8)).toBe(3);
    // Tiny cell clamps to the 1.4 floor -> ceil 2 -> +1 = 3
    expect(voxelLidStripPx(1)).toBe(3);
  });
});

describe('voxelShadowSpillPx', () => {
  it('matches the drawVoxelCube shadow constants for a 17px cell', () => {
    // m=17: sox = max(0.9, 1.87) = 1.87 -> right = ceil(1.1*1.87 = 2.057)+1 = 4
    //       soy = max(1.1, 2.55) = 2.55 -> bottom = ceil(2.55)+1 = 4
    expect(voxelShadowSpillPx(17, 17)).toEqual({ right: 4, bottom: 4 });
  });

  it('clamps to the sox/soy floors on tiny cells', () => {
    // m=5: sox = max(0.9, 0.55) = 0.9 -> right = ceil(0.99)+1 = 2
    //      soy = max(1.1, 0.75) = 1.1 -> bottom = ceil(1.1)+1 = 3
    expect(voxelShadowSpillPx(5, 5)).toEqual({ right: 2, bottom: 3 });
  });

  it('uses min(w, h) like the painter does', () => {
    expect(voxelShadowSpillPx(5, 100)).toEqual(voxelShadowSpillPx(5, 5));
    expect(voxelShadowSpillPx(100, 5)).toEqual(voxelShadowSpillPx(5, 5));
  });
});

describe('voxelHaloPixels', () => {
  it('ring covers up-strip AND right/bottom shadow margins, excluding the bbox itself', () => {
    const bbox: [number, number, number, number] = [5, 10, 10, 20];
    const canvasW = 100;
    const canvasH = 100;
    const { haloPix, rect } = voxelHaloPixels(bbox, canvasW, canvasH);
    // stripH = voxelLidStripPx(20) = 5; spill(10,20): m=10 -> right = ceil(1.21)+1 = 3,
    // bottom = ceil(1.5)+1 = 3. rect = [5, 5, 10+3, (10+20+3)-5] = [5, 5, 13, 28].
    expect(rect).toEqual([5, 5, 13, 28]);
    // halo = rect area minus bbox area.
    expect(haloPix.length).toBe(13 * 28 - 10 * 20);
    const set = new Set(haloPix);
    // The cell's own footprint is excluded — the caller already handles those pixels.
    expect(set.has(15 * canvasW + 10)).toBe(false); // inside bbox
    // Up-strip row included.
    expect(set.has(5 * canvasW + 5)).toBe(true);
    // Right shadow margin included (bbox rows, cols 15..17).
    expect(set.has(15 * canvasW + 15)).toBe(true);
    expect(set.has(15 * canvasW + 17)).toBe(true);
    expect(set.has(15 * canvasW + 18)).toBe(false); // past the right margin
    // Bottom shadow margin included (rows 30..32).
    expect(set.has(32 * canvasW + 5)).toBe(true);
    expect(set.has(33 * canvasW + 5)).toBe(false); // past the bottom margin
    // No pixel inside the bbox ever appears.
    for (const idx of haloPix) {
      const x = idx % canvasW;
      const y = Math.floor(idx / canvasW);
      const inBbox = x >= 5 && x < 15 && y >= 10 && y < 30;
      expect(inBbox).toBe(false);
    }
  });

  it('clamps to an empty up-strip when the bbox is flush against row 0 (top edge)', () => {
    const { haloPix, rect } = voxelHaloPixels([5, 0, 10, 8], 100, 200);
    // spill(10,8): m=8 -> right = ceil(0.968)+1 = 2, bottom = ceil(1.2)+1 = 3.
    expect(rect).toEqual([5, 0, 12, 11]);
    expect(haloPix.length).toBe(12 * 11 - 10 * 8);
    for (const idx of haloPix) {
      expect(Math.floor(idx / 100)).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps the right/bottom margins at the canvas right/bottom edges', () => {
    const canvasW = 20;
    const canvasH = 25;
    // bbox flush against BOTH the right (12+8=20) and bottom (20+5=25) edges: no right/bottom halo
    // survives the clamp; only the up-strip remains.
    const { haloPix, rect } = voxelHaloPixels([12, 20, 8, 5], canvasW, canvasH);
    // stripH = voxelLidStripPx(5) = ceil(max(1.4, 1.0))+1 = 3.
    expect(rect).toEqual([12, 17, 8, 8]);
    expect(haloPix.length).toBe(3 * 8); // strip rows 17..19 only
    for (const idx of haloPix) {
      const x = idx % canvasW;
      const y = Math.floor(idx / canvasW);
      expect(x).toBeGreaterThanOrEqual(12);
      expect(x).toBeLessThan(canvasW);
      expect(y).toBeGreaterThanOrEqual(17);
      expect(y).toBeLessThan(20);
    }
  });

  // ── supersampled pixel buffers (ss > 1) ───────────────────────────────────────────────────
  it('ss scales the rect, the margins and the row stride — bbox stays in unscaled px', () => {
    const bbox: [number, number, number, number] = [5, 10, 10, 20];
    const one = voxelHaloPixels(bbox, 100, 100);
    const two = voxelHaloPixels(bbox, 100, 100, 2);
    // rect = the 1x rect scaled: [5,5,13,28] -> [10,10,26,56].
    expect(two.rect).toEqual([one.rect[0] * 2, one.rect[1] * 2, one.rect[2] * 2, one.rect[3] * 2]);
    expect(two.haloPix.length).toBe(26 * 56 - 20 * 40);
    // Indices stride canvasW*ss, and none of them land inside the SCALED bbox.
    const pw = 200;
    for (const idx of two.haloPix) {
      const x = idx % pw;
      const y = Math.floor(idx / pw);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThan(36);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThan(66);
      expect(x >= 10 && x < 30 && y >= 20 && y < 60).toBe(false);
    }
  });

  it('ss margins NEVER under-cover what the scaled tile paints (the streak invariant)', () => {
    // The rule the implementation must hold: margins are the 1x ones x ss, which is always >= the
    // margin recomputed AT the scaled size. Recomputing rounds short and leaves a streak. Checked
    // across every cell size a real grid is likely to use.
    for (let cell = 3; cell <= 40; cell++) {
      for (const ss of [2, 3]) {
        const scaled = voxelHaloPixels([10, 10, cell, cell], 200, 200, ss);
        const naive = voxelHaloPixels([10 * ss, 10 * ss, cell * ss, cell * ss], 200 * ss, 200 * ss, 1);
        // Same left edge; the scaled version must start no LOWER and end no EARLIER than naive.
        expect(scaled.rect[1]).toBeLessThanOrEqual(naive.rect[1]);
        expect(scaled.rect[0] + scaled.rect[2]).toBeGreaterThanOrEqual(naive.rect[0] + naive.rect[2]);
        expect(scaled.rect[1] + scaled.rect[3]).toBeGreaterThanOrEqual(naive.rect[1] + naive.rect[3]);
      }
    }
  });

  it('ss = 1 is the historical result, argument present or not', () => {
    const a = voxelHaloPixels([5, 10, 10, 20], 100, 100);
    const b = voxelHaloPixels([5, 10, 10, 20], 100, 100, 1);
    expect(b.rect).toEqual(a.rect);
    expect(b.haloPix).toEqual(a.haloPix);
  });

  it('clamps a bbox near (not at) the top-left corner without negative indices', () => {
    // by=2, stripH = voxelLidStripPx(20) = 5 -> the strip top clamps to 0.
    const { haloPix, rect } = voxelHaloPixels([0, 2, 4, 20], 50, 60);
    // spill(4,20): m=4 -> right = 2, bottom = 3. rect = [0, 0, 6, 25].
    expect(rect).toEqual([0, 0, 6, 25]);
    expect(haloPix.length).toBe(6 * 25 - 4 * 20);
    for (const idx of haloPix) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });
});
