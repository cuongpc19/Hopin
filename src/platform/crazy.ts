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

import { browserLang, noopPlatform, type Lang, type Platform } from "./base";

const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const LOAD_TIMEOUT_MS = 5000; // an adblocked script never fires onerror — don't hang the splash

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
}
declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazySDK };
  }
}

let sdk: CrazySDK | null = null; // non-null only once init() has fully succeeded
let hostLocale: string | null = null;

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

export const crazyPlatform: Platform = {
  ...noopPlatform,
  name: "crazy",

  async init() {
    if (!(await loadScript())) return; // stays a no-op platform, game plays on
    try {
      const candidate = window.CrazyGames?.SDK;
      if (!candidate) return;
      // Asynchronous, and the SDK is unusable until it resolves — so nothing may be
      // called before this line, which is why init() belongs on the loading screen.
      await candidate.init();
      sdk = candidate;
      hostLocale = candidate.user?.systemInfo?.locale ?? null;
    } catch {
      sdk = null; // half-initialised is the same as absent
    }
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

  // Web-portal players arrive once and leave. A "wait 30 minutes" wall ends the
  // session permanently, and works against the one thing the host asks of a game —
  // that players land in gameplay immediately.
  graceOnEmpty: true,
};
