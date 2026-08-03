// mcts — MÔ HÌNH E: Monte Carlo Tree Search trên thế giới ĐỒNG THỜI của simcore2.
//
// Khác gì các mô hình trước:
//   • A/B chơi bằng MỘT chính sách cố định (tham lam + nhiễu) — chúng đo "chính sách đó
//     thắng bao nhiêu", không phải "level này có thể thắng tới đâu với người biết nghĩ".
//   • Monte-Carlo cũ (playAverage) tung ngẫu nhiên quanh một chính sách cố định — đã bỏ
//     vì không đơn điệu theo tay nghề.
//   • MCTS thì XÂY CÂY: tại mỗi thế cờ nó thử từng nước, dồn lượt mô phỏng vào nhánh đang
//     hứa hẹn (công thức UCT), nên tự tìm ra đường thoát mà chính sách cố định bỏ lỡ —
//     và không dính lỗi "xác định nên kẹt lặp lại" của bản Monte-Carlo cũ.
//
// Winrate đọc là "người chơi CÓ CÂN NHẮC vài nước trước": mỗi ván thật sự, tại mỗi lượt
// quyết định, chạy một cây ITER lượt (mặc định 60) sâu vài nước + rollout nhanh, rồi đi
// nước tốt nhất. Đắt hơn A/B nhiều — dùng N nhỏ (16-24 ván).
//
//   node scripts/mcts.mjs 15-46            → in bảng
//   N=16 ITER=60 node scripts/mcts.mjs 10
import fs from "node:fs";
import {
  makeState, cloneState, laneSeq, reachableColors, slotEntryLaneIndex,
  remaining, freeSlots, headGroup,
} from "./simcore.mjs";
import { mkWorld, launchCol, tapSlot, tick, onRayCount } from "./simcore2.mjs";

const ITER = Number(process.env.ITER || 60);     // lượt mô phỏng cho mỗi quyết định
const HORIZON = Number(process.env.HORIZON || 3); // độ sâu cây (số quyết định nhìn trước)
const N_GAMES = Number(process.env.N || 16);
// TAY NGHỀ (user 2026-08-03: "sao đoán toàn 0 và 100 nhỉ"). Bản đầu luôn lấy nước TỐT NHẤT
// theo cây → nó chơi y hệt mọi ván, phương sai bằng 0, nên winrate chỉ có thể là 0 hoặc 100.
// Người thật thì thỉnh thoảng chọn nước hạng nhì. Ở đây nước ở gốc được BỐC theo softmax
// trên giá trị cây với nhiệt độ T = (1-skill)·SPREAD: skill→1 thành lấy-tốt-nhất như cũ,
// skill thấp thì hay lạc sang nước kém hơn → winrate trải ra khoảng giữa.
const SKILL = Number(process.env.SKILL ?? 0.75);
const SPREAD = Number(process.env.SPREAD ?? 1.2); // hệ số đổi tay-nghề → nhiệt độ τ

const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };

// ---- bản sao sâu thế giới (giống simcore2.cloneWorld, chép lại vì nó không export) ----
function cloneWorld(w) {
  const s = cloneState(w.s);
  const map = new Map();
  w.s.queue.forEach((col, j) => col.forEach((m, k) => map.set(m, s.queue[j][k])));
  w.s.slots.forEach((m, i) => { if (m) map.set(m, s.slots[i]); });
  const flying = w.flying.map((u) => {
    const members = u.members.map((m) => map.get(m) || { ...m });
    const ate = new Map();
    members.forEach((m, k) => ate.set(m, u.ate.get(u.members[k]) ?? 0));
    return { members, slots: u.slots.slice(), pos: u.pos, steps: u.steps, ate };
  });
  return { s, seq: w.seq, flying, t: w.t, trips: [] };
}

const isOut = (w, m) => w.flying.some((u) => u.members.includes(m));

