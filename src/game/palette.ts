// Central place for all colors so re-skinning the game later is a one-file change.

export const BG = 0xe6e6ea; // light grey page background (like the mockup)
export const FRAME = 0x6d5a86; // purple board frame
export const MATTE = 0xffffff; // white matte inside the frame
export const LINE = 0x161620; // the black "Line" track around the grid
export const GOLD = 0xffd45e; // keyhole / accent
export const SLOT_STROKE = 0x5a5a76; // waiting-slot border (belt-like)
export const SLOT_FILL = 0x2b2b3a; // waiting-slot fill (belt-like dark)
export const TEXT_DARK = "#2a2a3a";
export const TEXT_LIGHT = "#ffffff";

// Colour id → hue. Matches the pre-coloured car sprites (car-{i}.png) and the
// recoloured slime sprites (slime-{i}.png), so a car and its slime share a colour.
export const COLORS: number[] = [
  0xfe4038, // 0 red
  0xfe8f28, // 1 orange
  0xfed734, // 2 yellow
  0x37cb5c, // 3 green
  0x2ac0cc, // 4 teal
  0x408afa, // 5 blue
  0x9756fd, // 6 purple
  0xfd55a5, // 7 pink
  0xffffff, // 8 white
  0xcbcbcb, // 9 light grey
  0x4a4a4a, // 10 dark grey
  0x985828, // 11 brown        (car-11)
  0x262630, // 12 black        (car-12)
  0x3050a0, // 13 dark blue    (car-13)
  0xe0b888, // 14 tan / beige  (car-14)
  0x98d0f0, // 15 sky blue     (car-15)
  0x208038, // 16 dark green   (car-16)
  0xf8c0c8, // 17 peach pink   (car-17)
  0x902030, // 18 maroon       (car-18)
];

export const COLOR_COUNT = COLORS.length;

// A darker shade of a color, for borders / depth.
export function shade(color: number, factor = 0.7): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
