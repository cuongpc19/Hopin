// Thêm VIỀN cho những level chưa có, và phát đúng một xe để nuôi số ô viền vừa thêm.
//
//   node scripts/add-frame.mjs 36-60          # xem trước, KHÔNG ghi
//   node scripts/add-frame.mjs 36-60 --write  # ghi vào designed.json
//
// Vì sao không dùng thẳng `border.applyBoxBorder`: hàm đó đổ đầy MỌI ô trống trong hộp
// bbox+1, tức là lấp cả những khoảng rỗng BÊN TRONG tranh. Với L37 thì đó là 262 ô — không
// còn là thêm viền nữa mà là vẽ lại tranh. Ở đây chỉ đụng đúng VÒNG NGOÀI, cách bbox 1 ô, và
// chỉ ghi lên ô đang trống — nên không có nét nào của user bị đè.
//
// Bất biến ghế = ô (LEVEL-DESIGN.md §0.2): viền thêm N ô màu c thì phải thêm đúng N ghế màu c.
// Xe viền đặt ở ĐẦU hàng vì viền là lớp ngoài cùng, tia bóc nó trước tiên; để nó nằm cuối thì
// xe đứng chờ và khoá bay.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";
import { gradeBatch } from "./calib.mjs";

const isC = (v) => v >= 0 && v < 90;
// Ưu tiên màu viền: board là thảm navy tối nên viền phải là màu có sức sống.
// CẤM (border.mjs): navy-12 trùng thảm → khung tàng hình; trắng-8 và xám-9 → khối trắng đục.
const PREFER = [14, 10, 11, 13, 15, 16, 17, 1, 0, 18];
const BANNED = new Set([12, 8, 9]);

export function frameOf(L) {
  const { cols: W, rows: H, board: b } = L;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let i = 0; i < b.length; i++) if (isC(b[i])) { const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  // Vòng ngoài của bbox đã đồng nhất một màu ⇒ level NÀY ĐÃ CÓ VIỀN, bỏ qua.
  const cur = new Set();
  for (let x = x0; x <= x1; x++) { cur.add(b[y0 * W + x]); cur.add(b[y1 * W + x]); }
  for (let y = y0; y <= y1; y++) { cur.add(b[y * W + x0]); cur.add(b[y * W + x1]); }
  if (cur.size === 1 && isC([...cur][0])) return { already: true };

  const r0 = y0 - 1, r1 = y1 + 1, c0 = x0 - 1, c1 = x1 + 1;
  if (r0 < 0 || c0 < 0 || r1 >= H || c1 >= W) return { noRoom: true, need: [r0, c0, r1 - H + 1, c1 - W + 1] };

  const ring = [];
  for (let x = c0; x <= c1; x++) { for (const y of [r0, r1]) { const i = y * W + x; if (b[i] === -1 || b[i] == null) ring.push(i); } }
  for (let y = r0 + 1; y <= r1 - 1; y++) { for (const x of [c0, c1]) { const i = y * W + x; if (b[i] === -1 || b[i] == null) ring.push(i); } }
  if (!ring.length) return { noRoom: true };

  // Màu viền không được trùng màu ô tranh nằm sát viền (8 hướng) — khung dính vào chủ thể
  // thì không còn đọc ra là khung nữa (luật border.mjs).
  const adj = new Set();
  for (const i of ring) { const r = (i / W) | 0, c = i % W;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= H || nc >= W) continue;
      const v = b[nr * W + nc]; if (isC(v)) adj.add(v); } }
  const color = PREFER.find((c) => !adj.has(c) && !BANNED.has(c))
    ?? [...Array(19).keys()].find((c) => !adj.has(c) && !BANNED.has(c));
  if (color == null) return { noColor: true };
  return { ring, color, pct: Math.round((100 * ring.length) / (W * H)) };
}

