// simcore.mjs v2 — mô phỏng HÀNH TRÌNH thật của xe (không chỉ luật tia):
//   • LoS 3 tia (thẳng + 2 chéo 45°, chéo kẹp góc thì tắc) — port 1:1 từ GameScene.
//   • Xe chạy vòng CCW (bottom→phải, right→lên, top→trái, left→xuống), VÀO RAY ngay trên Ô CHỜ
//     của nó (slam 2-hop) — ăn theo THỨ TỰ LANE ĐI QUA, nearest-first, tia bắn lại sau mỗi con
//     (ô vừa ăn mở ô sau ngay tại lane). Tối đa ~14 con mỗi lượt-qua-lane (tốc độ bắn thật).
//   • Cuối mỗi vòng: còn cap && màu còn reachable (toàn cục) → chạy tiếp vòng (auto-continue);
//     hết → về ô (còn cap) hoặc rời (cap=0).
// Lý do v2: trip-telemetry chứng minh v1 (fixpoint không thứ tự) ăn đúng SỐ nhưng sai Ô với màu
// nhiều ô → các màu hiếm lộ khác thật → kế hoạch guide sụp. Verify: `node simcore.mjs trips`.
import fs from "fs";

const isC = (v) => v >= 0 && v < 90;

export function makeState(L) {
  const lanes = L.lanes || 4;
  const queue = Array.from({ length: lanes }, () => []);
  L.chests.forEach((c, i) => queue[i % lanes].push({ color: c.color, cap: c.count, pid: c.pairId ?? null }));
  return {
    cols: L.cols, rows: L.rows,
    occ: L.board.slice(),
    lay: L.layer2 ? L.layer2.slice() : null,
    queue,
    slots: [null, null, null, null, null],
  };
}
export function cloneState(s) {
  return { cols: s.cols, rows: s.rows, occ: s.occ.slice(), lay: s.lay ? s.lay.slice() : null, queue: s.queue.map((c) => c.map((m) => ({ ...m }))), slots: s.slots.map((p) => (p ? { ...p } : null)) };
}
const clearCell = (s, i) => { if (s.lay && s.lay[i] >= 0) { s.occ[i] = s.lay[i]; s.lay[i] = -1; } else s.occ[i] = -1; };

function rayHit(s, startR, startC, dr, dc) {
  const { cols, rows, occ } = s;
  const occAt = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && isC(occ[r * cols + c]);
  const diagonal = dr !== 0 && dc !== 0;
  let r = startR, c = startC, steps = 0;
  while (r >= 0 && r < rows && c >= 0 && c < cols) {
    const idx = r * cols + c;
    if (isC(occ[idx])) return { idx, steps };
    if (diagonal && occAt(r, c + dc) && occAt(r + dr, c)) return null;
    r += dr; c += dc; steps++;
  }
  return null;
}

