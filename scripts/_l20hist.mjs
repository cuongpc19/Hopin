// Một level đã đổi ở những commit nào — LV=20 node scripts/_l20hist.mjs
import { execFileSync } from "node:child_process";

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1e9 });
const load = (ref) => { const j = JSON.parse(git(["show", `${ref}:src/levels/designed.json`])); return j.levels || j; };
const N = Number(process.env.LV || 20);
const sig = (L) => JSON.stringify([L.cols, L.rows, L.board, L.chests, L.layer2 || null, L.hidden || null]);

const raw = git(["log", "--format=%h@%ad@%s", "--date=format:%m-%d %H:%M", "-30", "--", "src/levels/designed.json"]).trim();
let prev = null;
for (const line of raw.split("\n").reverse()) {
  const [h, dt, msg] = line.split("@");
  const L = load(h)[N];
  if (!L) continue;
  const s = sig(L);
  if (s !== prev) {
    const lay = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
    console.log(`${dt}  ${h}  L${N}: ${L.cols}x${L.rows}  ${L.chests.length} xe  lop2=${lay}   <- ${msg}`);
  }
  prev = s;
}
