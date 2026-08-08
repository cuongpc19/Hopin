// Host abstraction — the ONE door between the game and whatever it is running on.
//
// Why this exists (CRAZYGAMES.md §0): CrazyGames forbids third-party ad networks
// outright, so the bundle we submit to them must not contain a single line of AdMob.
// `__TARGET__` is a build-time literal, so the branch in index.ts is dead-code
// eliminated and that guarantee is structural rather than a promise to be careful.
//
// GameScene.ts is 6400+ lines; scattering `if (crazygames)` through it is not
// maintainable. Everything host-specific goes behind the `platform` object.
//
// Types and the no-op base live HERE, apart from index.ts, so host modules can
// import them without a cycle back through the module that selects the host.

export type Target = "web" | "crazy" | "android";
export type Lang = "vi" | "en";

/** The slice of the localStorage API the game actually uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Platform {
  readonly name: Target;

  /** Bring the host SDK up. Always await before using anything else. Never throws. */
  init(): Promise<void>;

  /**
   * Where saved progress lives. Same shape as localStorage, and localStorage IS the
   * implementation everywhere except CrazyGames, where it routes to their data module
   * so a player's progress follows them between devices.
   *
   * ⚠ Only trustworthy once init() has resolved — their SDK preloads the player's saved
   * data during init, so a read before that returns the local copy, not the cloud one.
   * SplashScene holds the game on the loading screen until then for exactly this reason.
   */
  readonly storage: StorageLike;

  // --- Engagement signals -------------------------------------------------
  // On CrazyGames these are not decoration: they are how the host knows when it
  // may interrupt with an ad. gameplayStop() must bracket every pause, modal and
  // menu, or ads land in the middle of a turn.
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Celebration flourish on the host page. Sparingly — level clears only. */
  happytime(): void;

  // --- Ads ----------------------------------------------------------------
  /** Between-levels ad. Never call mid-turn. Resolves when play may resume. */
  interstitial(): Promise<void>;
  /**
   * Watch-for-reward ad. Resolves true only if it ran to completion.
   *
   * CALLERS MUST TREAT false AS NON-FATAL. CrazyGames requires the game to stay
   * playable for people running an adblocker, so a false here means "give them the
   * reward anyway, or offer another route" — never "block the player".
   */
  rewarded(): Promise<boolean>;

  // --- Policy -------------------------------------------------------------
  /** Language the host suggests; null = decide locally. */
  preferredLang(): Lang | null;
  /**
   * First time hearts hit zero, open a free-play window instead of a wall.
   * Web-portal players arrive once and leave; "out of hearts, wait 30 minutes"
   * ends the session for good. See lives.ts GRACE_MS.
   */
  readonly graceOnEmpty: boolean;
}

/**
 * Plain localStorage, with the try/catch every call needs: Safari private mode throws on
 * write, and some embeds block storage entirely. Losing a save is bad; taking the game
 * down with an exception is worse.
 */
export const localStorageShim: StorageLike = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* blocked or full — this session just won't persist */
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** Shared no-op base so each host only overrides what it actually changes. */
export const noopPlatform: Platform = {
  name: "web",
  async init() {},
  storage: localStorageShim,
  loadingStart() {},
  loadingStop() {},
  gameplayStart() {},
  gameplayStop() {},
  happytime() {},
  async interstitial() {},
  async rewarded() {
    return false;
  },
  preferredLang() {
    return null;
  },
  graceOnEmpty: false,
};

/**
 * The browser's language, as a fallback for hosts that don't tell us one.
 * Returns "en" unless the browser actually asks for Vietnamese — CrazyGames
 * requires English whenever the player's language can't be determined.
 */
export function browserLang(): Lang {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of tags) if (tag?.toLowerCase().startsWith("vi")) return "vi";
  } catch {
    /* no navigator — fall through */
  }
  return "en";
}
