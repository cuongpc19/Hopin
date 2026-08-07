// design-core — luật thiết kế level slam, rút từ Manythings/Design level/level-design-guide.md.
//
// §0a QUY LUẬT GỐC: độ khó = ĐỘ LỆCH PHA giữa thứ tự XE và thứ tự LỘ MÀU.
//   • Chủ thể nổi, mọi màu lộ sớm  → xếp kiểu gì cũng dễ, không ép khó nổi.
//   • Xe đến TRƯỚC khi màu của nó lộ → phải ôm ô chờ → bay bị khoá → áp lực thật.
// §2b: phải để người chơi thua ở XE 6-15, KHÔNG phải xe cuối ("hụt ở mét cuối" = ức chế).
// §2d: level dễ (>80%) dùng ÍT xe TO (20-40 slime/xe), đừng chia vụn.
// §2e: đổi cỡ xe KHÔNG phải cosmetic — phải đo lại winrate, đã từng làm level bất khả thi.
import { isC, cellDepth, mkRng } from "./genlib.mjs";
import { rollout2 } from "./simcore2.mjs";
import { makeState, reachableSet, clearCell, laneSeq, lanRays, rayHit } from "./simcore.mjs";

// thứ tự một chiếc xe đi vòng CCW GẶP các ô đang lộ ra (bottom→ right↑ top← left↓, 3 tia/lane).
// Dùng để xếp xe: xe nào ứng với màu xe gặp trước thì đứng trước.
function travelOrder(s) {
  const seen = new Set(), out = [];
  for (const { e, l } of laneSeq(s))
    for (const [r0, c0, dr, dc] of lanRays(s, e, l)) {
      const h = rayHit(s, r0, c0, dr, dc);
      if (h && !s.hid.has(h.idx) && !seen.has(h.idx)) { seen.add(h.idx); out.push(h.idx); }
    }
  return out;
}

// ---- lộ màu: mỗi màu mở khoá ở ĐÂU trong hành trình -------------------------------------
// unlock(c) = tỉ lệ ô phải bóc trước khi màu c lộ ra ô đầu tiên. 0 = màu ở rìa (ăn ngay),
// 0.6 = phải bóc 60% bàn mới chạm tới. Đây là "thứ tự lộ màu" của §0a, đo được.
export function unlockFrac(L) {
  const dep = cellDepth(L);
  const total = L.board.filter(isC).length;
  const hist = [];
  const first = {};
  L.board.forEach((v, i) => {
    if (!isC(v) || dep[i] < 0) return;
    hist[dep[i]] = (hist[dep[i]] || 0) + 1;
    if (first[v] == null || dep[i] < first[v]) first[v] = dep[i];
  });
  const cum = []; let run = 0;
  for (let d = 0; d < hist.length; d++) { cum[d] = run; run += hist[d] || 0; }
  const out = {};
  for (const c in first) out[c] = total ? cum[first[c]] / total : 0;
  // ô lớp-2 chỉ lộ sau khi bóc ô phủ trên → mở khoá muộn hơn hẳn
  if (L.layer2) L.layer2.forEach((v, i) => {
    if (v < 0) return;
    const u = dep[i] >= 0 ? (cum[dep[i]] || 0) / total : 0.5;
    out[v] = Math.min(out[v] ?? 1, Math.max(u, 0.15));
  });
  return out;
}

// ---- xe: ít xe TO (§2d) — mỗi màu chia thành các xe ~cap ô ------------------------------
// Bất biến: tổng sức chứa = tổng ô (kể cả lớp 2). Xe chỉ rời khi ĐẦY nên lệch một ô là hỏng.
export function makeCars(L, cap) {
  const cnt = {};
  for (const v of L.board) if (isC(v)) cnt[v] = (cnt[v] || 0) + 1;
  if (L.layer2) for (const v of L.layer2) if (v >= 0) cnt[v] = (cnt[v] || 0) + 1;
  const cars = [];
  for (const [c, total] of Object.entries(cnt)) {
    const col = +c;
    const k = Math.max(1, Math.round(total / cap));
    const base = Math.floor(total / k);
    let rem = total - base * k;
    for (let i = 0; i < k; i++) { const e = rem > 0 ? 1 : 0; rem -= e; cars.push({ color: col, count: base + e }); }
  }
  return cars;
}

