// Player lives ("tim"). Losing a level costs 1 heart (floor 0); with 0 hearts the
// player can't START a level (map taps are blocked and GameScene bounces to the map).
// Hearts creep back on a timer — +1 every HEART_REGEN_MS, capped at MAX_HEARTS —
// computed lazily from a stored timestamp, so it works across reloads with no clock.
export const MAX_HEARTS = 5;
export const HEART_REGEN_MS = 20 * 60 * 1000; // one heart back every 20 minutes

const KEY_N = "pf_hearts";
const KEY_TS = "pf_hearts_ts"; // when the current regen window started

function readRaw(): { n: number; ts: number } {
  let n = MAX_HEARTS;
  let ts = Date.now();
  try {
    const rn = localStorage.getItem(KEY_N);
    if (rn !== null) n = Math.max(0, Math.min(MAX_HEARTS, parseInt(rn, 10) || 0));
    const rts = localStorage.getItem(KEY_TS);
    if (rts !== null) ts = parseInt(rts, 10) || ts;
  } catch {
    /* storage unavailable → session-only defaults */
  }
  return { n, ts };
}

function write(n: number, ts: number) {
  try {
    localStorage.setItem(KEY_N, String(n));
    localStorage.setItem(KEY_TS, String(ts));
  } catch {
    /* session-only */
  }
}

// Credit any hearts earned since the stored timestamp, then return the settled state.
function settle(): { n: number; ts: number } {
  let { n, ts } = readRaw();
  const now = Date.now();
  if (n >= MAX_HEARTS) {
    ts = now; // full → the regen clock idles
  } else {
    const gained = Math.floor((now - ts) / HEART_REGEN_MS);
    if (gained > 0) {
      n = Math.min(MAX_HEARTS, n + gained);
      ts = n >= MAX_HEARTS ? now : ts + gained * HEART_REGEN_MS;
    }
  }
  write(n, ts);
  return { n, ts };
}

export function getHearts(): number {
  return settle().n;
}

// -1 heart (never below 0). Returns the new count.
export function spendHeart(): number {
  const s = settle();
  const wasFull = s.n >= MAX_HEARTS;
  const n = Math.max(0, s.n - 1);
  write(n, wasFull ? Date.now() : s.ts); // dropping below full starts the regen clock
  return n;
}

// ms until the next heart arrives (0 when already full).
export function heartsMsToNext(): number {
  const s = settle();
  if (s.n >= MAX_HEARTS) return 0;
  return Math.max(0, s.ts + HEART_REGEN_MS - Date.now());
}