// LANE-SEQUENCE vòng CCW: mỗi phần tử = {edge, lane} — bottom sc 0..cols-1, right sr rows-1..0,
// top sc cols-1..0, left sr 0..rows-1 (khớp chiều build track: bottom→ / right↑ / top← / left↓).
export function laneSeq(s) {
  const seq = [];
  for (let sc = 0; sc < s.cols; sc++) seq.push({ e: "b", l: sc });
  for (let sr = s.rows - 1; sr >= 0; sr--) seq.push({ e: "r", l: sr });
  for (let sc = s.cols - 1; sc >= 0; sc--) seq.push({ e: "t", l: sc });
  for (let sr = 0; sr < s.rows; sr++) seq.push({ e: "l", l: sr });
  return seq;
}
// 3 tia từ (edge,lane) — như findLosTargets: thẳng + 2 chéo XUẤT PHÁT LỆCH 1 lane
function lanRays(s, e, l) {
  const { cols, rows } = s;
  if (e === "b") return [[rows - 1, l, -1, 0], [rows - 1, l - 1, -1, -1], [rows - 1, l + 1, -1, 1]];
  if (e === "t") return [[0, l, 1, 0], [0, l - 1, 1, -1], [0, l + 1, 1, 1]];
  if (e === "l") return [[l, 0, 0, 1], [l - 1, 0, -1, 1], [l + 1, 0, 1, 1]];
  return [[l, cols - 1, 0, -1], [l - 1, cols - 1, -1, -1], [l + 1, cols - 1, 1, -1]];
}
// target khớp màu gần nhất từ (edge,lane)
function nearestTarget(s, e, l, color) {
  let best = null;
  for (const [r0, c0, dr, dc] of lanRays(s, e, l)) {
    const h = rayHit(s, r0, c0, dr, dc);
    if (h && s.occ[h.idx] === color && (!best || h.steps < best.steps)) best = h;
  }
  return best;
}
// reachable toàn cục (mọi lane mọi cạnh, 3 tia) — để check auto-continue cuối vòng
export function reachableSet(s) {
  const hits = new Set();
  for (const { e, l } of laneSeq(s)) {
    for (const [r0, c0, dr, dc] of lanRays(s, e, l)) {
      const h = rayHit(s, r0, c0, dr, dc);
      if (h) hits.add(h.idx);
    }
  }
  return hits;
}
export function reachableColors(s) {
  const S = new Set();
  for (const i of reachableSet(s)) S.add(s.occ[i]);
  return S;
}

// slot i (0..4) nằm dưới board → lane bottom xấp xỉ đều: tâm slot ở (i+0.5)/5 chiều ngang
export function slotEntryLaneIndex(s, slotI) {
  const sc = Math.min(s.cols - 1, Math.floor(((slotI + 0.5) / 5) * s.cols));
  return sc; // index trong laneSeq: bottom lane sc đứng đầu chuỗi
}

// MỘT CHUYẾN ra ray từ entry lane: đi CCW, ăn nearest-first per lane (tia bắn lại sau mỗi con,
// tối đa 14/lượt-qua); cuối vòng còn cap && màu reachable → vòng nữa; trả số đã ăn.
export function tripCollect(s, car, entryIdx, pessim = false) {
  const seq = laneSeq(s);
  const N = seq.length;
  // pessim vét-sạch CÓ ĐIỀU KIỆN (chỉ bật khi ô chờ căng — caller quyết): tổng viên màu == cap
  // → coi như hụt 1 con. KHÔNG áp mù mọi trip: cuối ván ai cũng phải vét con cuối, áp mù làm mọi
  // ván bất khả thi + vòng lặp tap-mãi-không-tiến (bug treo 2026-07-30).
  let pessimCap = Infinity;
  if (pessim) {
    let total = 0;
    for (const v of s.occ) if (v === car.color) total++;
    if (s.lay) for (const v of s.lay) if (v === car.color) total++;
    if (total === car.cap && car.cap >= 2) pessimCap = car.cap - 1;
  }
  let ate = 0;
  let pos = entryIdx % N;
  let steps = 0;
  let guardLaps = 0;
  while (car.cap > 0 && ate < pessimCap && guardLaps < 60) {
    const { e, l } = seq[pos];
    let perLane = 0;
    while (car.cap > 0 && perLane < 14) {
      const h = nearestTarget(s, e, l, car.color);
      if (!h) break;
      clearCell(s, h.idx);
      car.cap--; ate++; perLane++;
    }
    pos = (pos + 1) % N;
    steps++;
    if (steps >= N) { // hết một vòng — auto-continue check (đúng luật canKeepCircling)
      guardLaps++;
      if (car.cap <= 0) break;
      const S = reachableColors(s);
      if (!S.has(car.color)) break; // không còn gì với tới → về
      steps = 0;
    }
  }
  return ate;
}