// ---- các nước đi hợp lệ tại một thế cờ --------------------------------------
// "wait" = không bấm gì, cho thế giới chạy tới điểm quyết định sau — nước này QUAN
// TRỌNG: nhiều thế chỉ thắng nếu chịu chờ xe trên ray ăn xong thay vì nhồi thêm xe.
function legalMoves(w) {
  const moves = [];
  const S = reachableColors(w.s);
  for (let i = 0; i < w.s.slots.length; i++) {
    const p = w.s.slots[i];
    if (p && !isOut(w, p) && p.cap > 0 && S.has(p.color)) moves.push("bay" + i);
  }
  const fs2 = freeSlots(w.s);
  const seenPid = new Set();
  for (let j = 0; j < w.s.queue.length; j++) {
    const grp = headGroup(w.s, j);
    if (!grp) continue;
    const pid = grp[0].pid;
    if (pid != null) { if (seenPid.has(pid)) continue; seenPid.add(pid); }
    if (fs2 < grp.length) continue;
    if (onRayCount(w) + grp.length > grp.length + 4) continue; // trần 5 xe trên ray
    moves.push("q" + j);
  }
  if (w.flying.length > 0) moves.push("wait");
  return moves;
}

function applyMove(w, mv) {
  if (mv === "wait") return true;
  if (mv.startsWith("bay")) return tapSlot(w, parseInt(mv.slice(3), 10));
  return launchCol(w, parseInt(mv.slice(1), 10));
}

// Chạy thế giới tới điểm quyết định kế: có nước đi mới xuất hiện, hoặc ray lặng hẳn.
// Trả false nếu thế giới chết cứng (kẹt).
function advance(w, maxTicks = 220) {
  let stale = 0;
  for (let i = 0; i < maxTicks; i++) {
    if (remaining(w.s) === 0) return true;
    const before = remaining(w.s);
    tick(w);
    if (remaining(w.s) < before) stale = 0; else stale++;
    const mvs = legalMoves(w);
    // dừng khi có lựa chọn thật sự (ngoài "wait") hoặc ray đã trống
    if (mvs.some((m) => m !== "wait")) return true;
    if (w.flying.length === 0) return mvs.length > 0;
    if (stale > w.seq.length * 2) return remaining(w.s) === 0;
  }
  return true;
}

// ---- rollout nhanh: chính sách tham lam rẻ (không estimate) để chấm lá cây ----
function quickPlayout(w, rng, maxDecisions = 45) {
  let lastRem = remaining(w.s), flat = 0;
  for (let d = 0; d < maxDecisions; d++) {
    const rem = remaining(w.s);
    if (rem === 0) return 1;
    if (rem >= lastRem) { if (++flat > 6) break; } else { flat = 0; lastRem = rem; }
    const mvs = legalMoves(w);
    if (!mvs.length) return 0;
    // ưu tiên bấm xe ô chờ (giải phóng ô), rồi phóng hàng, thi thoảng wait
    const bays = mvs.filter((m) => m.startsWith("bay"));
    const qs = mvs.filter((m) => m.startsWith("q"));
    let mv;
    if (bays.length && rng() < 0.7) mv = bays[Math.floor(rng() * bays.length)];
    else if (qs.length) mv = qs[Math.floor(rng() * qs.length)];
    else mv = mvs[Math.floor(rng() * mvs.length)];
    applyMove(w, mv);
    if (!advance(w)) return remaining(w.s) === 0 ? 1 : 0;
  }
  // hết ngân sách: chấm phần đã dọn được (tín hiệu mềm thay vì 0/1 khắc nghiệt)
  const total = w.s.occ.length;
  return Math.max(0, 1 - remaining(w.s) / total) * 0.5;
}

