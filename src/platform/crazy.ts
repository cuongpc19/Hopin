// CrazyGames host. See CRAZYGAMES.md for the requirement each piece satisfies.
//
// STAGE: SDK wired (game module). Their tiers are Basic Launch (SDK optional, no
// monetization) then Full Launch (SDK + ads). The ad calls below still resolve as
// "no ad" — which is what the SDK itself reports at Basic Launch via the
// `adsDisabledBasicLaunch` error — and get their real bodies in Phase 3.
//
// EVERYTHING HERE MUST SURVIVE THE SDK NEVER ARRIVING. An adblocker can block the
// script outright, and their rules require the game to stay playable regardless.
// So: a load timeout, every call guarded, and no throw ever escapes.

import { browserLang, localStorageShim, noopPlatform, type Lang, type Platform, type StorageLike } from "./base";

const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
// TOTAL budget for getting the SDK up — script fetch AND their init() together.
//
// ⚠ This MUST stay below SplashScene's CAP_MS (3000). Splash holds Home until this settles
// so that saved progress is read from their store, but the cap releases it regardless. If
// the cap fired first, Home would open on the LOCAL copy and the next write would mirror
// those stale values over the player's real cloud save.
//
// Measured 2026-08-08 from Vietnam: a cold fetch of their script took 7.9s (1.2s of it DNS),
// warm ones 1.0-1.4s. On crazygames.com itself the player has usually loaded it already, but
// the budget has to assume they haven't — an ad SDK must never be what makes a game feel slow.
const READY_BUDGET_MS = 2200;
// Script-tag timeout on its own. An adblocked script can hang without ever firing onerror.
const LOAD_TIMEOUT_MS = 2000;

interface CrazyGame {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
}
interface CrazySDK {
  init(): Promise<void>;
  game: CrazyGame;
  user: { systemInfo?: { locale?: string; device?: { type?: string } } };
  /** Same shape as localStorage, synchronous, but only populated once init() resolves. */
  data: StorageLike;
}
declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazySDK };
  }
}

let sdk: CrazySDK | null = null; // non-null only once init() has fully succeeded
let hostLocale: string | null = null;
let gaveUp = false; // budget expired — this session stays local-only, see boot()

// The DNS/TLS warm-up for their CDN lives in index.html, injected at build time by the
// `crazyPreconnect` plugin in vite.config.ts — see the note there for why it cannot live
// here. This module must stay FREE OF TOP-LEVEL SIDE EFFECTS: the moment it has one,
// Rollup can no longer drop it from the web build, and the self-hosted game starts
// reaching for CrazyGames' servers.

/** Resolve whatever `p` gives, or null once `ms` has passed. Never rejects. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: T | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    p.then(finish, () => finish(null));
    setTimeout(() => finish(null), ms);
  });
}

/** Inject the SDK script. Resolves false on error OR timeout — never rejects. */
function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const el = document.createElement("script");
      el.src = SDK_URL;
      el.async = true;
      el.onload = () => done(true);
      el.onerror = () => done(false); // blocked or offline
      document.head.appendChild(el);
      // A blocked request can hang without firing either handler, and the splash is
      // waiting on us. Give up rather than stall the game behind an ad network.
      setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    } catch {
      done(false);
    }
  });
}

/** Run a game-module call only if the SDK really came up. Swallows everything. */
function call(fn: (g: CrazyGame) => void) {
  if (!sdk) return;
  try {
    fn(sdk.game);
  } catch {
    /* a broken SDK must never take the game down with it */
  }
}

// Saved progress. Their data module carries the player's saves between devices, but it is
// only populated after init() — SplashScene waits for that before any screen reads a save.
//
// Reads prefer the SDK once it is up; writes go to BOTH. Mirroring costs nothing and means
// a session where their SDK fails still finds a current local copy to fall back on, instead
// of a snapshot frozen at whenever the SDK last worked.
const crazyStorage: StorageLike = {
  getItem(key) {
    if (sdk) {
      try {
        return sdk.data.getItem(key);
      } catch {
        /* fall through to the local copy */
      }
    }
    return localStorageShim.getItem(key);
  },
  setItem(key, value) {
    localStorageShim.setItem(key, value);
    if (!sdk) return;
    try {
      sdk.data.setItem(key, value);
    } catch {
      /* the local write already landed */
    }
  },
  removeItem(key) {
    localStorageShim.removeItem(key);
    if (!sdk) return;
    try {
      sdk.data.removeItem(key);
    } catch {
      /* the local removal already landed */
    }
  },
};

