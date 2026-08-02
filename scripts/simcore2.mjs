// simcore2 — MÔ HÌNH B: sim ĐỒNG THỜI theo nhịp.
//
// Khác simcore.mjs (mô hình A) đúng MỘT điểm, nhưng là điểm cốt tử: A cho từng xe đi
// TRỌN một chuyến rồi mới tới xe sau; game thật cho tới 5 xe cùng chạy trên ray, xe sau
// ăn trên tấm bàn mà xe trước vừa gặm dở. Phát lại ván thật của user cho thấy A chỉ khớp
// 15/39 chuyến (2026-08-02) — đó là lý do file này tồn tại.
//
// Ở đây thế giới tiến theo NHỊP: mỗi nhịp, MỌI xe đang bay tiến đúng một làn rồi ăn tại
// làn đó. Cách ăn xen kẽ giữa các xe cùng làn dùng lại đúng mô hình đã vá cho xe đôi
// (A,B,A,B — xe sau hưởng ngay ô xe trước vừa mở). Toàn bộ phần bắn tia / xoá ô / tính
// màu-với-tới-được lấy nguyên từ simcore.mjs, KHÔNG sửa, để khác biệt đo được chỉ đến từ
// tính đồng thời.
import {
  makeState, cloneState, laneSeq, reachableColors, slotEntryLaneIndex,
  remaining, freeSlots, headGroup, nearestTarget, clearCell,
} from "./simcore.mjs";

const MAX_ON_TRACK = 5;   // trần xe cùng lúc trên ray (= SLOT_COUNT trong GameScene)
const PER_LANE = 14;      // trần ăn mỗi lượt qua một làn (giống A)
const DECIDE_EVERY = 8;   // bao nhiêu nhịp thì người chơi được cân nhắc phóng xe mới

export function mkWorld(L) {
  const s = makeState(L);
  return { s, seq: laneSeq(s), flying: [], t: 0, trips: [] };
}

export function onRayCount(w) {
  return w.flying.reduce((a, u) => a + u.members.length, 0);
}
const isOut = (w, m) => w.flying.some((u) => u.members.includes(m));

// ---- hành động của người chơi ----------------------------------------------
export function launchCol(w, j) {
  const s = w.s;
  const grp = headGroup(s, j);
  if (!grp) return false;
  if (freeSlots(s) < grp.length) return false;
  if (onRayCount(w) + grp.length > MAX_ON_TRACK) return false;
  for (const m of grp) for (const col of s.queue) { const k = col.indexOf(m); if (k >= 0) { col.splice(k, 1); break; } }
  const slots = [];
  for (const m of grp) { const sl = s.slots.indexOf(null); s.slots[sl] = m; slots.push(sl); }
  // nhóm vào ray ở lane 0 (spawnGroup startIndex), xe lẻ vào ngay trên ô của nó
  const entry = grp.length > 1 ? 0 : slotEntryLaneIndex(s, slots[0]);
  w.flying.push({ members: grp.slice(), slots, pos: entry, steps: 0, ate: new Map(grp.map((m) => [m, 0])) });
  return true;
}

export function tapSlot(w, i) {
  const s = w.s;
  const p = s.slots[i];
  if (!p || isOut(w, p)) return false;
  let members = [p], slots = [i];
  if (p.pid != null) { // bấm 1 thành viên nhóm → cả nhóm còn đỗ cùng phóng lại
    members = []; slots = [];
    s.slots.forEach((m, k) => { if (m && m.pid === p.pid && !isOut(w, m)) { members.push(m); slots.push(k); } });
  }
  if (!members.length) return false;
  if (onRayCount(w) + members.length > MAX_ON_TRACK) return false;
  const entry = members.length > 1 ? 0 : slotEntryLaneIndex(s, i);
  w.flying.push({ members, slots, pos: entry, steps: 0, ate: new Map(members.map((m) => [m, 0])) });
  return true;
}

