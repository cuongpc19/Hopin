// gen33-46b — DỰNG LẠI L33-46 lần hai (user 2026-08-04).
//
// Vì sao phải làm lại: bản trước tune bằng mô hình A về dải 10-27%, nhưng ván thật cho
// thấy A đọc SAI đúng vùng này — A nói L34/L36 đều 18% trong khi user thua 9/9 ván, còn
// B, D, E đều nói 0%. Log chỉ rõ kiểu chết: tắc sau 3-10 nước với 35-138 GHẾ THỪA đọng
// ở ô chờ, mới ăn 21-32% bàn. Nguyên nhân: bỏ sạch viền → mất màu nền dễ ăn (thứ giúp xe
// mở màn luôn có việc), lại nhồi xe đôi + xe úp + ô "?" vào MỌI level.
//
// Lần này:
//   • GIỮ MỘT PHẦN NỀN — gỡ viền ngoài nhưng chừa lại một vành nền quanh chủ thể, nên
//     vẫn ít slime hơn bản gốc nhiều mà xe luôn có đường ăn mở màn.
//   • RẢI CƠ CHẾ THƯA — xe đôi / xe úp / ô "?" luân phiên theo level, không chồng hết.
//   • TUNE BẰNG B (simcore2, đang bám ván thật sát nhất: sai số 22 điểm) thay vì A.
//   • Dải target 50% → 25% (user chốt), thay cho 27% → 10% của bản hỏng.
import {
  readD, writeD, colorDepth, reCar, makeOrder,
  addLayer2Clusters, addBuried, addBaggageTwins, makeHidden,
} from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";

const TARGET = {
  33: 50, 34: 48, 35: 46, 36: 44, 37: 42, 38: 40, 39: 38,
  40: 36, 41: 34, 42: 32, 43: 30, 44: 28, 45: 27, 46: 25,
};
// TGT=33:44,36:40 — ép target riêng cho vài level khi đo lại ở N cao thấy lệch band.
for (const p of (process.env.TGT || "").split(",").filter(Boolean)) {
  const [k, v] = p.split(":").map(Number);
  if (Number.isFinite(k) && Number.isFinite(v)) TARGET[k] = v;
}
const N = Number(process.env.N || 60);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
const LAY_CAP = 120;

const d = readD();
const clone = (o) => JSON.parse(JSON.stringify(o));

// Gỡ viền NHƯNG chừa lại `keep` vòng nền quanh chủ thể: loang từ mép qua ô trống + ô màu
// nền, rồi chỉ xoá những ô nền cách chủ thể hơn `keep` bước. Vành nền còn lại chính là
// nguồn "ăn mở màn" mà bản trước đã cắt mất.
function stripBorderKeep(board, cols, rows, keep = 2) {
  const b = board.slice();
  const cnt = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, v = b[i];
    if (v == null || v < 0 || v >= 90) continue;
    const edge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
    const nb = [r > 0 ? b[i - cols] : -1, r < rows - 1 ? b[i + cols] : -1, c > 0 ? b[i - 1] : -1, c < cols - 1 ? b[i + 1] : -1];
    if (edge || nb.some((x) => x == null || x < 0)) cnt[v] = (cnt[v] || 0) + 1;
  }
  const fill = Number(Object.keys(cnt).sort((a, z) => cnt[z] - cnt[a])[0] ?? -1);
  if (fill < 0) return b;

  // khoảng cách tới chủ thể (ô KHÔNG phải màu nền), lan sóng 4 hướng
  const dist = new Int32Array(b.length).fill(1e9);
  const q = [];
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (v != null && v >= 0 && v !== fill) { dist[i] = 0; q.push(i); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], r = Math.floor(i / cols), c = i % cols;
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  // ô nền chạm được từ mép VÀ cách chủ thể > keep → xoá
  const seen = new Uint8Array(b.length);
  const st = [];
  const push = (i) => { if (i >= 0 && i < b.length && !seen[i] && (b[i] == null || b[i] < 0 || b[i] === fill)) { seen[i] = 1; st.push(i); } };
  for (let c = 0; c < cols; c++) { push(c); push((rows - 1) * cols + c); }
  for (let r = 0; r < rows; r++) { push(r * cols); push(r * cols + cols - 1); }
  while (st.length) {
    const i = st.pop(), r = Math.floor(i / cols), c = i % cols;
    if (r > 0) push(i - cols); if (r < rows - 1) push(i + cols);
    if (c > 0) push(i - 1); if (c < cols - 1) push(i + 1);
  }
  for (let i = 0; i < b.length; i++) if (seen[i] && b[i] === fill && dist[i] > keep) b[i] = -1;
  return b;
}