export function applyFrame(L0, split = 4) {
  const f = frameOf(L0);
  if (!f || f.already || f.noRoom || f.noColor) return null;
  const L = JSON.parse(JSON.stringify(L0));
  for (const i of f.ring) L.board[i] = f.color;
  // CHẺ LÀM 4, mỗi hàng một xe — không phải một xe to.
  // Viền kín chặn hết tia vào tranh cho tới khi ăn xong, nên nếu chỉ có MỘT xe viền thì ba
  // xe đầu hàng còn lại đều là bẫy: bấm vào là chiếm ô chờ mà không ăn được gì. Đo được:
  // một xe viền kéo L36 từ 94% xuống 40%, L50 từ 78% xuống 32%. Bốn xe thì nước đi đầu nào
  // cũng đúng — đúng nguyên tắc "đầu hàng luôn có màu đang ăn được" (LEVEL-DESIGN.md §3.1).
  const base = Math.floor(f.ring.length / split), rem = f.ring.length % split;
  const frameCars = Array.from({ length: split }, (_, k) => ({ color: f.color, count: base + (k < rem ? 1 : 0) }))
    .filter((c) => c.count > 0);
  L.chests = [...frameCars, ...L.chests];
  return { L, ...f };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("add-frame.mjs")) {
  const [lo, hi] = (process.argv[2] || "36-60").split("-").map(Number);
  const WRITE = process.argv.includes("--write");
  const d = readD();
  const done = [], skip = [];
  for (let n = lo; n <= hi; n++) {
    if (!d[n]) continue;
    const f = frameOf(d[n]);
    if (!f) { skip.push([n, "board rong"]); continue; }
    if (f.already) { skip.push([n, "da co vien"]); continue; }
    if (f.noRoom) { skip.push([n, "khong con le de ve vien"]); continue; }
    if (f.noColor) { skip.push([n, "khong con mau hop le"]); continue; }
    if (f.pct > 30) { skip.push([n, `vien ${f.pct}% > 30% (luat border.mjs)`]); continue; }
    done.push({ n, f });
  }
  // SỐ XE VIỀN PHẢI QUÉT, KHÔNG ĐOÁN. Viền kín chặn tia vào tranh cho tới khi ăn xong, nên
  // chẻ nó thành mấy xe quyết định nước đi đầu có bị tắc không — và ngưỡng đúng khác nhau
  // theo từng board. Đo được: một xe kéo L36 94%→40%; chẻ 4 cứu L36 (79%) nhưng lại dìm
  // L48 75%→30% và L58 83%→35%. Vậy phải thử rồi lấy nấc GẦN winrate cũ nhất — viền là việc
  // hình thức, không được đổi độ khó.
  const SPLITS = [1, 2, 3, 4, 6, 8];
  const jobs = [];
  for (const x of done) { jobs.push({ n: x.n, split: 0, L: d[x.n] });
    for (const s of SPLITS) jobs.push({ n: x.n, split: s, L: applyFrame(d[x.n], s).L }); }
  console.error(`do ${done.length} level x (goc + ${SPLITS.length} cach che) = ${jobs.length} phep do…`);
  const g = gradeBatch(jobs.map((j) => j.L), { n: 120, tag: "frame" });
  jobs.forEach((j, i) => { j.win = g[i].win; j.b = g[i].b; j.d = g[i].d; });
  console.log("| lv | ô viền | % bàn | màu | win trước | xe viền | win sau | lệch | xe trước → sau |");
  console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  // L50: chấm theo D chứ không theo blend. Ở board này B và D cãi nhau hoàn toàn — mọi cách
  // chẻ đều cho D 92-100 (dễ) trong khi B sụp xuống 0-6, nên blend đọc 23-40%. Bảng đối chiếu
  // với người chơi thật (scripts/real-vs-model.mjs, 46 level) cho thấy D sai trung bình 8 điểm
  // còn B sai 12, và L50 ngoài đời 6/6 người đều qua — nên ở đây tin D.
  const BY_D = new Set([50]);
  for (const x of done) {
    const mine = jobs.filter((j) => j.n === x.n);
    const zero = mine.find((j) => j.split === 0);
    const before = zero.win;
    const key = BY_D.has(x.n) ? (j) => Math.abs(j.d - zero.d) : (j) => Math.abs(j.win - before);
    const best = mine.filter((j) => j.split > 0).sort((a, b) => key(a) - key(b))[0];
    x.L = best.L; x.split = best.split; x.before = before; x.after = best.win;
    console.log(`| L${x.n} | ${x.f.ring.length} | ${x.f.pct}% | id ${x.f.color} | ${before}% | ${best.split} | ${best.win}% | ${best.win - before > 0 ? "+" : ""}${best.win - before} | ${d[x.n].chests.length} → ${best.L.chests.length} |`);
  }
  if (skip.length) console.log("\nBo qua: " + skip.map(([n, w]) => `L${n} (${w})`).join(", "));
  if (WRITE) { for (const x of done) d[x.n] = x.L; writeD(d); console.log("\nDA GHI vao src/levels/designed.json"); }
  else console.log("\n(xem truoc — them --write de ghi)");
}