export function remaining(s) {
  return s.occ.reduce((a, v) => a + (isC(v) ? 1 : 0), 0) + (s.lay ? s.lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
}
export function freeSlots(s) { return s.slots.filter((x) => x === null).length; }

export function headGroup(s, j) {
  const f = s.queue[j][0];
  if (!f) return null;
  if (f.pid == null) return [f];
  const members = [];
  for (let jj = 0; jj < s.queue.length; jj++) {
    for (let r = 0; r < s.queue[jj].length; r++) {
      const c = s.queue[jj][r];
      if (c.pid === f.pid) {
        if (s.queue[jj].slice(0, r).some((x) => x.pid !== f.pid)) return null;
        members.push(c);
      }
    }
  }
  return members.length >= 2 ? members : null;
}

// PHÓNG cột j (slam 2-hop): từng member chiếm SLOT TRỐNG ĐẦU TIÊN ngay khi phóng, vào ray ngay
// trên slot đó, chạy chuyến; ăn hết → rời (slot nhả), còn dư → nằm slot.
export function launchQueue(s, j) {
  const group = headGroup(s, j);
  if (!group) return false;
  if (freeSlots(s) < group.length) return false;
  for (const m of group) { for (const col of s.queue) { const k = col.indexOf(m); if (k >= 0) { col.splice(k, 1); break; } } }
  const pess = freeSlots(s) - group.length <= 1; // sắp cạn ô → đánh giá bi quan
  const isGroup = group.length > 1;
  for (const m of group) {
    const sl = s.slots.indexOf(null);
    s.slots[sl] = m; // chiếm ngay (2-hop)
    tripCollect(s, m, isGroup ? 0 : slotEntryLaneIndex(s, sl), pess);
    if (m.cap === 0) s.slots[sl] = null;
  }
  return true;
}
export function tapBay(s, i) {
  const p = s.slots[i];
  if (!p) return false;
  const pess = freeSlots(s) <= 1;
  tripCollect(s, p, slotEntryLaneIndex(s, i), pess);
  if (p.cap === 0) s.slots[i] = null;
  return true;
}

// ---------------- rollout solver (policy tier + noise, dùng trip-sim) ----------------
const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };
function estimate(s, group) {
  const c2 = cloneState(s);
  const g2 = group.map((m) => ({ ...m }));
  let eaten = 0;
  for (const m of g2) {
    const sl = c2.slots.indexOf(null);
    if (sl < 0) break;
    c2.slots[sl] = m;
    eaten += tripCollect(c2, m, slotEntryLaneIndex(c2, sl));
    if (m.cap === 0) c2.slots[sl] = null;
  }
  const leftover = g2.reduce((a, m) => a + m.cap, 0);
  return { eaten, leftover };
}
export function rollout(state, seed, forceFirst) {
  const rng = mkRng(seed);
  const s = cloneState(state);
  const plan = [];
  const doForce = () => {
    if (!forceFirst) return true;
    if (forceFirst.startsWith("bay")) {
      const i = parseInt(forceFirst.slice(3), 10);
      if (!s.slots[i]) return false;
      plan.push("bay" + i); tapBay(s, i); return true;
    }
    const j = parseInt(forceFirst.slice(1), 10);
    const grp = headGroup(s, j);
    if (!grp || freeSlots(s) < grp.length) return false;
    plan.push("q" + j); launchQueue(s, j); return true;
  };
  if (!doForce()) return { win: false, plan, left: remaining(s) };
  let guard = 0;
  while (remaining(s) > 0 && guard++ < 500) {
    let any = true;
    while (any && remaining(s) > 0) {
      any = false;
      const S = reachableColors(s);
      for (let i = 0; i < s.slots.length; i++) {
        const p = s.slots[i];
        if (p && p.cap > 0 && S.has(p.color)) { const b = p.cap; plan.push("bay" + i); tapBay(s, i); if (s.slots[i] === null || s.slots[i].cap < b) any = true; else plan.pop(); break; }
      }
    }
    if (remaining(s) === 0) break;
    const fs2 = freeSlots(s);
    const cands = [];
    const seenPid = new Set();
    for (let j = 0; j < s.queue.length; j++) {
      const grp = headGroup(s, j);
      if (!grp) continue;
      const pid = grp[0].pid;
      if (pid != null) { if (seenPid.has(pid)) continue; seenPid.add(pid); }
      if (fs2 < grp.length) continue;
      cands.push({ j, grp });
    }
    if (!cands.length) break;
    const meta = cands.map((c) => ({ ...c, ...estimate(s, c.grp) }));
    const clean = meta.filter((m) => m.leftover === 0 && m.eaten > 0);
    const grpP = meta.filter((m) => m.grp.length > 1 && m.eaten > 0);
    const blk = fs2 >= 2 ? meta.filter((m) => m.eaten > 0) : [];
    const dig = fs2 >= 2 ? meta.filter((m) => m.eaten === 0) : [];
    const last = fs2 === 1 ? meta : [];
    const tiers = [clean, grpP, blk, dig, last].filter((t) => t.length);
    if (!tiers.length) break;
    let ti = 0;
    while (ti < tiers.length - 1 && rng() < 0.15) ti++;
    const tier = tiers[ti];
    const pick = tier[Math.floor(rng() * tier.length)];
    plan.push("q" + pick.j);
    launchQueue(s, pick.j);
  }
  return { win: remaining(s) === 0, plan, left: remaining(s) };
}

