// gen31-46 — nhân bộ L15-30 thành L31-46 KHÓ HƠN, dải winrate 10-30%.
//
// Mỗi level mới chép nguyên bàn cờ + ảnh của level nguồn (L31←L15, L32←L16, … L46←L30)
// rồi siết độ khó bằng những đòn bẩy đã kiểm chứng:
//   • slime 2 LỚP  — đòn bẩy chính, dò nhị phân tới khi trúng target (~1-2 điểm mỗi ô)
//   • xe ÚP MẶT    — không đọc trước được hàng xe
//   • ô "?"        — mù thông tin; sim gần như không đổi điểm nhưng NGƯỜI thì khó hẳn
//                    (và cả game hiện chưa có chỗ nào tử tế để test cơ chế này)
//   • xe ĐÔI gánh  — cặp lệch độ sâu, ép ô chờ thật sự
//   • thứ tự xe lệch pha thứ tự lộ màu
//
// Bất biến bắt buộc: tổng ghế xe = tổng ô (kể cả lớp 2) — reCar lo việc đó, nên hễ đụng
// vào layer2 là PHẢI chia lại xe, nếu không level thành không thể thắng.
import {
  readD, writeD, measure, colorDepth, reCar, makeOrder,
  addLayer2Clusters, addBuried, addBaggageTwins, makeHidden,
} from "./genlib.mjs";

// dải target: dốc từ 30% xuống 10% (user: "dao động từ 10-30%")
const TARGET = {
  31: 30, 32: 28, 33: 27, 34: 25, 35: 24, 36: 22, 37: 21, 38: 20,
  39: 18, 40: 17, 41: 16, 42: 15, 43: 14, 44: 13, 45: 12, 46: 10,
};
const N = Number(process.env.N || 60);      // số lượt đo mỗi lần thử
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;

const d = readD();
const clone = (o) => JSON.parse(JSON.stringify(o));

// Dựng một ứng viên với `want` ô lớp-2, rồi đo. Mọi thứ khác giữ nguyên theo seed để
// phép dò nhị phân là đơn điệu (chỉ có mỗi lượng lớp-2 thay đổi).
function build(src, n, want, opts = {}) {
  const L = clone(src);
  L.slam = true;
  delete L.layer2;
  delete L.hidden;
  const seed = n * 977 + 13;

  // Màu NỀN của chính level nguồn = màu nhiều ô nhất (L15-30 dùng nền kem-14/khác nhau,
  // không phải 12 như bộ 131-152 — truyền cứng 12 làm makeOrder lệch pha sai kiểu, L32 ra 0%).
  const cnt = {};
  for (const v of L.board) if (v != null && v >= 0 && v < 90) cnt[v] = (cnt[v] || 0) + 1;
  const bg = Number(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] ?? 12);

  // 1) lớp 2 (đòn bẩy chính)
  if (want >= 8) addLayer2Clusters(L, seed, want, { bgColor: bg });

  // 2) chia lại xe cho khớp bất biến ghế = ô (reCar tự cộng cả lớp 2)
  const cdep = colorDepth(L);
  let cars = reCar(L, seed, { minCars: opts.minCars ?? 0, maxCars: opts.maxCars ?? 99 });
  L.chests = makeOrder(cars, cdep, n * 31 + 7, opts.gentle ? { gentle: true } : { bgColor: bg, bgHead: 3, deepN: 3 });

  // 3) xe đôi gánh nhau — cặp lệch độ sâu, tạo áp lực ô chờ thật
  if (opts.twins) addBaggageTwins(L, opts.twins, cdep, seed);

  // 4) xe úp mặt (sau twins: addBuried bỏ qua xe đã ghép cặp)
  if (opts.buried) addBuried(L, opts.buried, seed, L.lanes || 4);

  // 5) ô "?" — đặt CUỐI vì nó chỉ che thông tin, không đụng số lượng ô/ghế
  // (makeHidden trả {hidden, count} — level cần MẢNG hidden)
  if (opts.hidden) {
    const h = makeHidden(L.board, L.cols, L.rows, opts.hidden, seed);
    if (h) L.hidden = h.hidden;
  }
  return L;
}

