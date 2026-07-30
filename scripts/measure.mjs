// measure.mjs — đo winrate trip-sim cho 1 level, KHÔNG đụng designed.json.
//   node scripts/measure.mjs designed:148 [N]      ← level trong designed.json
//   node scripts/measure.mjs path/to/level.json [N] ← level JSON rời (agent tune song song)
// In JSON một dòng: {"wins":..,"N":..,"pct":..}
import fs from "fs";
import { makeState, rollout } from "./simcore.mjs";

const arg = process.argv[2];
const N = Number(process.argv[3] || process.env.N || 60);
if (!arg) { console.error("usage: node scripts/measure.mjs <designed:<lvl>|file.json> [N]"); process.exit(1); }
let lvl;
if (arg.startsWith("designed:")) {
  lvl = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"))[arg.slice(9)];
  if (!lvl) { console.error("level không tồn tại: " + arg); process.exit(1); }
} else {
  lvl = JSON.parse(fs.readFileSync(arg, "utf8"));
}
const s0 = makeState(lvl);
let wins = 0;
for (let t = 1; t <= N; t++) if (rollout(s0, t * 7919 + 13).win) wins++;
console.log(JSON.stringify({ wins, N, pct: Math.round((100 * wins) / N) }));