// ---------------- CLI ----------------
if (process.argv[2] === "trips") {
  // so sim-ăn vs thật-ăn từng chuyến của ván MỚI NHẤT trong playlog (level tự phát hiện)
  const lines = fs.readFileSync("playlog.jsonl", "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  let lastStart = -1;
  lines.forEach((e, i) => { if (e.ev === "start") lastStart = i; });
  const evs = lines.slice(lastStart).filter((e) => ["launch", "bayTap", "trip"].includes(e.ev));
  const lvl = lines[lastStart].lvl;
  const designed = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
  const s = makeState(designed[lvl]);
  const realTrips = evs.filter((e) => e.ev === "trip");
  let ti = 0, okN = 0, badN = 0;
  console.log(`L${lvl} — so sim(v2 path) vs thật từng chuyến:`);
  for (const e of evs) {
    if (e.ev === "launch") {
      const grp = headGroup(s, e.col);
      if (!grp) { console.log("phóng c" + e.col + ": sim không phóng được?!"); continue; }
      const before = grp.map((m) => m.cap);
      launchQueue(s, e.col);
      grp.forEach((m, gi) => {
        const rt = realTrips[ti++];
        const simA = before[gi] - m.cap;
        const realA = rt ? rt.ate : "?";
        const ok = rt && simA === realA;
        ok ? okN++ : badN++;
        console.log(`phóng c${e.col} màu${m.color} | sim=${simA} thật=${realA} ${ok ? "✓" : "✗"}`);
      });
    } else if (e.ev === "bayTap") {
      const p = s.slots[e.slot];
      if (!p || p.color !== e.colors[0]) { console.log("bấm s" + e.slot + ": sim slot=" + (p ? p.color : "trống") + " ≠ " + e.colors[0]); badN++; ti++; continue; }
      const before = p.cap;
      tapBay(s, e.slot);
      const rt = realTrips[ti++];
      const simA = before - p.cap;
      const realA = rt ? rt.ate : "?";
      const ok = rt && simA === realA;
      ok ? okN++ : badN++;
      console.log(`bấm  s${e.slot} màu${e.colors[0]} | sim=${simA} thật=${realA} ${ok ? "✓" : "✗"}`);
    }
  }
  console.log(`KHỚP ${okN}/${okN + badN}`);
}
if (process.argv[2] === "solve") {
  const lvl = Number(process.argv[3] || 148);
  const N = Number(process.env.N || 40);
  const designed = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
  const s0 = makeState(designed[lvl]);
  let wins = 0; const firsts = {};
  for (let t = 1; t <= N; t++) {
    const r = rollout(s0, t * 7919 + 13);
    if (r.win) { wins++; firsts[r.plan[0]] = (firsts[r.plan[0]] || 0) + 1; }
  }
  console.log(`L${lvl}: ${wins}/${N} rollout thắng (trip-sim)`, wins ? JSON.stringify(firsts) : "");
}