// ---- một quyết định bằng cây UCT sâu HORIZON --------------------------------
function decide(w, rng) {
  const rootMoves = legalMoves(w);
  if (!rootMoves.length) return null;
  if (rootMoves.length === 1) return rootMoves[0];
  const stats = new Map(rootMoves.map((m) => [m, { n: 0, sum: 0 }]));
  const C = 1.1; // hằng số khám phá UCT
  for (let it = 0; it < ITER; it++) {
    // 1) CHỌN nước ở gốc theo UCT
    let mv = null, bestU = -Infinity;
    const totalN = it + 1;
    for (const m of rootMoves) {
      const st = stats.get(m);
      const u = st.n === 0 ? Infinity : st.sum / st.n + C * Math.sqrt(Math.log(totalN) / st.n);
      if (u > bestU) { bestU = u; mv = m; }
    }
    // 2) MỞ RỘNG + MÔ PHỎNG: đi nước đó, thêm (HORIZON-1) nước ngẫu nhiên, rồi rollout
    const c = cloneWorld(w);
    applyMove(c, mv);
    let dead = !advance(c);
    for (let h = 1; h < HORIZON && !dead && remaining(c.s) > 0; h++) {
      const mvs = legalMoves(c);
      if (!mvs.length) { dead = true; break; }
      applyMove(c, mvs[Math.floor(rng() * mvs.length)]);
      dead = !advance(c);
    }
    const r = dead && remaining(c.s) > 0 ? 0 : quickPlayout(c, rng);
    // 3) LAN TRUYỀN
    const st = stats.get(mv);
    st.n++; st.sum += r;
  }
  // CHỌN NƯỚC Ở GỐC — theo chuẩn MCTS: dùng SỐ LƯỢT THĂM, không dùng giá trị trung bình.
  // Bản đầu tôi softmax trên Q (giá trị TB) là SAI so với thông lệ: một nước mới thăm 1 lần
  // mà rollout gặp may sẽ có Q=1.0, ngang nước đã thăm 15 lần với Q=0.7 — tức khuếch đại
  // nhiễu. Số lượt thăm mới là thống kê vững, vì UCT đã tự dồn lượt vào nhánh tốt nên N gói
  // cả giá trị lẫn độ tin cậy. Đây đúng công thức AlphaZero: π(a) ∝ N(a)^(1/τ); τ→0 thành
  // "robust child" (lấy nước được thăm nhiều nhất) — lựa chọn chuẩn khi chơi ăn thua.
  const tau = (1 - SKILL) * SPREAD;
  const ns = rootMoves.map((m) => ({ m, n: stats.get(m).n }));
  if (tau <= 1e-3) {
    let best = ns[0];
    for (const x of ns) if (x.n > best.n) best = x;
    return best.m;
  }
  // tính trong log-space để N^(1/τ) không tràn số khi τ nhỏ
  const logs = ns.map((x) => (x.n > 0 ? Math.log(x.n) / tau : -Infinity));
  const mx = Math.max(...logs);
  const ws = logs.map((v) => (v === -Infinity ? 0 : Math.exp(v - mx)));
  const sum = ws.reduce((acc, c) => acc + c, 0);
  if (!(sum > 0)) return ns[0].m;
  let pick = rng() * sum;
  for (let i = 0; i < ns.length; i++) { pick -= ws[i]; if (pick <= 0) return ns[i].m; }
  return ns[ns.length - 1].m;
}

// ---- một ván đầy đủ do MCTS cầm lái -----------------------------------------
export function playMcts(L, seed) {
  const w = mkWorld(L);
  const rng = mkRng(seed);
  for (let d = 0; d < 400; d++) {
    if (remaining(w.s) === 0) return true;
    const mv = decide(w, rng);
    if (!mv) return remaining(w.s) === 0;
    applyMove(w, mv);
    if (!advance(w)) return remaining(w.s) === 0;
  }
  return remaining(w.s) === 0;
}

export function measureMcts(L, N = N_GAMES, seedBase = 7919) {
  let wins = 0;
  for (let t = 1; t <= N; t++) if (playMcts(L, t * seedBase + 13)) wins++;
  return Math.round((100 * wins) / N);
}

// ---- CLI --------------------------------------------------------------------
const arg = process.argv[2];
if (arg) {
  const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
  const [a, b] = arg.includes("-") ? arg.split("-").map(Number) : [Number(arg), Number(arg)];
  console.log(`MCTS (E): N=${N_GAMES} van, ITER=${ITER}, HORIZON=${HORIZON}\n`);
  for (let k = a; k <= b; k++) {
    const L = d[k];
    if (!L || !Array.isArray(L.board)) continue;
    const t0 = Date.now();
    const w = measureMcts(L);
    console.log(`L${String(k).padStart(2)}: ${String(w).padStart(3)}%  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
