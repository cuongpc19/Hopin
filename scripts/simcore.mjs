// simcore.mjs — mô phỏng ĐÚNG LUẬT ăn của game (không xấp xỉ 4-hướng nữa):
//   • LoS 3 TIA từ mỗi lane của mỗi cạnh: thẳng + 2 chéo 45° (chéo xuất phát lệch 1 ô,
//     bị "kẹp góc" khi 2 ô kề chéo đều occupied) — port 1:1 từ GameScene.rayHit/findLosTargets.
//   • Xe phóng chạy vòng + tự đi tiếp vòng khi màu còn reachable → kết quả 1 lần phóng =
//     FIXPOINT "ăn mọi hit khớp màu qua 3-tia, ăn ô này mở ô kia" (đúng auto-continue).
//   • Slam: phóng queue cần đủ slot trống (nhóm cần đủ theo size); xe dư cap về slot; tap bay
//     cho xe ô ra ăn fixpoint rồi về (hết cap thì rời, slot trống).
// CLI: node scripts/simcore.mjs replay  → replay các ván L<lvl> mới nhất từ playlog.jsonl,
//      đối chiếu chuỗi freeSlotsBefore + kết quả. (REPLAY_LVL=148 để lọc level.)
import fs from "fs";

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
const isC = (v) => v >= 0 && v < 90;

// rayHit port: ô occupied đầu tiên theo tia; chéo bị kẹp góc → null
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

// mọi hit 3-tia từ 4 cạnh (track square) — trả Set idx
export function reachableSet(s) {
  const { cols, rows } = s;
  const hits = new Set();
  const add = (h) => { if (h) hits.add(h.idx); };
  for (let sc = 0; sc < cols; sc++) {
    add(rayHit(s, rows - 1, sc, -1, 0)); add(rayHit(s, rows - 1, sc - 1, -1, -1)); add(rayHit(s, rows - 1, sc + 1, -1, 1)); // bottom
    add(rayHit(s, 0, sc, 1, 0)); add(rayHit(s, 0, sc - 1, 1, -1)); add(rayHit(s, 0, sc + 1, 1, 1));                         // top
  }
  for (let sr = 0; sr < rows; sr++) {
    add(rayHit(s, sr, 0, 0, 1)); add(rayHit(s, sr - 1, 0, -1, 1)); add(rayHit(s, sr + 1, 0, 1, 1));                         // left
    add(rayHit(s, sr, cols - 1, 0, -1)); add(rayHit(s, sr - 1, cols - 1, -1, -1)); add(rayHit(s, sr + 1, cols - 1, 1, -1)); // right
  }
  return hits;
}
export function reachableColors(s) {
  const S = new Set();
  for (const i of reachableSet(s)) S.add(s.occ[i]);
  return S;
}

const clearCell = (s, i) => { if (s.lay && s.lay[i] >= 0) { s.occ[i] = s.lay[i]; s.lay[i] = -1; } else s.occ[i] = -1; };

// 1 lần ra ray (phóng/tap): ăn fixpoint mọi hit khớp màu (auto-continue-lap)
export function collectFix(s, car) {
  for (;;) {
    if (car.cap <= 0) return;
    let ate = false;
    for (const i of reachableSet(s)) {
      if (s.occ[i] === car.color) { clearCell(s, i); car.cap--; ate = true; break; }
    }
    if (!ate) return;
  }
}

