# Getting a game onto CrazyGames

A complete, engine-agnostic guide to taking an HTML5 game from "it runs in a browser" to
"it is live on CrazyGames" — the hard limits, the SDK contract, and the traps that only show
up after you think you are done.

**Source:** docs.crazygames.com, read 2026-08-08 · **Written from:** one real submission
(Phaser 3 + Vite) · Engine-agnostic except where noted.

> Requirements change. Every limit and rule here was taken from the official documentation on
> 2026-08-08 and confirmed against a real submission — re-read the current docs before you rely
> on a number. The traps in §11 age better than the numbers do.

---

## 1. How the platform works

Two facts shape every decision below.

**Your game runs in an iframe on their domain, and they host the files.** You upload a zip;
they serve it. Nothing may reach outside that frame — no third-party ad network, no external
login, no outbound links, no CDN you control. Anything the game needs must be inside the zip
or come from their SDK.

**There are two launch tiers.** *Basic Launch* needs no SDK and earns nothing. *Full Launch*
requires the SDK and monetisation. Ship Basic first: their QA reviews game quality, not your
ad wiring, so you find out whether the game passes before you spend a week on revenue plumbing.

> ⚠ **Read this before you plan a timeline.** Basic Launch is not a review that ends in a yes
> or no. It is a **two-week live trial with limited traffic**, and during it they watch
> engagement — session length, how many players reach gameplay, how many come back. Those
> numbers decide whether you are promoted to Full Launch. Design work that lifts early
> engagement is not polish; it is the thing being graded.

---

## 2. Hard limits

Check these before writing any integration code. A build that busts them is not fixable by a
checklist.

| Constraint | Limit | Notes |
|---|---|---|
| Initial load | ≤ 50 MB | What the player waits for before play |
| Initial load, mobile homepage | ≤ 20 MB | Eligibility threshold — see below |
| Total build | ≤ 250 MB | Everything in the zip |
| File count | ≤ 1500 | Atlas your sprites if you are near it |
| Time to gameplay | ≤ 20 s | Measured to your `gameplayStart()` call |
| Clicks before gameplay | ≤ 1 | Zero preferred |
| Iframe size range | 800×450 → 1920×1080 | Both are 16:9 — same ratio, different scale |
| Asset paths | relative | Absolute paths break inside their frame |

**The 20 MB line is a competitive advantage, not a detail.** Staying under 20 MB is what makes
a game eligible for the *mobile homepage*. Most of the catalogue is Unity WebGL, which almost
never fits. A hand-built HTML5 game clears it easily — our submission was 5.93 MB total,
2.57 MB initial load. Treat that headroom as an asset to defend, and put a size check in CI so
nobody spends it by accident.

**The iframe range is smaller than it looks.** 800×450 and 1920×1080 are the same aspect ratio.
If your engine already scales a fixed-size canvas to fit its container while preserving ratio —
Phaser's `Scale.FIT`, and the equivalent elsewhere — the whole range is covered by what you
have. This is a *verification* task, not a rewrite. Build a local harness that embeds the game
at 800×450, 1280×720, 1920×1080 and one phone size, and look at all four.

---

## 3. Build the door first

The single most useful decision, and it must come before the SDK work, not after.

Put every host-specific thing behind **one interface with one implementation per target**,
chosen by a build-time flag. Not a runtime `if`. A build-time literal, so the bundler deletes
the branches you did not select.

```
VITE_TARGET=web|crazy|android      # or your bundler's equivalent

platform/
  base.ts     types + a no-op implementation
  crazy.ts    CrazyGames SDK
  android.ts  store wrapper, later
  index.ts    picks one — dead-code eliminated
```

The interface that turned out to be the right shape:

```ts
init(): Promise<void>         // bring the SDK up; never throws
storage                       // getItem/setItem/removeItem
loadingStart() / loadingStop()
gameplayStart() / gameplayStop()
happytime()                   // celebration flourish on the host page
interstitial(): Promise<void>
rewarded(): Promise<boolean>
hostMuted(): boolean
onHostMuteChange(cb)
preferredLang(): Lang | null
forcedLang?: Lang
```

**Why build-time and not runtime.** CrazyGames forbids third-party ad networks outright. If
your Android build has AdMob in it and you ship one bundle with a runtime switch, a single line
of that SDK in the zip is a compliance failure. Splitting at the build makes the guarantee
structural rather than something you have to keep remembering.

You can then prove it, which is the point:

```bash
VITE_TARGET=web npm run build
grep -rc "crazygames" dist/    # must be 0
```

---

## 4. Compliance checklist

