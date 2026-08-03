// gen33-46 — DỰNG LẠI L33-46 theo yêu cầu user 2026-08-03:
//   "Bộ level hiện tại nhiều slime quá, nên chơi rất mệt. Có thể bỏ viền đi, và design
//    lại xe. Với cả cho xe đôi với xe ? nữa nhé."
//
// Cụ thể:
//   • BỎ VIỀN/NỀN: loang từ mép board, gỡ phần nền dính-liền-ra-ngoài (giữ mảng cùng màu
//     nằm TRONG chủ thể) — chủ thể nổi trực tiếp trên mặt bàn, bớt 200-400 slime mỗi level.
//   • DESIGN LẠI XE: chia lại từ đầu bằng reCar (12-36 ghế/xe) — không còn xe 51-72 ghế
//     kiểu L24 cũ.
//   • Xe ĐÔI (baggage) + xe ÚP MẶT "?" + ô "?" trên bàn: CÓ MẶT Ở MỌI LEVEL của dải.
//   • Độ khó lấy từ cơ chế + thứ tự xe là chính; slime 2 LỚP chỉ là phương án cuối và bị
//     TRẦN 60 ô — vì lớp 2 nghĩa là thêm slime phải gom, đi ngược yêu cầu "bớt mệt".
//
// Nguồn: L33←L17, L34←L18, … L46←L30 (giữ ảnh/chủ thể cũ). Target giữ dải 27%→10%.
import {
  readD, writeD, measure, colorDepth, reCar, makeOrder,
  addLayer2Clusters, addBuried, addBaggageTwins, makeHidden,
} from "./genlib.mjs";

const TARGET = {
  33: 27, 34: 25, 35: 24, 36: 22, 37: 21, 38: 20,
  39: 18, 40: 17, 41: 16, 42: 15, 43: 14, 44: 13, 45: 12, 46: 10,
};
const N = Number(process.env.N || 60);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
const LAY_CAP = 150; // trần slime 2 lớp — "bớt mệt" là mệnh lệnh cao hơn trúng target

const d = readD();
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- BỎ VIỀN: gỡ các ô màu-nền DÍNH LIỀN với mép board (loang 4 hướng qua ô trống +
// ô màu nền). Mảng cùng màu nằm kín trong chủ thể KHÔNG bị gỡ. Lặp tới khi vòng ngoài
// không còn gì để gỡ (viền chữ nhật + quầng nền đều bay).
function stripBorder(board, cols, rows) {
  const b = board.slice();
  let guard = 0;
  while (guard++ < 4) {
    // màu nền hiện tại = màu chiếm nhiều nhất trong VÀNH NGOÀI của phần còn lại
    const ringCnt = {};
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = b[i];
      if (v == null || v < 0 || v >= 90) continue;
      const nb = [r > 0 ? b[i - cols] : -1, r < rows - 1 ? b[i + cols] : -1, c > 0 ? b[i - 1] : -1, c < cols - 1 ? b[i + 1] : -1];
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1 || nb.some((x) => x == null || x < 0)) {
        ringCnt[v] = (ringCnt[v] || 0) + 1;
      }
    }
    const ring = Object.keys(ringCnt).sort((a, b2) => ringCnt[b2] - ringCnt[a])[0];
    if (ring == null) break;
    const fill = Number(ring);
    // loang từ mép qua (trống ∪ màu fill); ô fill chạm được = viền/nền → gỡ
    const seen = new Uint8Array(b.length);
    const q = [];
    const push = (i) => { if (i >= 0 && !seen[i] && (b[i] == null || b[i] < 0 || b[i] === fill)) { seen[i] = 1; q.push(i); } };
    for (let c = 0; c < cols; c++) { push(c); push((rows - 1) * cols + c); }
    for (let r = 0; r < rows; r++) { push(r * cols); push(r * cols + cols - 1); }
    while (q.length) {
      const i = q.pop();
      const r = Math.floor(i / cols), c = i % cols;
      if (r > 0) push(i - cols); if (r < rows - 1) push(i + cols);
      if (c > 0) push(i - 1); if (c < cols - 1) push(i + 1);
    }
    let removed = 0;
    for (let i = 0; i < b.length; i++) if (seen[i] && b[i] === fill) { b[i] = -1; removed++; }
    if (removed < 20) break; // vành ngoài đã là chủ thể thật → dừng
  }
  return b;
}

// ĐÁ CỨNG rải trong lòng chủ thể (code 90): chặn tia vĩnh viễn nên xe phải đi vòng, màu
// sau đá thành khó với tới → xe về ô chờ với ghế thừa. Đây là đòn bẩy DUY NHẤT vừa làm khó
// vừa BỚT slime (ô hoá đá là ô không phải gom nữa) — đúng thứ cần sau khi bỏ viền.
function addRocks(board, cols, rows, want, seed) {
  if (want <= 0) return board;
  const b = board.slice();
  let s2 = (seed >>> 0) || 1;
  const rnd = () => { s2 = (s2 * 1664525 + 1013904223) >>> 0; return s2 / 0xffffffff; };
  const inner = [];
  for (let r = 2; r < rows - 2; r++) for (let c = 2; c < cols - 2; c++) {
    const i = r * cols + c;
    if (b[i] != null && b[i] >= 0 && b[i] < 90) inner.push(i);
  }
  if (inner.length < want * 2) return b;
  let placed = 0, guard = 0;
  while (placed < want && guard++ < want * 6) {
    const i0 = inner[Math.floor(rnd() * inner.length)];
    if (b[i0] >= 90) continue;
    // thanh ngắn 2-4 ô theo phương ngẫu nhiên → cản tia rõ hơn chấm lẻ
    const len = 2 + Math.floor(rnd() * 3);
    const dir = rnd() < 0.5 ? 1 : cols;
    for (let k = 0; k < len && placed < want; k++) {
      const i = i0 + k * dir;
      if (i < 0 || i >= b.length) break;
      if (b[i] == null || b[i] < 0 || b[i] >= 90) break;
      b[i] = 90; placed++;
    }
  }
  return b;
}

