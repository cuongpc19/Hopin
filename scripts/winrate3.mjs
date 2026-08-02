// winrate3 — chấm MỘT dải level bằng CẢ BA mô hình rồi in bảng so sánh.
//   A = trip-sim tuần tự  (scripts/simcore.mjs, qua genlib.measure)
//   B = sim đồng thời     (scripts/simcore2.mjs — nhiều xe cùng chạy, có tăng tốc cuối màn)
//   C = idea-B xác suất từng bước (build-levels.mjs --ideab-json, đọc từ file JSON)
//
//   N=80 FROM=5 TO=30 CJSON=<duong dan> node scripts/winrate3.mjs
import fs from "node:fs";
import { readD, measure } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";

const FROM = Number(process.env.FROM || 5);
const TO = Number(process.env.TO || 30);
const N = Number(process.env.N || 80);

// target thiết kế (winratedesign1.csv)
const target = {};
try {
  const t = fs.readFileSync("Manythings/Design winrate/winratedesign1.csv", "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const h = t[0].split(","); const iL = h.indexOf("lvl"), iT = h.indexOf("target");
  for (const line of t.slice(1)) { const c = line.split(","); const n = +c[iL], v = +c[iT]; if (Number.isFinite(n) && Number.isFinite(v)) target[n] = v; }
} catch { /* không có CSV thì thôi */ }

// model C đọc từ file do --ideab-json sinh ra
let C = {};
const cPath = process.env.CJSON;
if (cPath && fs.existsSync(cPath)) {
  const m = fs.readFileSync(cPath, "utf8").match(/IDEAB_JSON (\{.*\})/);
  if (m) C = JSON.parse(m[1]);
}

const d = readD();
const rows = [];
console.log(`Lv  | target |   A   |   B   |   C   | lech A-B | ghi chu`);
console.log(`----+--------+-------+-------+-------+----------+--------`);
for (let k = FROM; k <= TO; k++) {
  const L = d[k];
  if (!L || !Array.isArray(L.board)) continue;
  const a = measure(L, N);
  const b = measure2(L, N);
  const c = C[k]?.win ?? null;
  const tg = target[k] ?? null;
  const spread = Math.abs(a - b);
  const note = [];
  if (spread >= 30) note.push("A/B lech manh");
  if (c != null && Math.abs(a - c) >= 40) note.push("C khac han");
  rows.push({ k, tg, a, b, c, spread });
  console.log(
    `L${String(k).padStart(2)} | ${(tg == null ? "  -  " : String(tg).padStart(4) + "%").padStart(6)} | ` +
    `${String(a).padStart(4)}% | ${String(b).padStart(4)}% | ${(c == null ? "   -" : String(c).padStart(4) + "%").padStart(5)} | ` +
    `${String(spread).padStart(8)} | ${note.join(", ")}`
  );
}
fs.writeFileSync(process.env.OUT || "scripts/_winrate3.json", JSON.stringify(rows));
const withT = rows.filter((r) => r.tg != null);
const mae = (pick) => Math.round(withT.reduce((s, r) => s + Math.abs(pick(r) - r.tg), 0) / Math.max(1, withT.length));
console.log(`\nSai so trung binh so voi TARGET: A=${mae((r) => r.a)} diem · B=${mae((r) => r.b)} diem` +
  (withT.every((r) => r.c != null) ? ` · C=${mae((r) => r.c)} diem` : ""));
