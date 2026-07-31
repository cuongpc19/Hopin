// Tô lại VIỀN TRẮNG-8/XÁM-9 (user 2026-08-01: khối trắng "chết" xấu) → màu sống (kem/nâu/
// xanh, né màu sát ranh) + re-car + retune về đúng target. Level nào retune trượt ±7 thì
// GIỮ NGUYÊN bản cũ (an toàn).
import fs from "fs";
import {
  readD, writeD, measure, colorDepth, reCar, makeOrder, addGentleTwins, addBaggageTwins, addBuried,
} from "./genlib.mjs";

const TARGET = {
  4: 95, 5: 70, 7: 90, 12: 85, 13: 95, 14: 85, 15: 60, 16: 100, 19: 80, 23: 95, 24: 90,
  132: 38, 134: 34, 138: 26, 140: 22, 141: 20, 146: 25, 150: 22, 151: 18,
};
const isC = (v) => v >= 0 && v < 90;
const PREFER = [14, 10, 11, 13, 15, 16, 17];
const LOG = "scripts/_fixwhite-log.txt";
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
fs.writeFileSync(LOG, "");

const d = readD();
for (const kS of Object.keys(TARGET)) {
  const k = +kS;
  const L = d[k];
  if (!L) continue;
  const { cols, rows } = L;
  const backup = JSON.stringify(L);
  // 1. rim trắng/xám (mảng ≥30 chạm rìa)
  const seen = new Array(L.board.length).fill(false);
  const rimCells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (!isC(L.board[i]) || seen[i]) continue;
    const col = L.board[i], q = [i]; seen[i] = true; const comp = [i]; let edge = false;
    while (q.length) {
      const cur = q.pop(), cr = (cur / cols) | 0, cc = cur % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) { edge = true; continue; }
        const ni = nr * cols + nc;
        if (!isC(L.board[ni])) { if (L.board[ni] < 90) edge = true; continue; }
        if (L.board[ni] === col && !seen[ni]) { seen[ni] = true; q.push(ni); comp.push(ni); }
      }
    }
    if (edge && comp.length >= 30 && (col === 8 || col === 9)) rimCells.push(...comp);
  }
  if (rimCells.length < 30) { log(`L${k}: không có rim trắng — bỏ qua`); continue; }
  // 2. màu thay: né màu sát ranh (8 hướng quanh rim, trừ 8/9)
  const rimSet = new Set(rimCells);
  const adj = new Set();
  for (const i of rimCells) {
    const r = (i / cols) | 0, c = i % cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const v = L.board[nr * cols + nc];
      if (isC(v) && v !== 8 && v !== 9 && !rimSet.has(nr * cols + nc)) adj.add(v);
    }
  }
  const newCol = PREFER.find((c) => !adj.has(c));
  if (newCol == null) { log(`L${k}: không màu nào hợp lệ — giữ nguyên`); continue; }
  for (const i of rimCells) L.board[i] = newCol;
  // 3. re-car + retune về target (giữ số twin + số xe "?")
  const target = TARGET[k];
  const nTwin = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const nBuried = L.chests.filter((c) => c.buried).length;
  const cdep = colorDepth(L);
  let best = null;
  for (const cfg of [{ bgHead: 2, deepN: 1 }, { bgHead: 2, deepN: 0 }, { gentle: true }, { bgHead: 3, deepN: 2 }, { bgHead: 3, deepN: 3 }]) {
    for (let seed = 1; seed <= 10; seed++) {
      const cars = reCar(L, k * 31 + seed * 7, { minCars: 12 });
      L.chests = makeOrder(cars, cdep, k * 7919 + seed * 137, { bgColor: newCol, ...cfg });
      if (nTwin > 0) {
        const made = k >= 131 ? addBaggageTwins(L, nTwin, cdep, k * 17 + seed) : addGentleTwins(L, nTwin, k * 449 + seed, cdep);
        if (made < Math.min(nTwin, 1)) continue;
      }
      const q = measure(L, 20);
      if (Math.abs(q - target) > 14 && !(target >= 95 && q >= 90)) continue;
      const full = measure(L, 64);
      const dist = Math.abs(full - target);
      if (!best || dist < best.dist) best = { dist, full, chests: JSON.parse(JSON.stringify(L.chests)) };
      if (dist <= 3) break;
    }
    if (best && best.dist <= 3) break;
  }
  if (!best || best.dist > 7) {
    d[k] = JSON.parse(backup); // trượt → trả nguyên bản
    log(`L${k}: retune trượt (best ${best ? best.full : "-"}/${target}) — GIỮ viền trắng cũ`);
    continue;
  }
  L.chests = best.chests;
  if (nBuried > 0) addBuried(L, nBuried / Math.max(1, L.chests.filter((c) => c.pairId == null).length - 8), k * 131 + 7, L.lanes || 4);
  writeD(d);
  log(`L${k}: viền 8/9 (${rimCells.length} ô) → id${newCol} | trip-sim ${best.full}% (target ${target}) ✓`);
}
log("✔ fix-white xong");