export function remaining(s) {
  return s.occ.reduce((a, v) => a + (isC(v) ? 1 : 0), 0) + (s.lay ? s.lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
}
export function freeSlots(s) { return s.slots.filter((x) => x === null).length; }

// nhóm của head cột j (twin whole — mọi member phải front-prefix)
export function headGroup(s, j) {
  const f = s.queue[j][0];
  if (!f) return null;
  if (f.pid == null) return [f];
  const members = [];
  for (let jj = 0; jj < s.queue.length; jj++) {
    for (let r = 0; r < s.queue[jj].length; r++) {
      const c = s.queue[jj][r];
      if (c.pid === f.pid) {
        if (s.queue[jj].slice(0, r).some((x) => x.pid !== f.pid)) return null; // member bị chặn
        members.push(c);
      }
    }
  }
  return members.length >= 2 ? members : null;
}

// PHÓNG từ queue cột j (slam 2-hop): cần đủ slot; xe ăn fixpoint; dư cap → chiếm slot
export function launchQueue(s, j) {
  const group = headGroup(s, j);
  if (!group) return false;
  if (freeSlots(s) < group.length) return false;
  for (const m of group) { for (const col of s.queue) { const k = col.indexOf(m); if (k >= 0) { col.splice(k, 1); break; } } }
  for (const m of group) collectFix(s, m);
  for (const m of group) if (m.cap > 0) { const sl = s.slots.indexOf(null); s.slots[sl] = m; }
  return true;
}
// TAP xe ở slot i: ra ăn fixpoint; hết cap → rời (slot trống), còn → về slot
export function tapBay(s, i) {
  const p = s.slots[i];
  if (!p) return false;
  collectFix(s, p);
  if (p.cap === 0) s.slots[i] = null;
  return true;
}

// ---------------- CLI: replay-verify từ playlog ----------------
if (process.argv[2] === "replay") {
  const LVL = Number(process.env.REPLAY_LVL || 148);
  const designed = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
  const lines = fs.readFileSync("playlog.jsonl", "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  // gom các ván của LVL: từ mỗi 'start'
  const games = [];
  let cur = null;
  for (const e of lines) {
    if (e.lvl !== LVL || !e.ev) continue;
    if (e.ev === "start") { cur = { moves: [], result: null }; games.push(cur); continue; }
    if (!cur) continue;
    if (e.ev === "launch") cur.moves.push({ t: "launch", colors: e.colors, counts: e.counts, free: e.freeSlotsBefore });
    else if (e.ev === "bayTap") cur.moves.push({ t: "bay", slot: e.slot, colors: e.colors });
    else if (e.ev === "result") cur.result = e.result;
  }
  console.log(`replay L${LVL}: ${games.length} ván trong log`);
  games.forEach((g, gi) => {
    if (!g.moves.length) return;
    const s = makeState(designed[LVL]);
    let ok = 0, bad = 0, note = "";
    for (const mv of g.moves) {
      if (mv.t === "launch") {
        // đối chiếu freeSlots TRƯỚC nước
        const f = freeSlots(s);
        if (f === mv.free) ok++; else { bad++; if (!note) note = `lệch freeSlots (sim ${f} vs log ${mv.free}) tại nước ${ok + bad}`; }
        // tìm cột có head khớp màu+count
        let done = false;
        for (let j = 0; j < s.queue.length && !done; j++) {
          const grp = headGroup(s, j);
          if (!grp) continue;
          const cs = grp.map((m) => m.color).join(","), ns = grp.map((m) => m.cap).join(",");
          if (cs === mv.colors.join(",") && ns === mv.counts.join(",")) done = launchQueue(s, j);
        }
        if (!done) {
          // nới: khớp màu thôi (count có thể đã bị sim ăn khác) — lấy cột đầu khớp màu
          for (let j = 0; j < s.queue.length && !done; j++) {
            const grp = headGroup(s, j);
            if (grp && grp.map((m) => m.color).join(",") === mv.colors.join(",")) done = launchQueue(s, j);
          }
        }
        if (!done && !note) note = `không tìm được cột khớp màu ${mv.colors} tại nước ${ok + bad}`;
      } else {
        const p = s.slots[mv.slot];
        if (p && p.color === mv.colors[0]) tapBay(s, mv.slot);
        else {
          // slot lệch — tìm slot khác cùng màu
          const alt = s.slots.findIndex((x) => x && x.color === mv.colors[0]);
          if (alt >= 0) tapBay(s, alt);
          else if (!note) note = `bayTap slot${mv.slot} màu ${mv.colors[0]} không có trong sim`;
        }
      }
    }
    const rem = remaining(s);
    const simResult = rem === 0 ? "win" : "(còn " + rem + " ô)";
    console.log(`ván#${gi}: ${g.moves.length} nước | freeSlots khớp ${ok}/${ok + bad} | log=${g.result ?? "bỏ ngang"} sim=${simResult} ${note ? "| " + note : ""}`);
  });
}

// ---------------- rollout solver trên simCore (policy tier + noise) ----------------
const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };
export function cloneState(s) {
  return { cols: s.cols, rows: s.rows, occ: s.occ.slice(), lay: s.lay ? s.lay.slice() : null, queue: s.queue.map((c) => c.map((m) => ({ ...m }))), slots: s.slots.map((p) => (p ? { ...p } : null)) };
}
// ước ăn/thừa nếu phóng nhóm này NGAY (trên clone)
function estimate(s, group) {
  const c2 = cloneState(s);
  const g2 = group.map((m) => ({ ...m }));
  let eaten = 0;
  for (const m of g2) { const before = m.cap; collectFix(c2, m); eaten += before - m.cap; }
  const leftover = g2.reduce((a, m) => a + m.cap, 0);
  return { eaten, leftover };
}
export function rollout(state, seed) {
  const rng = mkRng(seed);
  const s = cloneState(state);
  const plan = [];
  let guard = 0;
  while (remaining(s) > 0 && guard++ < 500) {
    // bay productive: mỗi xe ăn được = 1 tap (ưu tiên tuyệt đối, như bot)
    let any = true;
    while (any && remaining(s) > 0) {
      any = false;
      const S = reachableColors(s);
      for (let i = 0; i < s.slots.length; i++) {
        const p = s.slots[i];
        if (p && p.cap > 0 && S.has(p.color)) { plan.push("bay" + i); tapBay(s, i); any = true; break; }
      }
    }
    if (remaining(s) === 0) break;
    const fs2 = freeSlots(s);
    // ứng viên cột
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
  console.log(`L${lvl}: ${wins}/${N} rollout thắng trên simCore`, wins ? JSON.stringify(firsts) : "");
}