// Dò nhị phân trên tổng ô lớp-2: càng nhiều lớp 2 → càng khó → winrate càng thấp.
function tuneOnce(src, n, target, opts) {
  let lo = 0, hi = 260, best = null;
  const seen = new Map();
  const at = (want) => {
    if (seen.has(want)) return seen.get(want);
    const L = build(src, n, want, opts);
    const w = measure(L, N);
    seen.set(want, { L, w });
    if (!best || Math.abs(w - target) < Math.abs(best.w - target)) best = { L, w, want };
    return seen.get(want);
  };
  const base = at(0);
  if (base.w < target - 5) return { ...best, under: true }; // 0 lớp-2 mà vẫn khó quá → phải lùi cơ chế
  for (let i = 0; i < 9 && hi - lo > 6; i++) {
    const mid = Math.round((lo + hi) / 2);
    const r = at(mid);
    if (r.w > target) lo = mid; else hi = mid;   // còn dễ → thêm lớp 2
  }
  at(lo); at(hi);
  return best;
}

// Nếu cơ chế phụ tự chúng đã đè quá target (nguồn L22-30 vốn sẵn khó), lùi dần
// xe đôi / úp mặt theo nấc cho tới khi dò được. "?" giữ nguyên — nó chỉ che mắt
// người, sim gần như không chấm nó, và đây là chỗ duy nhất test được cơ chế này.
function tune(src, n, target, opts) {
  const scales = [1, 0.7, 0.45, 0.2, 0];
  let best = null;
  // hai nấc thứ tự xe: lệch pha (khó) trước, HIỀN sau — vài nguồn giòn tới mức lệch pha
  // ở mọi mức cơ chế vẫn 0-7% (L32/L34/L38), phải về thứ tự hiền rồi bù khó bằng lớp 2.
  for (const gentle of [false, true]) {
    for (const sc of scales) {
      const o = { ...opts, gentle, twins: Math.round(opts.twins * sc), buried: opts.buried * sc };
      const r = tuneOnce(src, n, target, o);
      if (!best || Math.abs(r.w - target) < Math.abs(best.w - target)) best = r;
      if (!r.under && Math.abs(r.w - target) <= 4) return best; // đủ sát → dừng
    }
  }
  return best;
}

console.log(`Nhan L15-30 -> L31-46 (do bang mo hinh A, N=${N})\n`);
console.log("moi | nguon | target |  do  | lop2 | xe | doi | up mat | \"?\"");
for (let n = 31; n <= 46; n++) {
  if (ONLY && !ONLY.includes(n)) continue;
  const s = n - 16;
  const src = d[s];
  if (!src) { console.log(`L${n}: thieu nguon L${s}`); continue; }
  // Cơ chế tăng dần theo độ sâu của dải: càng về cuối càng nhiều thứ che thông tin.
  const k = (n - 31) / 15; // 0 → 1
  const opts = {
    twins: 1 + Math.round(k * 3),          // 1 → 4 cặp
    buried: 0.15 + k * 0.25,               // 15% → 40% số xe úp mặt
    hidden: n >= 35 ? 0.06 + k * 0.06 : 0, // ô "?" từ L35 trở đi
  };
  const t = TARGET[n];
  const r = tune(src, n, t, opts);
  const L = r.L;
  const lay = L.layer2 ? L.layer2.filter((v) => v != null && v >= 0).length : 0;
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const bu = L.chests.filter((c) => c.buried).length;
  const hi = L.hidden ? L.hidden.filter((v) => v >= 0).length : 0;
  d[n] = L;
  console.log(
    `L${n} |  L${String(s).padStart(2)}  |  ${String(t).padStart(3)}%  | ${String(r.w).padStart(3)}% | ` +
    `${String(lay).padStart(4)} | ${String(L.chests.length).padStart(2)} | ${String(tw).padStart(3)} | ${String(bu).padStart(6)} | ${String(hi).padStart(3)}`
  );
}
writeD(d);
console.log("\nda ghi vao src/levels/designed.json");