/** Fetch the script and complete their handshake. Never throws; sets `sdk` on success. */
async function boot(): Promise<void> {
  try {
    if (!(await loadScript())) return; // blocked or offline — game plays on without it
    const candidate = window.CrazyGames?.SDK;
    if (!candidate) return;
    // Asynchronous, and the SDK is unusable until it resolves — which is why init()
    // belongs on the loading screen. It also PRELOADS the player's saved data, the
    // reason SplashScene holds Home: reading a save earlier gets the local copy.
    await candidate.init();
    if (gaveUp) return; // the deadline already passed — see init()
    sdk = candidate;
    hostLocale = candidate.user?.systemInfo?.locale ?? null;
  } catch {
    sdk = null; // half-initialised is the same as absent
  }
}

export const crazyPlatform: Platform = {
  ...noopPlatform,
  name: "crazy",
  storage: crazyStorage,

  async init() {
    // One deadline over the whole handshake. Their init() has no timeout of its own and
    // will sit forever outside a CrazyGames frame, so without this the only thing ending
    // the wait is SplashScene's cap — three seconds of a game that looks hung.
    await withDeadline(boot(), READY_BUDGET_MS);
    // Out of budget with nothing to show: stay local-only for the rest of the session.
    // boot() may still finish later, and adopting the SDK at that point would be worse
    // than useless — we would already have read the LOCAL save, and the next write would
    // copy those values over the player's real cloud save. Losing a session of syncing
    // beats losing their progress.
    if (!sdk) gaveUp = true;
  },

  loadingStart() {
    call((g) => g.loadingStart());
  },
  loadingStop() {
    call((g) => g.loadingStop());
  },

  // Not decoration: this pair is how the host knows when it may interrupt with an
  // ad. Every pause, modal and menu must be bracketed by gameplayStop/Start, or ads
  // land in the middle of a turn.
  gameplayStart() {
    call((g) => g.gameplayStart());
  },
  gameplayStop() {
    call((g) => g.gameplayStop());
  },

  // Confetti on the host page. Their docs say use it sparingly — level clears only.
  happytime() {
    call((g) => g.happytime());
  },

  // PHASE 3 — ad module. The two rules that fail QA if fumbled:
  //   1. adStarted → mute audio AND pause. adFinished AND adError → unmute and resume.
  //      Miss the adError branch and every adblock user is stuck on a frozen game.
  //   2. errors to expect: adsDisabledBasicLaunch, unfilled, adblock,
  //      adCooldown (~3 min between ads), other.

  /**
   * Their rule: detect the player's language, fall back to English when unknown.
   *
   * Called at i18n module-eval time, which is BEFORE init() has resolved — so this
   * answers from the browser. Once the SDK is up, `hostLocale` is the better source
   * and SplashScene re-applies it via applyHostLang(). An explicit choice already
   * saved in pf_lang always wins over both.
   */
  preferredLang(): Lang | null {
    if (hostLocale) return hostLocale.toLowerCase().startsWith("vi") ? "vi" : "en";
    return browserLang();
  },

  // ENGLISH ONLY on this host (user 2026-08-08: "language duy nhất tiếng Anh đã nhé").
  // Their audience is global and English is their hard requirement; a Vietnamese browser
  // would otherwise flip the whole game, and the switcher would offer a language nobody
  // there reads. Self-hosted and Android keep both languages and the Vietnamese default.
  forcedLang: "en",

  // Web-portal players arrive once and leave. A "wait 30 minutes" wall ends the
  // session permanently, and works against the one thing the host asks of a game —
  // that players land in gameplay immediately.
  graceOnEmpty: true,
};
