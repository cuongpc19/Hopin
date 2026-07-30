// debug-guide-sim.mjs — chạy ĐÚNG logic simPlayout của GameScene (bản port guide) trên một level
// từ trạng thái đầu, để so với solvable() gốc. Tìm chỗ bản port lệch khiến guide toàn "F".
import fs from "fs";
const lvl = Number(process.argv[2] || 148);
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const L = d[lvl];
const cols = L.cols, rows = L.rows;
const lanes = L.lanes || 4;
const isC = (v) => v >= 0 && v < 90;

// state như captureSimState đầu ván
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
// POLICY v2 (bay-aware, mô phỏng kỷ luật của bot autoDrive):
//  vòng: (1) mọi xe Ô CHỜ productive ăn (lặp tới hết); (2) trong các nước queue:
//   a) xe/nhóm ĂN HẾT (leftover 0 — bay-neutral) gain lớn nhất
//   b) nhóm productive (đủ ô)
//   c) blocker productive CHỈ khi freeBays≥2 (giữ đệm), gain lớn nhất, leftover nhỏ nhất
//   d) dig CHỈ khi freeBays≥2: cột dài nhất
//   e) send-group vừa ô
//  hết nước → thua.
const TRACE = process.env.TRACE === "1";
// thử-collect trên bản sao để đo ăn được bao nhiêu / còn thừa bao nhiêu
const tryCollect = (car) => {
  const o2 = occ.slice(), l2 = lay ? lay.slice() : null;
  let cap = car.cap, eaten = 0;
  const exp2 = () => {
    const E = new Set();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) { const i = r * cols + c; if (isC(o2[i])) { E.add(i); break; } }
      for (let c = cols - 1; c >= 0; c--) { const i = r * cols + c; if (isC(o2[i])) { E.add(i); break; } }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) { const i = r * cols + c; if (isC(o2[i])) { E.add(i); break; } }
      for (let r = rows - 1; r >= 0; r--) { const i = r * cols + c; if (isC(o2[i])) { E.add(i); break; } }
    }
    return E;
  };
  for (;;) {
    if (cap <= 0) break;
    const E = exp2();
    let t = -1;
    for (const i of E) if (o2[i] === car.color) { t = i; break; }
    if (t < 0) break;
    if (l2 && l2[t] >= 0) { o2[t] = l2[t]; l2[t] = -1; } else o2[t] = -1;
    cap--; eaten++;
  }
  return { eaten, leftover: cap };
};
let guard = 0;
while (remaining > 0 && guard++ < 500) {
  // (1) mọi bay productive ăn (lặp — ăn xong có thể mở màu cho bay khác)
  let acted = false;
  for (;;) {
    const E = exposed();
    const S = new Set(); for (const i of E) S.add(occ[i]);
    let one = false;
    for (let i = 0; i < parked.length; i++) {
      const p = parked[i];
      if (p && p.cap > 0 && S.has(p.color)) { if (TRACE) console.log(guard, "bay", i, "màu", p.color); collect(p); if (p.cap === 0) parked[i] = null; one = acted = true; break; }
    }
    if (!one) break;
  }
  if (remaining === 0) break;
  const E = exposed();
  const S = new Set(); for (const i of E) S.add(occ[i]);
  const freeBays = parked.filter((x) => x === null).length;
  const fronts = [];
  for (let j = 0; j < queue.length; j++) {
    const f = queue[j][0]; if (!f) continue;
    if (f.pid == null) { fronts.push({ j, group: [f] }); continue; }
    const members = [];
    let okG = true;
    for (let jj = 0; jj < queue.length; jj++) {
      for (let r = 0; r < queue[jj].length; r++) {
        const c = queue[jj][r];
        if (c.pid === f.pid) { if (queue[jj].slice(0, r).some((x) => x.pid !== f.pid)) okG = false; members.push(c); }
      }
    }
    if (okG && members.length >= 2) fronts.push({ j, group: members });
  }
  const seenPid = new Set();
  const uniq = fronts.filter((f) => { const pid = f.group[0].pid; if (pid == null) return true; if (seenPid.has(pid)) return false; seenPid.add(pid); return true; });
  const doLaunch = (pick, label) => {
    if (TRACE) console.log(guard, label, "cột", pick.j, "màu", pick.group.map((m) => m.color + ":" + m.cap).join("+"));
    for (const m of pick.group) { for (const col of queue) { const k = col.indexOf(m); if (k >= 0) { col.splice(k, 1); break; } } }
    for (const m of pick.group) collect(m);
    for (const m of pick.group) if (m.cap > 0) { const slot = parked.indexOf(null); if (slot >= 0) parked[slot] = m; }
  };
  // đo từng ứng viên solo/nhóm
  const meta = uniq.filter((f) => freeBays >= f.group.length).map((f) => {
    let eaten = 0, leftover = 0;
    for (const m of f.group) { const r = tryCollect(m); eaten += r.eaten; leftover += r.leftover; }
    return { ...f, eaten, leftover };
  });
  // a) ăn hết + có ăn
  const clean = meta.filter((m) => m.leftover === 0 && m.eaten > 0).sort((a, b) => b.eaten - a.eaten);
  if (clean.length) { doLaunch(clean[0], "clean"); continue; }
  // b) nhóm productive
  const grpProd = meta.filter((m) => m.group.length > 1 && m.eaten > 0).sort((a, b) => b.eaten - a.eaten);
  if (grpProd.length) { doLaunch(grpProd[0], "group"); continue; }
  // c) blocker productive khi còn đệm
  if (freeBays >= 2) {
    const blk = meta.filter((m) => m.eaten > 0).sort((a, b) => b.eaten - a.eaten || a.leftover - b.leftover);
    if (blk.length) { doLaunch(blk[0], "blocker"); continue; }
  }
  // d) dig khi còn đệm
  if (freeBays >= 2) {
    let bj = -1, bl = -1;
    for (let j = 0; j < queue.length; j++) { const f = queue[j][0]; if (f && f.pid == null && queue[j].length > bl) { bl = queue[j].length; bj = j; } }
    if (bj >= 0) { doLaunch({ j: bj, group: [queue[bj][0]] }, "dig"); continue; }
  }
  // e) send-group
  const g = uniq.find((f) => f.group[0].pid != null && freeBays >= f.group.length);
  if (g) { doLaunch(g, "send-group"); continue; }
  // f) tuyệt vọng: nếu còn đúng 1 ô trống mà có nước productive → đành phóng (hơn là chết đứng)
  if (freeBays === 1) {
    const blk = meta.filter((m) => m.eaten > 0).sort((a, b) => b.eaten - a.eaten);
    if (blk.length) { doLaunch(blk[0], "last-resort"); continue; }
    let bj = -1, bl = -1;
    for (let j = 0; j < queue.length; j++) { const f = queue[j][0]; if (f && f.pid == null && queue[j].length > bl) { bl = queue[j].length; bj = j; } }
    if (bj >= 0) { doLaunch({ j: bj, group: [queue[bj][0]] }, "last-dig"); continue; }
  }
  if (acted) continue; // bay đã ăn gì đó vòng này — thử vòng mới
  console.log("KẸT ở bước", guard, "| còn", remaining, "ô | ô chờ:", parked.map((p) => (p ? p.color + ":" + p.cap : "-")).join(" "), "| fronts:", queue.map((c) => (c[0] ? c[0].color + ":" + c[0].cap : "-")).join(" "), "| màu lộ:", [...S].join(","));
  break;
}
console.log(remaining === 0 ? "✔ SIM v2 THẮNG (" + guard + " bước)" : "✘ SIM v2 THUA — còn " + remaining + " ô sau " + guard + " bước");
