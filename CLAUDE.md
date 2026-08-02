# Hop In! — project notes for Claude

Web puzzle game (Phaser 3 + TypeScript + Vite). Cute cars circle a board and peel a
mosaic picture made of coloured tiles, outside-in. User designs, Claude builds.

- Typecheck: `npx tsc --noEmit`   ·   Dev: `npm run dev`   ·   Android: `npm run apk`
- **Full feature log: `FEATURES.txt`** (Vietnamese, numbered sections). Read it before
  touching levels, mechanics, or visuals. Windows note: `features.txt` == `FEATURES.txt`
  (case-insensitive filesystem — same file).

## ONE version, ONE folder, ONE branch (2026-08-02)

The game is **SLAM mode only**: tapping a bay car sends it onto the ray and LOCKS that
bay until it fills or comes back (`GameScene.slamMode`, on for every level unless the
level sets `slam: false`). There is no longer a second variant to keep in sync.

This folder on branch `main` is the whole project — the old duplicate (`Hopin-slam`
worktree / `hop-in-slam` branch) has been merged in and removed. Before that merge, main
was 124 commits stale, and a full day of work went into the wrong copy; if you ever see
a second worktree appear, treat it as a mistake, not a variant. The pre-merge state of
the old main is kept on `archive/main-wip-2026-08-02` (it also holds an unfinished 2×2
big-slime feature and a beige checkerboard background, if either is ever wanted).

## Visual rules — READ before building/rebuilding levels (FEATURES.txt §20)

The board is a **DARK navy mat** (`0x2b2f4a`) so bright pixel-art pops. Consequences any
level-building session MUST honour:

1. **Board tiles are faceless** — flat bevelled colour tiles (`GameScene.makeTileTexture`,
   `tile-<id>`), only tiny faint eyes. Faces live ONLY on the tray cars + running slimes.
   (2026-08-01: thử 3 bản tile "3D jelly/bead" theo game mẫu → đều nhiễu ở cỡ ô nhỏ,
   user quyết quay về bản phẳng này. Đừng thử lại trừ khi user tự yêu cầu.)
2. **Picture backgrounds must NOT be a dull light-grey/white fill.** On the dark board that
   reads as an ugly "trắng đục" mass. Instead:
   - default: fill bg with **dark-neutral id 12** (`#262630`) — the builders now do this
     by default (`build-levels.mjs`, `build-one.mjs`; override `PIC_BG=` / `BG_ID=`), or
   - drop the bg entirely so the subject floats on the board.
3. **Per-level light board:** set `lightBoard: true` on a designed level (`src/game/level.ts`
   `Level.lightBoard`) to use the old light sand mat + a dark subject panel. L303 is the
   example. ⚠ `getLevel()` copies designed fields BY HAND — any NEW level field must be
   added there or it silently drops.
4. **Art pick:** bright subject, few colours, clear silhouette; avoid thick BLACK outlines
   on the dark board (they vanish into navy) — drop/lighten the outline or use `lightBoard`.

Cross-session memory lives in the user's auto-memory (`MEMORY.md` index); this file is the
repo-local pointer so a fresh session sees the rules immediately.
