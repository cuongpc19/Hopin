// NỐI THÊM bàn vào bộ C, tiếp ngay sau slot cuối (user 2026-08-18: "cho vào list sau cái bộ
// bạn vừa build đi, chưa cần tính winrate").
//
//   FROM=530,25,20,... node scripts/_appendC.mjs           # xem trước
//   FROM=530,25,20,... WRITE=1 node scripts/_appendC.mjs   # ghi
//
// Chép bàn sang dải 9100+slot-1, giữ nguyên bàn gốc tại chỗ, và ghi thêm dòng vào _setC.json.
//
// ⚠ CHƯA TUNE. Hàng xe đi theo là hàng xe của BÀN GỐC, dựng cho vị trí cũ của nó — nên winrate
// hiện tại không liên quan gì tới target của slot mới. Phải chạy scan + --write cho dải mới
// trước khi dùng thật; `tuned: false` trong _setC.json là dấu để không quên.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";

const BASE = Number(process.env.BASE || 9100);
const FROM = (process.env.FROM || "").split(",").map(Number).filter(Boolean);
if (!FROM.length) { console.log("thieu FROM="); process.exit(1); }

const d = readD();
const setC = JSON.parse(fs.readFileSync("scripts/_setC.json", "utf8"));
const csv = fs.readFileSync("Manythings/level-config.csv", "utf8").trim().split(/\r?\n/);
const h = csv[0].split(","), iL = h.indexOf("lvl"), iT = h.indexOf("target"), iTi = h.indexOf("tier");
const cfgOf = {};
for (const line of csv.slice(1)) { const c = line.split(","); cfgOf[+c[iL]] = { target: +c[iT], tier: c[iTi] }; }

let slot = Math.max(...setC.map((r) => r.s));
const rows = [];
for (const from of FROM) {
  const src = d[from];
  if (!src?.board) { console.log(`L${from}: khong co ban, bo qua`); continue; }
  slot += 1;
  const to = BASE + slot - 1;
  if (d[to]) { console.log(`L${to} DA CO SAN — dung lai`); process.exit(1); }
  const t = cfgOf[slot] || { target: 90, tier: "easy" };
  rows.push({ s: slot, from, to, target: t.target, tier: t.tier, tuned: false });
}

console.log("slot | ban goc | -> o moi | target | tier   | co ban | mau");
for (const r of rows) {
  const L = d[r.from], live = L.board.filter((v) => v >= 0 && v < 90);
  console.log(`  ${String(r.s).padStart(2)} | L${String(r.from).padEnd(6)}| L${r.to}   | ${String(r.target).padStart(6)} | ${r.tier.padEnd(6)} | ${L.cols}x${L.cols}  | ${new Set(live).size}`);
}
console.log(`\n${rows.length} ban, slot ${rows[0]?.s}-${rows[rows.length - 1]?.s}`);
console.log(`bo C sau khi noi: slot 2-${slot}, tong ${setC.length + rows.length} ban`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of rows) d[r.to] = JSON.parse(JSON.stringify(d[r.from]));
writeD(d);
fs.writeFileSync("scripts/_setC.json", JSON.stringify(setC.concat(rows), null, 1));
console.log(`\nda chep ${rows.length} ban va cap nhat _setC.json`);
console.log(`MOC TIEP khi can tune: ONLY=${rows.map((r) => r.to).join(",")} RANGE=9101-${BASE + slot - 1} N_B=200 node scripts/scan-shards.mjs`);