// ---- XẾP XE THEO ĐÚNG TRÌNH TỰ BÀN ĐƯỢC BÓC = DỄ HẾT MỨC ---------------------------------
// Mô phỏng tia bóc từng lớp; mỗi lớp ăn bao nhiêu ô của màu nào thì phát xe đúng thứ tự và
// đúng số lượng đó. Kết quả: xe ở đầu hàng LUÔN có màu đang ăn được → không kẹt bay được.
// (Trước đây tôi chỉ xếp theo thời điểm màu LỘ RA LẦN ĐẦU — gần đúng nhưng không đồng bộ với
// lượng ô thực sự có mặt, nên xe to đứng chờ ở ô chờ và khoá bay.)
// `wave` = GỘP BAO NHIÊU LỚP BÓC VÀO MỘT ĐỢT XE. wave=1 là bám sát nhịp bóc nhất (dễ nhất,
// nhưng ~110 xe/level vì mỗi lớp lại chẻ ra xe mới cho từng màu). wave=k phát một xe/màu cho
// cả k lớp → số xe giảm ~k lần, và xe chỉ tới sớm nhiều nhất k lớp so với ô của nó. Đây là
// núm "ít xe" DUY NHẤT có sai-lệch-pha CÓ CHẶN — khác hẳn cách gộp theo cửa sổ hàng xe cũ
// (`mergeWin`), vốn kéo xe đi xa tuỳ ý nên L6 rơi 94%→27%, L26 94%→3% mà không kiểm soát nổi.
export function orderByPeel(L, cap, mergeWin, wave = Number(process.env.WAVE ?? 1)) {
  const s = makeState(L);
  const runs = [];                                  // [{color, n}] theo đúng thứ tự bóc
  const buf = {};       // màu → {n, first} ; first = vị trí xe GẶP màu đó sớm nhất trong đợt
  let tick = 0;
  const flush = () => {
    // TRAVEL=1: màu xe gặp TRƯỚC thì xe đứng trước. Mặc định cũ: màu nhiều ô trước.
    // đo 2026-08-05: xếp theo travel không hơn (L10 33-46% vs 47-50%, L15 kém hơn) → mặc định tắt
    const trav = process.env.TRAVEL === "1";
    const ent = Object.entries(buf).sort((a, b) => (trav ? a[1].first - b[1].first : b[1].n - a[1].n));
    for (const [c, v] of ent) {
      const last = runs[runs.length - 1];
      if (last && last.color === +c) last.n += v.n; else runs.push({ color: +c, n: v.n });
      delete buf[c];
    }
  };
  for (let step = 0; step < 400; step++) {
    const seq = travelOrder(s);
    if (!seq.length) break;
    for (const i of seq) if (isC(s.occ[i])) {
      const c = s.occ[i];
      const b = (buf[c] = buf[c] || { n: 0, first: tick });
      b.n++; tick++; clearCell(s, i);
    }
    if ((step + 1) % Math.max(1, wave) === 0) flush();
  }
  flush();
  // KHÔNG cộng riêng ô lớp-2: `clearCell` đã đôn ô lớp-2 lên `occ` khi ô phủ trên bị bóc, nên
  // vòng lặp trên ĐÃ đếm chúng. Cộng thêm lần nữa là thừa ghế → level bất khả thi (L15/L25/L30
  // từng dư đúng 40 ghế = đúng số ô lớp-2).
  // chẻ mỗi đoạn thành xe ~cap ô, giữ nguyên thứ tự
  const cars = [];
  for (const r of runs) {
    let left = r.n;
    while (left > 0) { const take = Math.min(left, cap); cars.push({ color: r.color, count: take }); left -= take; }
  }
  // Gộp xe cùng màu ĐỨNG GẦN NHAU (trong cửa sổ `win`) — mỗi lớp bóc lại chẻ ra xe mới nên
  // không gộp thì L2 ra 50 xe cho 368 ô = 7 slime/xe, trái hẳn ý "ít xe, nhiều slime".
  // Gộp lùi về vị trí xe ĐẦU nên vẫn gần đúng nhịp bóc.
  const win = mergeWin === undefined ? Number(process.env.MERGE_WIN ?? 6) : mergeWin;
  const out = [];
  for (const c of cars) {
    let hit = null;
    for (let k = out.length - 1; k >= 0 && k >= out.length - win; k--)
      if (out[k].color === c.color && out[k].count + c.count <= cap) { hit = out[k]; break; }
    if (hit) hit.count += c.count; else out.push(c);
  }
  return out;
}

