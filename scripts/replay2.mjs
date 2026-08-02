// replay2 — NGHIỆM THU mô hình B: phát lại các ván THẬT (playlog.jsonl) và so số slime ăn
// được TỪNG CHUYẾN giữa sim và thực tế. Chạy cả A (tuần tự) lẫn B (đồng thời) trên cùng
// chuỗi nút bấm, chấm NGHIÊM: đúng thứ tự + đúng màu + đúng số ăn mới tính khớp; mẫu số
// luôn là số chuyến THẬT nên không thể ăn gian bằng cách sinh ít chuyến.
//
//   LOGLVL=10 LVL=28 node scripts/replay2.mjs      (ván ghi ở level 10, dữ liệu nay ở L28)
//   SWEEP=1 dò hệ số ms/nhịp · ALL=1 chấm mọi ván khớp (mặc định: mọi ván)
import fs from "node:fs";
import { makeState, launchQueue, tapBay, headGroup } from "./simcore.mjs";
import { mkWorld, launchCol, tapSlot, tick } from "./simcore2.mjs";

const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const LOGLVL = Number(process.env.LOGLVL || 10);
const LVL = Number(process.env.LVL || LOGLVL);
const L = d[LVL];
if (!L) { console.error("khong co level " + LVL); process.exit(1); }

const lines = fs.readFileSync("playlog.jsonl", "utf8").trim().split(/\r?\n/)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const runs = []; let cur = null;
for (const e of lines) {
  if (e.ev === "start") { cur = { lvl: e.lvl, cars: e.cars, ev: [e] }; runs.push(cur); }
  else if (cur && e.lvl === cur.lvl) cur.ev.push(e);
}
const cands = runs.filter((r) => r.lvl === LOGLVL && r.cars === L.chests.length
  && r.ev.some((e) => e.ev === "result") && r.ev.filter((e) => e.ev === "trip").length >= 5);
if (!cands.length) { console.error(`khong co van THAT nao cua L${LOGLVL} khop du lieu L${LVL} (${L.chests.length} xe)`); process.exit(1); }

function runA(acts) {
  const s = makeState(L);
  const got = [];
  for (const e of acts) {
    if (e.ev === "launch") {
      const grp = headGroup(s, e.col);
      if (!grp) continue;
      const before = grp.map((m) => m.cap);
      if (launchQueue(s, e.col)) grp.forEach((m, i) => got.push({ color: m.color, ate: before[i] - m.cap }));
    } else if (e.ev === "bayTap") {
      const p = s.slots[e.slot];
      if (!p) continue;
      const b = p.cap;
      if (tapBay(s, e.slot)) got.push({ color: p.color, ate: b - p.cap });
    }
  }
  return got;
}

function runB(acts, msPerTick) {
  const w = mkWorld(L);
  let last = 0;
  for (const e of acts) {
    if (e.ev === "trip") continue;
    const steps = Math.max(0, Math.round(((e.t ?? 0) - last) / msPerTick));
    for (let i = 0; i < steps; i++) tick(w);
    last = e.t ?? last;
    if (e.ev === "launch") launchCol(w, e.col);
    else tapSlot(w, e.slot);
  }
  for (let i = 0; i < w.seq.length * 6 && w.flying.length; i++) tick(w);
  return w.trips;
}

// khớp = đúng vị trí + đúng màu + đúng số ăn; mẫu số = số chuyến THẬT
function score(sim, realTrips) {
  let ok = 0, aligned = 0;
  for (let i = 0; i < realTrips.length; i++) {
    const s2 = sim[i];
    if (!s2 || s2.color !== realTrips[i].color) continue;
    aligned++;
    if (s2.ate === realTrips[i].ate) ok++;
  }
  return { ok, aligned, n: realTrips.length, simN: sim.length };
}

const MSLIST = process.env.SWEEP === "1" ? [32, 48, 56, 64, 72, 80, 96, 120] : [Number(process.env.MSPERTICK || 80)];
const tot = { A: { ok: 0, al: 0, n: 0 } };
for (const ms of MSLIST) tot["B" + ms] = { ok: 0, al: 0, n: 0 };

console.log(`Phat lai ${cands.length} van THAT cua L${LOGLVL} (du lieu L${LVL}, ${L.chests.length} xe)\n`);
for (const run of cands) {
  const acts = run.ev.filter((e) => ["launch", "bayTap", "trip"].includes(e.ev));
  const realTrips = acts.filter((e) => e.ev === "trip");
  const res = run.ev.find((e) => e.ev === "result");
  const a = score(runA(acts), realTrips);
  tot.A.ok += a.ok; tot.A.al += a.aligned; tot.A.n += a.n;
  let line = `  ${res.result.padEnd(4)} ${String(realTrips.length).padStart(3)} chuyen | A ${String(a.ok).padStart(3)}/${String(a.n).padEnd(3)}`;
  for (const ms of MSLIST) {
    const b = score(runB(acts, ms), realTrips);
    tot["B" + ms].ok += b.ok; tot["B" + ms].al += b.aligned; tot["B" + ms].n += b.n;
    line += ` | B@${ms} ${String(b.ok).padStart(3)}/${String(b.n).padEnd(3)}`;
  }
  console.log(line);
}
const pct = (o) => Math.round((100 * o.ok) / Math.max(1, o.n));
console.log(`\nTONG — MO HINH A: ${tot.A.ok}/${tot.A.n} = ${pct(tot.A)}%  (dung pha mau: ${tot.A.al}/${tot.A.n})`);
for (const ms of MSLIST) {
  const o = tot["B" + ms];
  console.log(`TONG — MO HINH B @${String(ms).padStart(3)}ms/nhip: ${o.ok}/${o.n} = ${pct(o)}%  (dung pha mau: ${o.al}/${o.n})`);
}
