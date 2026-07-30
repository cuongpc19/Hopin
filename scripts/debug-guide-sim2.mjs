// debug-guide-sim2.mjs — rollout NGẪU-NHIÊN-HOÁ (bay-aware, seeded) từ trạng thái đầu level:
// chạy N seed, đếm bao nhiêu rollout THẮNG. Nếu >0 cho các level bot-MC thắng được thì chiến
// lược "guide = nước đầu của rollout thắng" là khả thi — port sang GameScene.
import fs from "fs";
const lvl = Number(process.argv[2] || 148);
const N = Number(process.env.N || 40);
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const L = d[lvl];
const cols = L.cols, rows = L.rows, lanes = L.lanes || 4;
const isC = (v) => v >= 0 && v < 90;
const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };

function rollout(seed, wantFirst) {
  const rng = mkRng(seed);
  const occ = L.board.slice();
  const lay = L.layer2 ? L.layer2.slice() : null;
  const queue = Array.from({ length: lanes }, () => []);
  L.chests.forEach((c, i) => queue[i % lanes].push({ color: c.color, cap: c.count, pid: c.pairId ?? null }));
  const parked = [null, null, null, null, null];
  let remaining = occ.reduce((a, v) => a + (isC(v) ? 1 : 0), 0) + (lay ? lay.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) : 0);
  const clearCell = (i) => { if (lay && lay[i] >= 0) { occ[i] = lay[i]; lay[i] = -1; } else occ[i] = -1; remaining--; };
  const exposed = () => {
    const E = new Set();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
      for (let c = cols - 1; c >= 0; c--) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
      for (let r = rows - 1; r >= 0; r--) { const i = r * cols + c; if (isC(occ[i])) { E.add(i); break; } }
    }
    return E;
  };
  const collect = (car) => {
    for (;;) {
      if (car.cap <= 0) return;
      const E = exposed();
      let t = -1;
      for (const i of E) if (occ[i] === car.color) { t = i; break; }
      if (t < 0) return;
      clearCell(t); car.cap--;
    }
  };
  let first = null;
  let guard = 0;
  while (remaining > 0 && guard++ < 500) {
    // bay productive — ăn hết vòng
    let any = true;
    while (any) {
      any = false;
      const E = exposed(); const S = new Set(); for (const i of E) S.add(occ[i]);
      for (let i = 0; i < parked.length; i++) {
        const p = parked[i];
        if (p && p.cap > 0 && S.has(p.color)) { if (!first) first = "bay" + i; collect(p); if (p.cap === 0) parked[i] = null; any = true; break; }
      }
    }
    if (remaining === 0) break;
    const E = exposed(); const S = new Set(); for (const i of E) S.add(occ[i]);
    const freeBays = parked.filter((x) => x === null).length;
    // ứng viên queue
    const fronts = [];
    for (let j = 0; j < queue.length; j++) {
      const f = queue[j][0]; if (!f) continue;
      if (f.pid == null) { fronts.push({ j, group: [f] }); continue; }
      const members = []; let okG = true;
      for (let jj = 0; jj < queue.length; jj++) for (let r = 0; r < queue[jj].length; r++) { const c = queue[jj][r]; if (c.pid === f.pid) { if (queue[jj].slice(0, r).some((x) => x.pid !== f.pid)) okG = false; members.push(c); } }
      if (okG && members.length >= 2) fronts.push({ j, group: members });
    }
    const seenPid = new Set();
    const uniq = fronts.filter((f) => { const pid = f.group[0].pid; if (pid == null) return true; if (seenPid.has(pid)) return false; seenPid.add(pid); return true; });
    const fit = uniq.filter((f) => freeBays >= f.group.length);
    // phân loại: productive (màu nào đó ∈ S) vs dig
    const prods = fit.filter((f) => f.group.some((m) => m.cap > 0 && S.has(m.color)));
    const digs = fit.filter((f) => !f.group.some((m) => m.cap > 0 && S.has(m.color)));
    // trọng số: productive 8 (nếu freeBays≥2) / 3 (nếu=1); dig 2 (freeBays≥2) / 0.5 (=1); cột dài dig ưu tiên
    const opts = [];
    for (const f of prods) opts.push({ f, w: freeBays >= 2 ? 8 : 3 });
    for (const f of digs) opts.push({ f, w: (freeBays >= 2 ? 2 : 0.5) * (1 + f.group.length === 1 ? queue[f.j].length / 10 : 0) });
    if (!opts.length) break; // hết nước
    let sum = 0; for (const o of opts) sum += o.w;
    let r = rng() * sum, pick = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    const f = pick.f;
    if (!first) first = "q" + f.j + ":" + f.group[0].color;
    for (const m of f.group) { for (const col of queue) { const k = col.indexOf(m); if (k >= 0) { col.splice(k, 1); break; } } }
    for (const m of f.group) collect(m);
    for (const m of f.group) if (m.cap > 0) { const slot = parked.indexOf(null); if (slot >= 0) parked[slot] = m; }
  }
  return { win: remaining === 0, first };
}

let wins = 0; const firstOfWin = {};
for (let s = 1; s <= N; s++) {
  const r = rollout(s * 7919 + 13);
  if (r.win) { wins++; firstOfWin[r.first] = (firstOfWin[r.first] || 0) + 1; }
}
console.log(`L${lvl}: ${wins}/${N} rollout thắng`, wins ? "| nước đầu các ván thắng: " + JSON.stringify(firstOfWin) : "");