// ---- ĐỘ KHÓ = ĐẨY XE LÊN SỚM (lệch pha so với lịch bóc) ---------------------------------
// Lấy `k` xe từ nửa sau hàng, chèn vào HỒI THẮT (22-62% hàng xe). Chúng tới trước khi màu của
// mình lộ ra → đỗ lì trong ô chờ → khoá bay → người chơi phải chọn gỡ bằng xe nào (guide §2b:
// đặt quyết-định-có-hậu-quả vào khúc giữa, đừng để hụt ở mét cuối).
// ---- NUỐT XE VỤN ------------------------------------------------------------------------
// Tia bóc ăn phần dày ở ngoài trước nên mỗi màu còn lại một mẩu ở cuối → đuôi hàng là một
// loạt xe 1-10 slime (L2: …18, 11, 10, 9, 7, 4, 1). Bấm nhiều mà chẳng được gì.
// Gộp mẩu đó vào xe CÙNG MÀU, ưu tiên xe ĐỨNG SAU: dời xe ra sau thì màu của nó đã lộ sẵn,
// vô hại. Chỉ khi không có xe sau mới lùi vào xe trước — hướng đó mới sinh xe-đứng-chờ.
export function absorbTiny(order, minSize, hardMax = 140) {
  if (!minSize) return order;
  const cars = order.map((c) => ({ ...c }));
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c || c.count >= minSize) continue;
    let tgt = -1;
    for (let j = i + 1; j < cars.length; j++)
      if (cars[j] && cars[j].color === c.color && cars[j].count + c.count <= hardMax) { tgt = j; break; }
    if (tgt < 0) for (let j = i - 1; j >= 0; j--)
      if (cars[j] && cars[j].color === c.color && cars[j].count + c.count <= hardMax) { tgt = j; break; }
    if (tgt < 0) continue;                       // màu chỉ có đúng một xe → phải giữ
    cars[tgt].count += c.count;
    cars[i] = null;
  }
  return cars.filter(Boolean);
}

// `frac` = TỈ LỆ hàng xe bị đẩy lệch pha (0…0.5). Bản trước dùng SỐ CỐ ĐỊNH nên với hàng
// 50-130 xe thì đẩy 9 xe chẳng ăn thua — 120 xe còn lại vẫn đúng nhịp, level vẫn 94%.
export function shiftEarly(order, frac, seed) {
  const k = frac <= 1 ? Math.round(frac * order.length) : frac;
  if (!k) return order;
  const out = order.slice();
  const N = out.length;
  const lo = Math.max(3, Math.round(N * 0.22)), hi = Math.round(N * 0.62);
  if (hi - lo < 2 || N < 10) return out;
  const rng = mkRng(seed);
  const taken = [];
  for (let i = 0; i < k; i++) {
    // lấy từ khoảng 65-90% hàng: đủ sâu để chưa lộ, nhưng còn kịp gỡ ở hồi về
    const from = Math.min(out.length - 1, Math.round(N * (0.65 + rng() * 0.25)));
    if (from <= hi) break;
    taken.push(out.splice(from, 1)[0]);
  }
  const step = Math.max(1, Math.floor((hi - lo) / (taken.length + 1)));
  taken.forEach((c, i) => out.splice(Math.min(lo + step * (i + 1), out.length), 0, c));
  return out;
}

// ---- BA HỒI: mở (ăn thông) → thắt (lệch pha) → về (gỡ gọn) ------------------------------
// `pressure` = số xe LỆCH PHA nhét vào hồi thắt. Xe lệch pha = màu chưa lộ tại thời điểm nó
// tới → đỗ lì, khoá bay. Xen kẽ với xe tự do để người chơi CÓ LỰA CHỌN (guide §2: áp lực
// phải kèm lựa chọn có hậu quả, không phải digging một chiều).
export function orderThreeAct(cars, unlock, pressure, seed, opts = {}) {
  const rng = mkRng(seed);
  const N = cars.length;
  const act1 = opts.act1 ?? Math.max(4, Math.round(N * 0.22));   // hồi mở
  const act2End = opts.act2End ?? Math.max(act1 + 4, Math.round(N * 0.62)); // hết hồi thắt
  const u = (c) => unlock[c.color] ?? 0;

  const pool = cars.slice().sort((a, b) => (u(a) - u(b)) || (rng() - 0.5));
  if (pressure <= 0) return pool;

  // xe LỆCH PHA nhất = màu mở khoá muộn nhất, nhưng phải còn kịp gỡ ở hồi về → lấy từ
  // nhóm mở khoá muộn VỪA (0.35-0.85), không lấy màu lõi cuối cùng (dễ deadlock, guide §1①).
  const cand = pool
    .map((c, i) => ({ c, i, uu: u(c) }))
    .filter((x) => x.uu >= 0.3 && x.uu <= 0.88 && x.i >= act2End);
  cand.sort((a, b) => b.uu - a.uu);
  const picked = new Set(cand.slice(0, pressure).map((x) => x.c));
  if (!picked.size) return pool;

  const rest = pool.filter((c) => !picked.has(c));
  const out = rest.slice(0, act1);                       // hồi mở: nguyên vẹn, toàn màu rìa
  const mid = rest.slice(act1, act2End);
  const tail = rest.slice(act2End);
  // rải đều xe lệch pha vào hồi thắt, KHÔNG dồn cụm (dồn = deadlock, rải = phải chọn)
  const early = [...picked];
  const step = Math.max(1, Math.floor((mid.length + early.length) / (early.length + 1)));
  let k = 0;
  for (let i = 0; i < mid.length || k < early.length; ) {
    if (k < early.length && out.length >= act1 && (out.length - act1) % step === step - 1) { out.push(early[k++]); continue; }
    if (i < mid.length) out.push(mid[i++]); else if (k < early.length) out.push(early[k++]); else break;
  }
  return [...out, ...tail];
}