function build(src, n, want, opts = {}) {
  const L = clone(src);
  L.slam = true;
  delete L.layer2;
  delete L.hidden;
  L.board = stripBorderKeep(src.board, src.cols, src.rows, opts.keep ?? 1);
  const seed = n * 977 + 13;

  const cnt = {};
  for (const v of L.board) if (v != null && v >= 0 && v < 90) cnt[v] = (cnt[v] || 0) + 1;
  const bg = Number(Object.keys(cnt).sort((a, z) => cnt[z] - cnt[a])[0] ?? 12);

  if (want >= 8) addLayer2Clusters(L, seed, Math.min(want, LAY_CAP), { bgColor: bg });

  const cdep = colorDepth(L);
  const cars = reCar(L, seed, {});
  L.chests = makeOrder(cars, cdep, n * 31 + 7, opts.gentle ? { gentle: true } : { bgColor: bg, bgHead: 2, deepN: 2 });

  if (opts.twins) addBaggageTwins(L, opts.twins, cdep, seed);
  if (opts.buried) addBuried(L, opts.buried, seed, L.lanes || 4);
  if (opts.hidden) {
    const h = makeHidden(L.board, L.cols, L.rows, opts.hidden, seed);
    if (h) L.hidden = h.hidden;
  }
  return L;
}

// Dò nhị phân lớp-2 bằng THƯỚC B. Nếu 0 lớp-2 mà đã dưới target thì level tự nó đã khó
// quá → lùi cơ chế (ít xe đôi / ít xe úp / thứ tự hiền) rồi dò lại.
function tune(src, n, target, base) {
  let best = null;
  const at = (want, o) => {
    const L = build(src, n, want, o);
    const w = measure2(L, N);
    if (!best || Math.abs(w - target) < Math.abs(best.w - target)) best = { L, w, want, o };
    return w;
  };
  for (const gentle of [false, true])
    for (const sc of [1, 0.6, 0.3, 0]) {
      const o = {
        ...base, gentle,
        twins: Math.round((base.twins || 0) * sc),
        buried: (base.buried || 0) * sc,
        keep: sc < 0.5 ? 2 : 1,           // lùi sâu thì chừa nền dày hơn một chút
      };
      const w0 = at(0, o);
      if (w0 < target - 4) continue;      // vẫn khó quá → lùi tiếp
      let lo = 0, hi = LAY_CAP;
      for (let i = 0; i < 8 && hi - lo > 6; i++) {
        const mid = Math.round((lo + hi) / 2);
        if (at(mid, o) > target) lo = mid; else hi = mid;
      }
      at(lo, o); at(hi, o);
      if (Math.abs(best.w - target) <= 5) return best;
    }
  return best;
}

console.log(`Dung lai L33-46 — thuoc B (simcore2), dai 50%->25%, N=${N}\n`);
console.log("moi | nguon | target |  B  | slime | lop2 | xe | doi | up | \"?\"");
for (let n = 33; n <= 46; n++) {
  if (ONLY && !ONLY.includes(n)) continue;
  const s = n - 16;
  const src = d[s];
  if (!src) { console.log(`L${n}: thieu nguon L${s}`); continue; }
  const k = (n - 33) / 13;
  // cơ chế RẢI THƯA: xe đôi ở level chẵn, ô "?" ở level lẻ, xe úp tăng dần nhưng nhẹ
  const base = {
    twins: n % 2 === 0 ? 1 + Math.round(k * 2) : 0,
    buried: 0.10 + k * 0.15,
    hidden: n % 2 === 1 ? 0.05 + k * 0.04 : 0,
  };
  const r = tune(src, n, TARGET[n], base);
  const L = r.L;
  const cells = L.board.filter((v) => v != null && v >= 0 && v < 90).length + (L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0);
  const lay = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const hid = L.hidden ? L.hidden.filter((v) => v >= 0).length : 0;
  d[n] = L;
  console.log(`L${n} |  L${String(s).padStart(2)}  |  ${String(TARGET[n]).padStart(3)}%  | ${String(r.w).padStart(3)}% | ${String(cells).padStart(5)} | ${String(lay).padStart(4)} | ${String(L.chests.length).padStart(2)} | ${String(tw).padStart(3)} | ${String(bu).padStart(2)} | ${String(hid).padStart(3)}`);
}
writeD(d);
console.log("\nda ghi vao src/levels/designed.json");