Enough to submit Basic Launch. Most items are one line; the cost is knowing they exist.

| Item | What it means |
|---|---|
| **Relative paths** | Set your bundler's base to `./`. Verify: `grep -oE '(src\|href)="/[^"]*"' dist/index.html` returns nothing. |
| **English build** | Mandatory. Detect the player's language via the SDK; fall back to English, never to your own language. |
| **Straight into gameplay** | One click maximum from load to playing. A splash screen that waits on a fixed timer counts against you. |
| **No custom fullscreen button** | The host provides one. Yours will fail QA. |
| **No external anything** | No ad networks, no login providers, no outbound links — including your own privacy policy. |
| **Mouse and touch** | Keyboard may not be required. Plan for phones. |
| **Frame-rate independence** | Cap your loop or use delta time. 120 Hz phones will otherwise run your game at double speed or double heat. |
| **Mobile CSS** | `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none` — stops the magnifier and long-press menu. |
| **Letterboxing** | A portrait game gets side bars on a wide frame. Paint them a colour that belongs to your game, not default white. |
| **QA tool** | Run the Quality Assurance Tool in the Developer Portal and clear every warning before you submit. |

---

## 5. SDK integration

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```
```js
await window.CrazyGames.SDK.init();   // async — await before touching anything else
```

> ⚠ **Trap — this one hangs the game for a whole class of player.** If an adblocker blocks the
> SDK script, **it never fires `onerror`**. Await `init()` with no timeout and those players sit
> on your loading screen forever. Wrap it in a timeout — a few seconds — and carry on without
> the SDK when it expires.

### Engagement signals

`gameplayStart()` and `gameplayStop()` are not telemetry. They are how the host knows **when it
is allowed to interrupt with an ad**. Get them wrong and ads land in the middle of a turn.

Every pause, modal, menu and cutscene has to be bracketed by a stop and a start. Do not chase
the call sites — we had nine places setting a pause flag, and the tenth would have been
forgotten. **Move the signal into the flag itself**: make the pause state a getter/setter pair
and emit from the setter. Then a new pause added next year is covered for free.

The same reasoning applies to leaving a level: hook the scene's shutdown once instead of
annotating every route that can exit.

### Muting

The host has its own mute button, and their rules say it **takes priority over your in-game
audio settings**. An in-game sound toggle must not be able to bring audio back while the host
has muted you. Declare SDK muting support on the submission form, or you have implemented it
for nothing.

### Language

Read the locale from the SDK's system info and apply it after `init()` resolves. Note the
ordering problem: your i18n module is imported and initialised long before that promise
settles, so you need a re-apply path, not just a default at module load.

---

## 6. Ads (Full Launch only)

```js
SDK.ad.requestAd("rewarded", { adStarted, adFinished, adError });
SDK.ad.requestAd("midgame",  { adStarted, adFinished, adError });
```

- **Mute and pause on `adStarted`.** Unmute and resume on `adFinished` *and* on `adError`.
  Both branches, always.
- **Never block a player who cannot see ads.** A failed rewarded ad must still grant the reward
  or offer another route. The game has to stay playable with an adblocker on — that is an
  explicit requirement, not a courtesy.
- **Respect the cooldown** (about three minutes between ads). Do not offer an ad you already
  know will be refused.
- **Never interrupt a turn.** Midgame ads go between levels, on a win or loss screen.

Error codes you have to handle: `adsDisabledBasicLaunch`, `unfilled`, `adblock`, `adCooldown`,
`other`.

> ⚠ **Trap — the forgotten branch.** Forgetting to resume on `adError` is the single most common
> way to ship a game that is permanently frozen for everyone running an adblocker — and it will
> not show up in your own testing, because you do not have one on.

Placements are usually already in your UI: a revive that currently costs currency, a life refill
that currently costs a timer, a pre-level booster. You are changing what the player pays with,
not building new screens.

---

## 7. Saving progress

Required unless your game genuinely has no progress. Three ways to satisfy it.

| Route | Work | When to pick it |
|---|---|---|
| **Automatic Progress Save** | none | They mirror `localStorage` across devices for you. Not allowed alongside in-game purchases. |
| **Data module** | wrap storage | Explicit, survives adding purchases later. What we chose. |
| **Your own backend** | most | Only if you already have accounts. |

If you take the data module, route every read and write through the storage interface from §3 —
and **write to both** the SDK and local storage. A session where the SDK is unavailable then
still leaves a fresh local copy rather than a stale one frozen at whenever the SDK last worked.

> ⚠ **Trap — the one that silently destroys player saves.** Their SDK preloads the player's
> cloud save *during* `init()`. Any read before that resolves returns the **local** copy. So your
> loading screen must hold until init finishes — and your init timeout must be **shorter** than
> your loading-screen cap.
>
> Get that ordering backwards and the sequence is: the cap fires, the game opens on local data,
> the next write pushes that stale data to the cloud, and the player's real progress is gone.

> ⚠ **Trap — rename storage keys before launch or never.** Automatic Progress Save backs up
> `localStorage` verbatim. Rename a key after launch and it restores the old names while your
> game reads the new ones — every player loses everything. Before you have players, rename freely.

---

## 8. Store listing

### Assets

- Three covers: 1920×1080, 800×1200, 800×800
- A preview video — this is often the last thing blocking submission, so start it early
- Description and controls text, **in English**

### Form answers that have consequences

- **Engine: HTML5.** Not "externally hosted (iframe)" — that option is for games you host
  yourself.
- **Orientation** and the **mobile support** checkbox: declaring portrait lets them handle
  device rotation for you.
- **SDK muting support:** tick it, or your mute handling is inert.
- **Progress save:** answer with the method you implemented *and* switch the feature on. The
  data module does nothing if the toggle is off.
- **Payment details must be set up before you submit**, not after approval.

> ⚠ **Trap — where the privacy policy goes.** If your game collects anything beyond SDK events,
> you need a hosted privacy policy — but outbound links are banned inside the game. The URL goes
> **in the submission form only**. Do not add a link to it in your settings menu.

---

## 9. What actually gets judged

Basic Launch ends after ≥ 7 days and ≥ 500 plays, or at 21 days if the plays do not arrive.

| Metric | Good | What moves it |
|---|---|---|
| Session length | 10+ min | Anything that stops a first-time player being locked out |
| Day-1 retention | 10–15% | Progress that survives a closed tab |
| Conversion to 1+ min played | 80%+ | One-tap entry, short load |
| Load time | < 10 s | Initial payload size |

**Two design decisions that pay off here.**

*Do not gate a first session behind an energy system.* A player who arrives from a portal, hits
"out of lives, wait 30 minutes", and closes the tab is counted against every metric above. We
gave new players a free first hour and applied the normal rule only afterwards — and only on
this platform, via a platform flag.

*Your splash screen is on the clock.* Time-to-play is measured to your `gameplayStart()` call,
so a fixed minimum splash duration is spent directly out of the metric they grade — even when
every asset is already cached.

---

## 10. Pre-flight

```bash
# 1. remove local test harnesses from the build output first
rm -f dist/iframe-test.html