// ---- XE ĐÔI: khoảng cách hợp lệ (user 2026-08-05) ---------------------------------------
// Được KHÁC HÀNG, nhưng: tối đa 2 xe chen giữa (|i-j| ≤ 3) VÀ hai hàng phải SÁT NHAU.
// Thêm hình DỌC (cùng cột, hàng kề — j = i+lanes): mắt nhìn không có xe nào chen giữa, và
// guide §2b vốn đã cho phép hình này.
export function twinGapOk(i, j, lanes) {
  const [a, b] = i < j ? [i, j] : [j, i];
  const rowA = Math.floor(a / lanes), rowB = Math.floor(b / lanes);
  if (b - a === lanes && a % lanes === b % lanes) return true;  // hình DỌC (xem twinShape)
  if (rowB - rowA > 1) return false;              // phải là 2 hàng sát nhau
  return b - a <= 3;                              // tối đa 2 xe chen giữa
}

// Điểm ƯU TIÊN hình xe đôi — cao hơn = an toàn hơn cho cái DÂY (user 2026-08-05: "chú ý vụ
// không nhìn thấy dây, lỗi này gặp nhiều").
//   • DỌC, cùng cột hàng kề: MIỄN NHIỄM. Hàng chờ tiêu thụ theo CỘT (invColumns[i % perRow]),
//     nên hai xe cùng cột luôn kề nhau dù cột vơi tới đâu — dây luôn là đoạn dọc ngắn.
//   • NGANG hai cột kề: cột này vơi nhanh hơn cột kia thì cặp TRÔI ra khác hàng → dây kéo chéo.
//   • Có xe chen giữa: vừa dễ trôi vừa khó hiểu bằng mắt → chỉ dùng khi không còn chỗ.
export function twinShape(i, j, lanes) {
  const [a, b] = i < j ? [i, j] : [j, i];
  if (b - a === lanes && a % lanes === b % lanes) return 3;                       // dọc
  if (b - a === 1 && Math.floor(a / lanes) === Math.floor(b / lanes)) return 2;   // ngang kề
  return 1;                                                                       // có xe chen
}

// ---- CHẶN CHUỖI DÀI xe cùng màu (user 2026-08-05) ---------------------------------------
// User chê "cùng 1 hàng mà 4 xe, mỗi xe 10 slime, màu giống nhau" — tức chê NGUYÊN MỘT HÀNG
// trùng màu (lanes=4), không phải chê hai xe cạnh nhau. Bản trước tôi cấm tiệt mọi cặp liền
// màu, và đó là thứ phá level: guide §0a nói mở màn CẦN vài xe màu nền liên tiếp mới bóc nổi
// lớp ngoài. Đo 2026-08-05: bỏ cấm thì L14 14%→86%, L16 32%→94%, L26 53%→88%, L30 12%→40%.
// Nên chỉ cắt chuỗi DÀI HƠN maxRun, giữ nguyên chuỗi ngắn.
export function capSameColourRun(order, maxRun = 3) {
  const out = order.slice();
  let run = 1;
  for (let i = 1; i < out.length; i++) {
    if (out[i].color === out[i - 1].color) run++; else { run = 1; continue; }
    if (run <= maxRun) continue;
    // tìm xe KHÁC màu gần nhất phía sau để đổi chỗ, ưu tiên gần để ít xáo thứ tự lộ màu
    let j = i + 1;
    while (j < out.length && out[j].color === out[i].color) j++;
    if (j >= out.length) break;              // đuôi hàng toàn một màu — đành chịu
    const t = out[i]; out[i] = out[j]; out[j] = t;
    run = 1;
  }
  return out;
}