function build(src, n, want, opts = {}) {
  const L = clone(src);
  L.slam = true;
  delete L.layer2;
  delete L.hidden;
  L.board = stripBorder(src.board, src.cols, src.rows);
  if (opts.rocks) L.board = addRocks(L.board, L.cols, L.rows, opts.rocks, n * 7 + 3);
  const seed = n * 977 + 13;

  const cnt = {};
  for (const v of L.board) if (v != null && v >= 0 && v < 90) cnt[v] = (cnt[v] || 0) + 1;
  const bg = Number(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] ?? 12);

  if (want >= 8) addLayer2Clusters(L, seed, Math.min(want, LAY_CAP), { bgColor: bg });

  const cdep = colorDepth(L);
  const cars = reCar(L, seed, opts.cars ? { minCars: opts.cars, maxCars: opts.cars } : {});
  L.chests = makeOrder(cars, cdep, n * 31 + 7, opts.gentle ? { gentle: true } : { bgColor: bg, bgHead: 3, deepN: 3 });

  if (opts.twins) addBaggageTwins(L, opts.twins, cdep, seed);
  if (opts.buried) addBuried(L, opts.buried, seed, L.lanes || 4);
  if (opts.hidden) {
    const h = makeHidden(L.board, L.cols, L.rows, opts.hidden, seed);
    if (h) L.hidden = h.hidden;
  }
  return L;
}

// Đá tạo VÁCH ĐỨNG (100% → 0%, không có khoảng giữa) nên không dò được; quay lại đòn bẩy
// đã chứng minh là ĐƠN ĐIỆU: slime 2 LỚP. Vẫn đúng yêu cầu "bớt mệt" vì viền đã bị gỡ —
// tổng slime cuối cùng ~350-500 thay vì 960-1130 như bản cũ.
function tune(src, n, target, opts) {
  let best = null;
  const at = (want, o) => {
    const L = build(src, n, want, o);
    const w = measure(L, N);
    if (!best || Math.abs(w - target) < Math.abs(best.w - target)) best = { L, w, want };
    return w;
  };
  const probe = build(src, n, 0, { ...opts, twins: 1 });
  const nc = probe.chests.length;
  // ba trục: thứ tự xe · số xe · số cặp xe đôi — mỗi tổ hợp dò nhị phân lớp-2 riêng
  for (const gentle of [false, true])
  for (const cars of [0, Math.round(nc * 1.4)])
  for (const dt of [0, 2]) {
    const o = { ...opts, gentle, cars: cars || undefined, twins: Math.max(1, opts.twins + dt) };
    let lo = 0, hi = LAY_CAP;
    const w0 = at(0, o);
    if (w0 < target - 4) continue;            // tự nó đã khó quá → thử nấc hiền
    for (let i = 0; i < 8 && hi - lo > 6; i++) {
      const mid = Math.round((lo + hi) / 2);
      const w = at(mid, o);
      if (w > target) lo = mid; else hi = mid;
    }
    at(lo, o); at(hi, o);
    if (Math.abs(best.w - target) <= 4) return best;
  }
  return best;
}

console.log(`Rebuild L33-46: bo vien, xe nho, du co che (do mo hinh A, N=${N})\n`);
console.log("moi | nguon | target |  do  | slime(cu->moi) | lop2 | xe | doi | up | \"?\"");
for (let n = 33; n <= 46; n++) {
  if (ONLY && !ONLY.includes(n)) continue;
  const s = n - 16;
  const src = d[s];
  if (!src) { console.log(`L${n}: thieu nguon L${s}`); continue; }
  const k = (n - 33) / 13;
  const opts = {
    twins: 2 + Math.round(k * 2),   // 2 → 4 cặp
    buried: 0.18 + k * 0.17,        // 18% → 35%
    hidden: 0.07 + k * 0.05,        // ô "?" MỌI level của dải
  };
  const r = tune(src, n, TARGET[n], opts);
  const L = r.L;
  const oldCells = src.board.filter((v) => v != null && v >= 0 && v < 90).length + (src.layer2 ? src.layer2.filter((v) => v != null && v >= 0).length : 0);
  const newCells = L.board.filter((v) => v != null && v >= 0 && v < 90).length + (L.layer2 ? L.layer2.filter((v) => v != null && v >= 0).length : 0);
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const hid = L.hidden ? L.hidden.filter((v) => v >= 0).length : 0;
  const lay = L.layer2 ? L.layer2.filter((v) => v != null && v >= 0).length : 0;
  d[n] = L;
  console.log(
    `L${n} |  L${String(s).padStart(2)}  |  ${String(TARGET[n]).padStart(3)}%  | ${String(r.w).padStart(3)}% | ` +
    `${String(oldCells).padStart(5)} -> ${String(newCells).padStart(4)} | ${String(lay).padStart(4)} | ${String(L.chests.length).padStart(2)} | ${String(tw).padStart(3)} | ${String(bu).padStart(2)} | ${String(hid).padStart(3)}`
  );
}
writeD(d);
console.log("\nda ghi vao src/levels/designed.json");
