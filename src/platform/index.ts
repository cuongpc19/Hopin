// Picks the host implementation. Import `platform` from here; never import a
// host module directly, or the dead-code elimination below stops meaning anything.
//
// `__TARGET__` is baked in by Vite's `define` (see vite.config.ts), so this
// comparison is resolved at build time and the losing hosts are dropped from the
// bundle entirely. That is what keeps third-party ad code out of the CrazyGames
// build — a rule they enforce, not a style preference.

import { noopPlatform, type Platform } from "./base";
import { crazyPlatform } from "./crazy";

export { browserLang } from "./base";
export type { Lang, Platform, Target } from "./base";

export const platform: Platform = __TARGET__ === "crazy" ? crazyPlatform : noopPlatform;