// ---- ĐO: winrate + THUA Ở ĐÂU ------------------------------------------------------------
// Guide §2b muốn thua ở xe 6-15 / ~25 xe = 25-60% hành trình. Đây là cửa nghiệm thu THỨ HAI,
// bộ tune cũ chỉ có winrate nên độ khó toàn rơi vào cuối màn (đo 2026-08-05: 51-96%).
// ⚠ Đo theo % BÀN ĐÃ BÓC, không phải số chuyến / số xe: một xe đi được NHIỀU chuyến (ra rồi
// về chưa đầy, lại đi tiếp) nên tỉ lệ đó vọt quá 100% (đo 2026-08-05: thấy 104%, 109%).
export function lossProfile(L, N = 40, seedBase = 7919) {
  const total = L.board.filter(isC).length + (L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0);
  let wins = 0; const pos = [];
  for (let i = 0; i < N; i++) {
    const r = rollout2(L, seedBase + i * 131, null, {});
    if (r.win) { wins++; continue; }
    pos.push(total ? (total - r.left) / total : 0);
  }
  pos.sort((a, b) => a - b);
  return {
    win: Math.round((100 * wins) / N),
    lossAt: pos.length ? Math.round(100 * pos[Math.floor(pos.length / 2)]) : null, // trung vị
    nLoss: pos.length,
  };
}

// Điểm phạt vị trí thua. Dải chấp nhận NỚI thành 25-75% sau khi đo (2026-08-05): tắc muộn là
// TÍNH CHẤT CỦA BÀN, không ép được — bàn càng bóc càng cạn màu nên kẹt tự nhiên dồn về cuối.
// Thứ ép được, và cũng là thứ guide §2b thật sự muốn, là ĐỪNG để thua ở mét cuối (>75%) và
// đừng tắc trước khi người chơi kịp vào nhịp (<25%). Thua muộn phạt nặng gấp rưỡi thua sớm.
export function positionPenalty(lossAt) {
  if (lossAt == null) return 0;
  if (lossAt >= 25 && lossAt <= 75) return 0;
  // Thua RẤT SỚM nặng hơn thua muộn: tắc ở 4% bàn thì người chơi đọc là "level hỏng", không
  // phải "level khó" — mà bộ chọn lại rất dễ vớ phải nấc đó vì winrate của nó trông vừa đẹp.
  return lossAt < 25 ? (25 - lossAt) * 2.5 : (lossAt - 75) * 1.2;
}

// ---- ĐÁ CỨNG DỌC CẠNH DƯỚI ----------------------------------------------------------------
// user 2026-08-07: "slime đá thì nên để ở cạnh dưới thay vì trên đầu object". Các level đá cũ
// (L43, L45) xây tường kín ở HÀNG 0-2, tức trên đỉnh tranh — nhìn như đá đè lên đầu nhân vật.
//
// ⚠ Cạnh dưới KHÔNG đối xứng với cạnh trên về mặt cơ chế: `slotEntryLaneIndex` cho xe vào từ
// lane ĐÁY, nên tường kín ở đáy chặn ngay những lane gần chỗ xuất phát nhất. Vì vậy hàm này
// mặc định CHỪA KHE: cứ `gapEvery` cột thì để trống một cột, cho tia vẫn lách vào được.
// Đặt đá TRƯỚC khi dựng hàng xe — `orderByPeel` đọc board nên ghế tự khớp lại; đặt sau là hỏng
// bất biến ghế=ô.
export function addRocksBottom(L, nRows = 2, gapEvery = 5) {
  const { cols, rows } = L;
  let placed = 0;
  for (let r = rows - nRows; r < rows; r++) {
    if (r < 0) continue;
    for (let c = 0; c < cols; c++) {
      if (gapEvery > 0 && c % gapEvery === gapEvery - 1) continue;   // khe cho tia lách qua
      const i = r * cols + c;
      if (L.board[i] >= 90) continue;
      L.board[i] = 90;                                              // HARD_ROCK
      placed++;
    }
  }
  if (L.layer2) for (let i = 0; i < L.layer2.length; i++) if (L.board[i] >= 90) L.layer2[i] = -1;
  return placed;
}