// ---- một nhịp thế giới ------------------------------------------------------
function retire(w, u) {
  const s = w.s;
  const allFull = u.members.every((m) => m.cap <= 0);
  for (let k = 0; k < u.members.length; k++) {
    const m = u.members[k], sl = u.slots[k];
    w.trips.push({ color: m.color, ate: u.ate.get(m), capLeft: m.cap, back: allFull ? "left" : "slot" });
    // Chuyến ăn 0 trên tấm bàn KHÔNG đổi = xe này chứng minh nó hết nước đi cho tới khi bàn
    // đổi (đúng luật futileAtSeq đã vá trong GameScene). Không có nó, chính sách bấm lại xe
    // vô ích vô hạn rồi bộ đếm ì tưởng là kẹt → chấm oan (L28: 5% dù người thật thắng được).
    if (u.ate.get(m) === 0) m.futileAt = remaining(s); else m.futileAt = undefined;
    // Nhóm chỉ rời đi khi MỌI thành viên đầy (finishCar); chưa đủ thì cả nhóm về ô đã giữ.
    s.slots[sl] = allFull ? null : m;
  }
  w.flying.splice(w.flying.indexOf(u), 1);
}

// "Tăng tốc cuối màn" (GameScene: const boost = queueEmpty()): khi hàng xe đã rỗng, xe
// KHÔNG bao giờ về đỗ nữa mà cứ chạy vòng cho tới khi đầy (`if (boost || canKeepCircling)`
// trong stepCar) — nên cuối ván không thể kẹt ô chờ vì xe đỗ. Thiếu điều này thì sim bắt xe
// về ô quá sớm và dựng ra thế kẹt không có thật (lộ ra khi phát lại L1: hàng rỗng ngay).
const queueEmpty = (s) => s.queue.every((col) => col.length === 0);

export function tick(w) {
  const s = w.s, seq = w.seq, N = seq.length;
  const boost = queueEmpty(s);
  for (const u of [...w.flying]) {
    if (!w.flying.includes(u)) continue;
    u.pos = (u.pos + 1) % N;
    u.steps++;
    const { e, l } = seq[u.pos];
    const per = new Map(u.members.map((m) => [m, 0]));
    let progress = true;
    while (progress) {
      progress = false;
      for (const m of u.members) {
        if (m.cap <= 0 || per.get(m) >= PER_LANE) continue;
        const h = nearestTarget(s, e, l, m.color);
        if (!h) continue;
        clearCell(s, h.idx);
        m.cap--; per.set(m, per.get(m) + 1); u.ate.set(m, u.ate.get(m) + 1);
        progress = true;
      }
    }
    if (u.members.every((m) => m.cap <= 0)) { retire(w, u); continue; } // đầy → rời ngay
    if (u.steps >= N) { // trọn một vòng: còn với tới được thì chạy tiếp, không thì về ô
      u.steps = 0;
      if (boost) continue; // hàng rỗng → chạy vòng mãi, không về đỗ (stepCar: boost ||)
      const S = reachableColors(s);
      if (!u.members.some((m) => m.cap > 0 && S.has(m.color))) retire(w, u);
    }
  }
  w.t++;
}

// ---- chính sách chơi (giữ NGUYÊN họ tier của mô hình A) ----------------------
// Bản sao SÂU của cả thế giới: trạng thái + các xe đang bay (giữ đúng vị trí trên vòng).
// Phải sao cả xe đang bay thì ước lượng mới đúng — xem estimate() bên dưới.
function cloneWorld(w) {
  const s = cloneState(w.s);
  // cloneState sao các xe trong queue/slots thành object MỚI; lập bảng tra theo danh tính cũ
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

// Ước lượng một cú phóng — CHẠY TRÊN CẢ THẾ GIỚI ĐANG ĐỘNG, không phải một mình.
// Bản đầu tôi thử chuyến đơn độc trên bản sao (giống mô hình A) và nó chấm L28 = 5%: vì
// bỏ qua 1-4 xe đang bay sẽ ăn tranh mất ô, ước lượng quá lạc quan → chính sách phóng
// những xe không bao giờ đầy → 5 ô chờ kẹt cứng. Ở thế giới đồng thời thì ước lượng cũng
// buộc phải đồng thời.
function estimate(w, grp) {
  const c = cloneWorld(w);
  const map = new Map();
  w.s.queue.forEach((col, j) => col.forEach((m, k) => map.set(m, c.s.queue[j][k])));
  const g2 = grp.map((m) => map.get(m)).filter(Boolean);
  if (g2.length !== grp.length) return { eaten: 0, leftover: grp.reduce((a, m) => a + m.cap, 0) };
  const j = c.s.queue.findIndex((col) => col.includes(g2[0]));
  if (j < 0 || !launchCol(c, j)) return { eaten: 0, leftover: grp.reduce((a, m) => a + m.cap, 0) };
  const unit = c.flying[c.flying.length - 1];
  const before = g2.reduce((a, m) => a + m.cap, 0);
  for (let i = 0; i < c.seq.length * 3 && c.flying.includes(unit); i++) tick(c);
  const leftover = g2.reduce((a, m) => a + m.cap, 0);
  return { eaten: before - leftover, leftover };
}

const mkRng = (s) => { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 0xffffffff; }; };

