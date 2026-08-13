// Doi chieu WINRATE THAT (log nguoi choi tren CrazyGames) voi cac mo hinh dang dung.
//
//   node scripts/real-vs-model.mjs <ban-export.json> [N]
//
// Vi sao can: A_CAL/B_CAL hien tai khop tren 67 van KHONG co van tay (LEVEL-DESIGN.md §2.5),
// nen thuoc chi dang tin o muc "hon doan bua". Day la lan dau co du lieu that CO van tay.
//
// ⚠ Chi so sanh duoc khi VAN TAY khop: log ghi so level, ma level co the da bi dung lai tu
// luc do. Van khong khop bi tach rieng, khong tron vao.
import fs from "node:fs";
import { readD, levelFingerprint } from "./genlib.mjs";
import { gradeBatch } from "./calib.mjs";

const FILE = process.argv[2];
const N = Number(process.argv[3] || 200);
if (!FILE) { console.error("thieu duong dan ban export"); process.exit(1); }

let raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
if (raw.runs) raw = raw.runs;
const rows = Object.values(raw).filter((r) => r.from === "hop-in-yvm.game-files.crazygames.com" && Number.isFinite(r.lvl));

// gop luot da revive: revive CONG THEM mot o cho, nen dong tiep theo cua cung luot co bays lon hon
const by = {};
for (const r of rows) { const k = r.dev + "|" + r.lvl; (by[k] = by[k] || []).push(r); }
const drop = new Set();
for (const k in by) { const a = by[k].sort((x, y) => x.at - y.at);
  for (let i = 1; i < a.length; i++) { const p = a[i - 1], c = a[i];
    if (p.result === "lose" && c.bays > p.bays && c.ms > p.ms) drop.add(p); } }

const d = readD();
const agg = new Map();
for (const r of rows) {
  if (drop.has(r)) continue;
  const L = d[r.lvl]; if (!L) continue;
  const same = r.sig ? r.sig === levelFingerprint(L) : null; // null = van cu, khong co van tay
  const b = agg.get(r.lvl) ?? { n: 0, w: 0, nS: 0, wS: 0, noSig: 0 };
  b.n++; if (r.result === "win") b.w++;
  if (same === true) { b.nS++; if (r.result === "win") b.wS++; }
  if (same === null) b.noSig++;
  agg.set(r.lvl, b);
}

const lvls = [...agg.keys()].filter((lv) => agg.get(lv).n >= 8 && d[lv]).sort((a, b) => a - b);
console.error(`do ${lvls.length} level o n=${N}…`);
const g = gradeBatch(lvls.map((lv) => d[lv]), { n: N, tag: "rvm" });

console.log("| Level | Ván thật | Winrate THẬT | Vân tay khớp | B | D | Hiệu chuẩn | Lệch (mô hình − thật) |");
console.log("|---:|---:|---:|---:|---:|---:|---:|---:|");
const errs = [];
for (let i = 0; i < lvls.length; i++) {
  const lv = lvls[i], a = agg.get(lv), m = g[i];
  const real = Math.round((100 * a.w) / a.n);
  const fit = a.nS === a.n ? "toàn bộ" : a.nS === 0 ? "**KHÔNG** — bản đã đổi" : `${a.nS}/${a.n}`;
  const diff = m.win - real;
  if (a.nS === a.n) errs.push({ lv, real, model: m.win, b: m.b, d: m.d, diff });
  console.log(`| L${lv} | ${a.n} | ${real}% | ${fit} | ${m.b} | ${m.d} | ${m.win}% | ${diff > 0 ? "+" : ""}${diff} |`);
}
const mae = (k) => Math.round(errs.reduce((s, e) => s + Math.abs(e[k] - e.real), 0) / errs.length);
const bias = Math.round(errs.reduce((s, e) => s + (e.model - e.real), 0) / errs.length);
console.log(`\nChi tren ${errs.length} level co van tay KHOP toan bo:`);
console.log(`  sai so trung binh (MAE):  hieu chuan ${mae("model")} diem  |  B ${mae("b")} diem  |  D ${mae("d")} diem`);
console.log(`  do lech he thong (bias) cua thuoc hieu chuan: ${bias > 0 ? "+" : ""}${bias} diem (duong = thuoc doc CAO hon thuc te)`);
