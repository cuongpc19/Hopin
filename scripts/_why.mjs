// Soi một dải level: winrate, rơi rụng, và "thắng rồi vẫn bỏ" — cột tách được người bỏ vì thua khỏi người bỏ dù đã qua.
import fs from "node:fs";
import { readD, levelFingerprint } from "./genlib.mjs";

const rows = Object.values(JSON.parse(fs.readFileSync(process.env.LOG || "scripts/_all.json", "utf8")))
  .filter((r) => r && r.at && r.lvl != null && r.lvl > 0)
  .filter((r) => r.host !== "web" && !/^localhost|^127\./.test(r.from || ""));

// một VÁN = một lượt bấm vào level (gộp các lần hồi sinh)
const m = new Map();
for (const r of rows) {
  const k = `${r.dev}|${r.lvl}|${r.run ?? r.at}`;
  const cur = m.get(k);
  if (!cur || r.result === "win") m.set(k, { ...r, revives: Math.max(cur?.revives ?? 0, r.revives ?? 0) });
}
const g = [...m.values()];
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const d = readD();

const lv = new Map();
for (const r of g) {
  if (!lv.has(r.lvl)) lv.set(r.lvl, { devs: new Set(), pass: new Set(), n: 0, w: 0, ms: 0, la: 0, sigs: new Set(), last: 0 });
  const o = lv.get(r.lvl);
  o.devs.add(r.dev); o.n++; o.ms += r.ms || 0; o.la += r.launches || 0;
  if (r.sig) o.sigs.add(r.sig);
  o.last = Math.max(o.last, r.at);
  if (r.result === "win") { o.w++; o.pass.add(r.dev); }
}

// "bỏ đi" chuẩn hơn: chỉ tính người ĐÃ THẮNG level n mà không bao giờ bắt đầu level n+1.
// Cách cũ (người ở n+1 / người ở n) trộn hai chuyện: người thua bỏ cuộc, và người thắng rồi
// vẫn bỏ. Với một level cổng thì hai chuyện đó ngược nhau hoàn toàn.
const started = new Map();
for (const r of g) { if (!started.has(r.lvl)) started.set(r.lvl, new Set()); started.get(r.lvl).add(r.dev); }

console.log("lv | nguoi |  van | wr/van | wr/nguoi | van/nguoi | bo-sau-thang | giay | phong | xe | van tay");
for (let n = 8; n <= 32; n++) {
  const o = lv.get(n); if (!o) continue;
  const nx = started.get(n + 1) || new Set();
  const wonNotNext = [...o.pass].filter((x) => !nx.has(x)).length;
  const L = d[n];
  const fp = levelFingerprint(L);
  const stale = [...o.sigs].filter((s) => s !== fp).length;
  console.log(
    `L${String(n).padEnd(2)}| ${String(o.devs.size).padStart(5)} | ${String(o.n).padStart(4)} |` +
    ` ${String(pct(o.w, o.n) + "%").padStart(6)} | ${String(pct(o.pass.size, o.devs.size) + "%").padStart(8)} |` +
    ` ${String((o.n / o.devs.size).toFixed(1)).padStart(9)} |` +
    ` ${String(pct(wonNotNext, o.pass.size) + "%").padStart(12)} | ${String(Math.round(o.ms / o.n / 1000)).padStart(4)} |` +
    ` ${String((o.la / o.n).toFixed(1)).padStart(5)} | ${String(L.chests.length).padStart(2)} |` +
    ` ${o.sigs.size} ban${stale ? " (" + stale + " lac ban)" : ""}`
  );
}
