// winrate3 — chấm MỘT dải level bằng NĂM mô hình rồi in bảng so sánh.
//   A = trip-sim tuần tự        (simcore.mjs qua genlib.measure — thước chính thức cũ)
//   B = sim đồng thời           (simcore2.mjs — 5 xe cùng chạy, tăng tốc cuối màn)
//   C = idea-B xác suất từng bước (build-levels.mjs --ideab-json → file, CJSON=...)
//   D = Monte-Carlo playAverage (build-levels.mjs --mech-json → file, DJSON=...)
//       ⚠ D không đơn điệu theo skill — đọc kèm mức skill trong file
//   E = MCTS                    (mcts.mjs 15-46 → file text, EJSON=...)
//
//   FROM=15 TO=46 N=80 CJSON=... DJSON=... EJSON=... node scripts/winrate3.mjs
import fs from "node:fs";
import { readD, measure } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";

const FROM = Number(process.env.FROM || 15);
const TO = Number(process.env.TO || 46);
const N = Number(process.env.N || 80);

// target thiết kế: L1-45 từ winratedesign1.csv; L31-46 mới dùng dải 10-30% của gen31-46
const target = {};
try {
  const t = fs.readFileSync("Manythings/Design winrate/winratedesign1.csv", "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const h = t[0].split(","); const iL = h.indexOf("lvl"), iT = h.indexOf("target");
  for (const line of t.slice(1)) { const c = line.split(","); const n = +c[iL], v = +c[iT]; if (Number.isFinite(n) && Number.isFinite(v)) target[n] = v; }
} catch { /* không có CSV thì thôi */ }
Object.assign(target, {
  31: 30, 32: 28, 33: 27, 34: 25, 35: 24, 36: 22, 37: 21, 38: 20,
  39: 18, 40: 17, 41: 16, 42: 15, 43: 14, 44: 13, 45: 12, 46: 10,
});

// C/D đọc từ file "XXX_JSON {...}"; E đọc từ text "L15:  38%  (12.3s)"
function readJsonFile(path, tag) {
  if (!path || !fs.existsSync(path)) return {};
  const m = fs.readFileSync(path, "utf8").match(new RegExp(tag + " (\\{.*\\})"));
  return m ? JSON.parse(m[1]) : {};
}
const C = readJsonFile(process.env.CJSON, "IDEAB_JSON");
const D = readJsonFile(process.env.DJSON, "MECH_JSON");
const E = {};
if (process.env.EJSON && fs.existsSync(process.env.EJSON)) {
  for (const m of fs.readFileSync(process.env.EJSON, "utf8").matchAll(/^L\s*(\d+):\s*(\d+)%/gm)) E[+m[1]] = +m[2];
}

const d = readD();
const rows = [];
const cell = (v) => (v == null ? "   - " : String(v).padStart(4) + "%");
console.log(`Lv  | target |   A   |   B   |   C   |   D   |   E   | chenh max`);
console.log(`----+--------+-------+-------+-------+-------+-------+----------`);
for (let k = FROM; k <= TO; k++) {
  const L = d[k];
  if (!L || !Array.isArray(L.board)) continue;
  const a = measure(L, N);
  const b = measure2(L, N);
  const c = C[k]?.win ?? null;
  const dd = D[k]?.win ?? null;
  const e = E[k] ?? null;
  const tg = target[k] ?? null;
  const have = [a, b, c, dd, e].filter((x) => x != null);
  const spread = Math.max(...have) - Math.min(...have);
  rows.push({ k, tg, a, b, c, d: dd, e, spread });
  console.log(
    `L${String(k).padStart(2)} | ${(tg == null ? "  -  " : String(tg).padStart(4) + "%").padStart(6)} |` +
    ` ${cell(a)} | ${cell(b)} | ${cell(c)} | ${cell(dd)} | ${cell(e)} | ${String(spread).padStart(6)}` +
    (spread >= 45 ? "  <== cai nhau to" : spread <= 20 ? "  (dong thuan)" : "")
  );
}
fs.writeFileSync(process.env.OUT || "scripts/_winrate3.json", JSON.stringify(rows));
const withT = rows.filter((r) => r.tg != null);
const mae = (pick) => {
  const xs = withT.filter((r) => pick(r) != null);
  return xs.length ? Math.round(xs.reduce((s, r) => s + Math.abs(pick(r) - r.tg), 0) / xs.length) : null;
};
console.log(`\nSai so trung binh |mo hinh - target|: A=${mae((r) => r.a)} · B=${mae((r) => r.b)} · C=${mae((r) => r.c)} · D=${mae((r) => r.d)} · E=${mae((r) => r.e)}`);
console.log(`(D chay o skill ${D.skill ?? "?"} — mo hinh nay khong don dieu theo skill, doc so co dieu kien)`);
