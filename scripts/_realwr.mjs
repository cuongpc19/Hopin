// Winrate THẬT của một level, TÁCH THEO VÂN TAY để không trộn hai bản làm một.
// (LEVEL-DESIGN §2.5: log chỉ ghi SỐ level, ván của bản đã bị thay vẫn nằm đó).
import fs from "node:fs";
import { readD, levelFingerprint } from "./genlib.mjs";

const FILE = process.env.LOG || "Manythings/hop-n-7d1af-default-rtdb-export.json";
const LV = (process.env.LV || "25,30,35").split(",").map(Number);
const runs = Object.values(JSON.parse(fs.readFileSync(FILE, "utf8")).runs);
const d = readD();

// gộp các lần revive của cùng một ván: log ghi `run` cho bản mới, bản cũ thì lấy từng bản ghi
const key = (r) => `${r.dev}|${r.lvl}|${r.run ?? r.at}`;

for (const n of LV) {
  const now = levelFingerprint(d[n]);
  const all = runs.filter((r) => r.lvl === n && r.host !== "web" && r.from !== "localhost");
  const bySig = {};
  for (const r of all) (bySig[r.sig || "(khong co)"] ??= []).push(r);
  console.log(`\nL${n} — van tay HIEN TAI = ${now}`);
  for (const [sig, rs] of Object.entries(bySig).sort((a, b) => b[1].length - a[1].length)) {
    const games = new Map();
    for (const r of rs) { const k = key(r); if (!games.has(k) || r.result === "win") games.set(k, r); }
    const arr = [...games.values()];
    const win = arr.filter((r) => r.result === "win").length;
    const devs = new Set(arr.map((r) => r.dev));
    const devWin = new Set(arr.filter((r) => r.result === "win").map((r) => r.dev));
    const t = arr.map((r) => r.at).sort((a, b) => a - b);
    const fmt = (ms) => new Date(ms).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    console.log(`  sig ${sig}${sig === now ? "  <= BAN DANG NAM TRONG FILE" : "  (ban cu)"}` +
      `  ${arr.length} van, ${win} thang = ${Math.round((100 * win) / arr.length)}%/van` +
      `  |  ${devs.size} nguoi, ${devWin.size} qua = ${Math.round((100 * devWin.size) / devs.size)}%/nguoi` +
      `  |  ${(arr.length / devs.size).toFixed(1)} van/nguoi  |  ${fmt(t[0])} → ${fmt(t[t.length - 1])}`);
  }
  if (!all.length) console.log("  khong co van nao");
}
