// ---------------------------------------------------------------------------
// Lucky Clover — a free, ongoing event that rewards clearing levels.
//
//  • Win a level to collect Clovers:
//      – First-Try win (first-ever clear, no loss this attempt) → 2 clovers
//      – Any other win (after a loss/replay, or replaying a beaten level) → 1
//      – Lose → 0 clovers
//  • Clovers accumulate and are NEVER spent — they are only a progress counter.
//  • Reaching each cumulative milestone auto-grants its reward (Gold or Booster),
//    alternating Gold / Booster, with a big Grand Reward at milestone 30.
//  • The required clovers per milestone RISE over time (~5 wins early → ~8-10 late).
//  • The event unlocks after the player beats Level 10 and shows until every
//    milestone is claimed.
//
// State lives in localStorage:
//   pf_event_rocks   — total Clovers collected  (key kept for save-compat)
//   pf_event_claimed — how many milestones have been granted so far
// (Unlock is derived from pf_progress — no extra flag needed.)
// ---------------------------------------------------------------------------

// TEMP DISABLE (user 2026-07-26): flip to true to bring the Lucky Clover event back.
// isEventUnlocked() short-circuits on this, so the Home banner + win-screen clover awards
// all switch off from one place. No data is wiped — progress/clovers are kept for re-enable.
export const EVENT_ENABLED = false;
export const EVENT_UNLOCK_LEVEL = 12; // event opens once this level is beaten
export const EVENT_NAME = "Lucky Clover";
export const CLOVER_ICON = "🍀";

export type EventReward =
  | { kind: "gold"; amount: number }
  | { kind: "booster"; key: string; label: string }
  | { kind: "grand"; gold: number; key: string; label: string };

export interface Milestone {
  index: number; // 1..30
  threshold: number; // cumulative clovers required to claim it
  reward: EventReward;
}

const BOOSTER_LABEL: Record<string, string> = {
  add: "Add Booster",
  refresh: "Shuffle Booster",
  hand: "Grab Booster",
  magnet: "Magnet Booster",
};
const BOOSTER_CYCLE = ["add", "refresh", "hand", "magnet"];

// Clovers needed to advance ONE milestone. Rises in three bands so early rewards
// come fast (~5 first-try wins) and later ones take longer (~8-10). Tweak freely.
function incrementFor(i: number): number {
  if (i <= 10) return 10; // ~5 first-try wins
  if (i <= 20) return 13; // ~6-7 wins
  return 17; //           ~8-10 wins
}

// The full 30-milestone ladder (cumulative thresholds + alternating rewards).
export const MILESTONES: Milestone[] = (() => {
  const out: Milestone[] = [];
  let cum = 0;
  let goldAmt = 300; // odd milestones: 300, 400, 500, … Gold
  let bIdx = 0; // even milestones cycle the four boosters
  for (let i = 1; i <= 30; i++) {
    cum += incrementFor(i);
    let reward: EventReward;
    if (i === 30) {
      reward = { kind: "grand", gold: 3000, key: "magnet", label: "Quà Đặc Biệt" };
    } else if (i % 2 === 1) {
      reward = { kind: "gold", amount: goldAmt };
      goldAmt += 100;
    } else {
      const key = BOOSTER_CYCLE[bIdx % BOOSTER_CYCLE.length];
      bIdx++;
      reward = { kind: "booster", key, label: BOOSTER_LABEL[key] };
    }
    out.push({ index: i, threshold: cum, reward });
  }
  return out;
})();

export const EVENT_GOAL = MILESTONES[MILESTONES.length - 1].threshold; // total clovers to finish

// A short human label for a reward (used in popups / the progress bar).
export function rewardLabel(r: EventReward): string {
  if (r.kind === "gold") return `${r.amount} Coin`;
  if (r.kind === "booster") return r.label;
  return `${r.gold} Coin + ${r.label}`;
}

function readInt(key: string, def = 0): number {
  try {
    return parseInt(localStorage.getItem(key) ?? "", 10) || def;
  } catch {
    return def;
  }
}
function writeInt(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* storage unavailable */
  }
}

// pf_progress = highest level reached (i.e. next level). Beaten level 12 → >= 13.
export function isEventUnlocked(): boolean {
  if (!EVENT_ENABLED) return false; // temporarily disabled — hides the banner + skips clover awards
  return readInt("pf_progress", 1) > EVENT_UNLOCK_LEVEL;
}
export function getClovers(): number {
  return readInt("pf_event_rocks", 0);
}
export function getClaimedCount(): number {
  return readInt("pf_event_claimed", 0);
}
export function isEventComplete(): boolean {
  return getClaimedCount() >= MILESTONES.length;
}

export interface EventProgress {
  total: number; // clovers collected so far
  claimed: number; // milestones already granted
  next?: Milestone; // the next milestone to reach (undefined once all done)
  prevThreshold: number; // threshold of the last claimed milestone (bar start)
  remaining: number; // clovers still needed for `next` (0 when done)
  fraction: number; // 0..1 fill of the current segment
  done: boolean;
}

export function getProgress(): EventProgress {
  const total = getClovers();
  const claimed = getClaimedCount();
  const next = MILESTONES[claimed];
  const prevThreshold = claimed > 0 ? MILESTONES[claimed - 1].threshold : 0;
  const remaining = next ? Math.max(0, next.threshold - total) : 0;
  const span = next ? next.threshold - prevThreshold : 1;
  const fraction = next ? Math.min(1, Math.max(0, (total - prevThreshold) / span)) : 1;
  return { total, claimed, next, prevThreshold, remaining, fraction, done: !next };
}

export interface AwardResult {
  gained: number;
  total: number;
  granted: Milestone[]; // milestones newly claimed by this award (may be several)
  progress: EventProgress;
}

// Add `gained` clovers, auto-claim every milestone now reached, and report the result.
export function awardClovers(gained: number): AwardResult {
  const total = getClovers() + gained;
  writeInt("pf_event_rocks", total);
  let claimed = getClaimedCount();
  const granted: Milestone[] = [];
  while (claimed < MILESTONES.length && total >= MILESTONES[claimed].threshold) {
    granted.push(MILESTONES[claimed]);
    claimed++;
  }
  writeInt("pf_event_claimed", claimed);
  return { gained, total, granted, progress: getProgress() };
}

// How many clovers a win is worth. firstClear = first-ever clear of this level.
export function cloversForWin(firstClear: boolean, failedThisAttempt: boolean): number {
  return firstClear && !failedThisAttempt ? 2 : 1;
}