// Một ván. forceFirst = "q<j>" | "bay<i>" để ép nước đầu (dùng cho guide/so sánh).
export function rollout2(L, seed, forceFirst, opts = {}) {
  const noise = opts.noise ?? 0.15;
  const foresight = opts.foresight !== false;
  const w = mkWorld(L);
  const rng = mkRng(seed);
  let guard = 0, stale = 0;
  const maxTicks = w.seq.length * 400;

  if (forceFirst) {
    if (forceFirst.startsWith("bay")) tapSlot(w, parseInt(forceFirst.slice(3), 10));
    else launchCol(w, parseInt(forceFirst.slice(1), 10));
  }

  while (remaining(w.s) > 0 && guard++ < maxTicks) {
    // 1) xe đang đỗ mà màu còn với tới được → bấm cho chạy (mỗi nhịp tối đa 1 xe)
    const S = reachableColors(w.s);
    let acted = false;
    for (let i = 0; i < w.s.slots.length; i++) {
      const p = w.s.slots[i];
      if (p && !isOut(w, p) && p.cap > 0 && S.has(p.color) && p.futileAt !== remaining(w.s)) { acted = tapSlot(w, i); if (acted) break; }
    }
    // 2) đến nhịp quyết định → cân nhắc phóng xe mới từ hàng
    if (!acted && (w.t % DECIDE_EVERY === 0 || w.flying.length === 0)) {
      const cands = [];
      const seenPid = new Set();
      const fs2 = freeSlots(w.s);
      for (let j = 0; j < w.s.queue.length; j++) {
        const grp = headGroup(w.s, j);
        if (!grp) continue;
        const pid = grp[0].pid;
        if (pid != null) { if (seenPid.has(pid)) continue; seenPid.add(pid); }
        if (fs2 < grp.length) continue;
        if (onRayCount(w) + grp.length > MAX_ON_TRACK) continue;
        cands.push({ j, grp });
      }
      if (cands.length) {
        const meta = cands.map((c) => ({ ...c, ...(foresight ? estimate(w, c.grp) : { eaten: 1, leftover: 0 }) }));
        const clean = foresight ? meta.filter((m) => m.leftover === 0 && m.eaten > 0) : [];
        const grpP = meta.filter((m) => m.grp.length > 1 && m.eaten > 0);
        const blk = fs2 >= 2 ? meta.filter((m) => m.eaten > 0) : [];
        const dig = fs2 >= 2 ? meta.filter((m) => m.eaten === 0) : [];
        const last = fs2 === 1 ? meta : [];
        const tiers = [clean, grpP, blk, dig, last].filter((t) => t.length);
        if (tiers.length) {
          let ti = 0;
          while (ti < tiers.length - 1 && rng() < noise) ti++;
          // Trong cùng một nhóm ưu tiên, chọn cú GHẾ THỪA ÍT NHẤT (hoà thì ăn nhiều hơn)
          // thay vì bốc ngẫu nhiên: ghế thừa chính là thứ chiếm ô chờ và dẫn tới kẹt — đó
          // là cách người chơi thật tránh chết, và bốc ngẫu nhiên làm B kẹt oan (L28 5%).
          const tier = tiers[ti].slice().sort((x, y) => (x.leftover - y.leftover) || (y.eaten - x.eaten));
          const pick = rng() < noise ? tier[Math.floor(rng() * tier.length)] : tier[0];
          acted = launchCol(w, pick.j);
        }
      }
    }
    // 3) kẹt: không làm gì được và ray trống. Ở chế độ tăng tốc cuối màn xe chạy vòng mãi
    // nên ray không bao giờ trống → phải bắt bằng "hai vòng liền không ăn được ô nào".
    if (!acted && w.flying.length === 0) break;
    const before = remaining(w.s);
    tick(w);
    if (remaining(w.s) < before) stale = 0;
    else if (++stale > w.seq.length * 2) break;
  }
  return { win: remaining(w.s) === 0, left: remaining(w.s), ticks: w.t, trips: w.trips };
}

export function measure2(L, N = 80, seedBase = 7919, opts = {}) {
  let wins = 0;
  for (let t = 1; t <= N; t++) if (rollout2(L, t * seedBase + 13, null, opts).win) wins++;
  return Math.round((100 * wins) / N);
}