# 2. build for the platform target
VITE_TARGET=crazy npm run build

# 3. verify the four hard limits
find dist -type f | wc -l                    # ≤ 1500
du -sb dist                                  # ≤ 250 MB
du -cb dist/index.html dist/assets | tail -1 # ≤ 20 MB for mobile homepage
grep -oE '(src|href)="/[^"]*"' dist/index.html   # must be empty

# 4. prove the other platform's code is absent
grep -rc "admob\|firebase" dist/ | grep -v ':0'  # expect no output

# 5. zip the CONTENTS of dist — index.html at the zip root, not dist/index.html
```

After submission, QA usually replies within one to two days with screenshots pointing at
specific problems, then about two more days to prepare the release once you have fixed them.
Technical support from CrazyGames opens up only once you pass 50,000 plays, so early on you are
working from the docs and the QA tool.

---

## 11. Traps, collected

Every one of these looked fine until it did not. In rough order of how expensive they are to
find late.

| Trap | Consequence |
|---|---|
| Init timeout longer than the loading-screen cap | Game opens on local data and overwrites the player's cloud save with it |
| Renaming storage keys after launch | Every existing player loses all progress |
| No timeout around SDK `init()` | Adblocker users hang on the loading screen forever |
| Forgetting `adError` in the resume path | Adblocker users freeze mid-game, permanently |
| Rewarded failure treated as fatal | Compliance failure — the game must stay playable |
| Emitting gameplay signals at call sites | The one you miss becomes an ad in the middle of a turn |
| Runtime platform switch instead of build-time | Another platform's ad SDK ships in the CrazyGames zip |
| Local test harness left in `dist/` | Ships to the reviewer |
| Zipping the folder instead of its contents | Upload rejected — `index.html` must be at the root |
| Privacy policy linked inside the game | Violates the no-outbound-links rule |
| Progress-save toggle left off in the form | Your data-module work does nothing |
| Payment details left until after approval | Blocks submission |
| Fixed-duration splash screen | Spent straight out of the time-to-play metric |
