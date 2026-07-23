import type { Level } from "../game/level";
import data from "./designed.json";

// Levels are stored as DATA in designed.json (keyed by level number) so the level
// editor — run via `npm run dev` and opened at http://localhost:5173/editor — can
// write straight into the game (see the /api/save-level middleware in vite.config.ts).
// You can also hand-edit designed.json directly.
export const DESIGNED_LEVELS: Record<number, Level> = data as unknown as Record<number, Level>;
