// CrazyGames host. See CRAZYGAMES.md for the requirements each piece satisfies.
//
// STAGE: Basic Launch. Their two-tier system runs Basic Launch (SDK optional, no
// monetization) before Full Launch (SDK + ads). We are on the first tier, so the
// SDK is not wired yet and the ad calls deliberately resolve as "no ad" — which is
// exactly what the SDK itself reports at this stage via `adsDisabledBasicLaunch`.
// Phase 2 fills in the marked sections; nothing outside this file changes.
//
// What IS live already, because Basic Launch is judged on quality:
//   • English by default (their hard requirement — "English localization is mandatory")
//   • the free-play grace hour instead of an out-of-hearts wall

import { browserLang, noopPlatform, type Lang, type Platform } from "./base";

export const crazyPlatform: Platform = {
  ...noopPlatform,
  name: "crazy",

  // PHASE 2 — load https://sdk.crazygames.com/crazygames-sdk-v3.js and
  //   await window.CrazyGames.SDK.init();
  // Init is asynchronous and the SDK is unusable until it resolves, so it belongs
  // on the loading screen. Must never throw: a failed SDK has to leave a playable
  // game behind, same as an adblocker does.

  // PHASE 2 — game module: loadingStart/Stop, gameplayStart/Stop, happytime.

  // PHASE 3 — ad module. The two rules that fail QA if fumbled:
  //   1. adStarted  → mute audio AND pause the game
  //      adFinished AND adError → unmute and resume. BOTH branches, or anyone with
  //      an adblocker is stuck on a frozen game forever.
  //   2. errors to expect: adsDisabledBasicLaunch, unfilled, adblock,
  //      adCooldown (~3 min between ads), other.

  /**
   * Their rule: detect the player's language, default to English when it can't be
   * determined. Phase 2 should prefer the SDK's system-info language over the
   * browser's; until then the browser tag is the honest best guess.
   *
   * Note this only sets the DEFAULT — an explicit choice saved in pf_lang still wins,
   * so a Vietnamese player who picks English keeps English.
   */
  preferredLang(): Lang | null {
    return browserLang();
  },

  // Web-portal players arrive once and leave. A "wait 30 minutes" wall ends the
  // session permanently, and it works against the one thing the host asks for —
  // that players land in gameplay immediately.
  graceOnEmpty: true,
};
