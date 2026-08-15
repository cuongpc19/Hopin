// Rải ĐÁ vào một tỉ lệ nhỏ level THƯỜNG, chọn ngẫu nhiên (user 2026-08-14: "chọn tiếp 3% các
// level thường (k chia hết cho 5), từ level 41-200, chọn random, rồi thêm đá vào").
//
//   node scripts/_rocks-random.mjs            # xem trước
//   WRITE=1 node scripts/_rocks-random.mjs    # ghi
//
// Env: RANGE (41-200) · PCT (3) · SEED · BAND (2 hàng) · MARGIN (2 ô chừa mỗi bên).
//
// ⚠ ĐÁ LÀ PHÁ HUỶ VÀ PHẢI RẢI TRƯỚC KHI TUNE. Mã 90 GHI ĐÈ lên ô màu, màu gốc mất hẳn — nên
// số ô của màu đó giảm, mà bất biến ghế=ô tính theo đúng con số ấy. Rải đá sau khi tune là
// level thừa ghế và KHÔNG THỂ THẮNG. Đã dính đúng lỗi này một lần (commit 7e6825a, 8 level).
// Thứ tự bắt buộc: rải đá ở đây → _tuneAll --scan → --write.
//
// ⚠ ĐỪNG CHẠY CÙNG LÚC VỚI MỘT LƯỢT --write KHÁC. Cả hai đọc designed.json vào bộ nhớ lúc khởi
// động rồi ghi đè cả file; chạy chồng nhau thì bên ghi sau nuốt bên ghi trước, KHÔNG BÁO LỖI.
import { readD, writeD, isC, mkRng } from "./genlib.mjs";

const ROCK = 90;
const [R0, R1] = (process.env.RANGE || "41-200").split("-").map(Number);
const PCT = Number(process.env.PCT || 3);
const BAND = Number(process.env.BAND || 2);
const MARGIN = Number(process.env.MARGIN || 2);
const d = readD();

// Level THƯỜNG (không ÷5), chưa có đá sẵn, và bàn đủ cao để chừa lề hai đầu.
const pool = Object.keys(d).map(Number)
  .filter((n) => n >= R0 && n <= R1 && n % 5 !== 0 && d[n]?.board
    && !d[n].board.some((v) => v >= 90) && d[n].rows >= BAND + MARGIN * 2 + 4)
  .sort((a, b) => a - b);

// ONLY=n,n,n — rải đúng bộ level được chỉ định, bỏ qua phần bốc ngẫu nhiên. Dùng khi bộ level
// đã được chọn ở nơi khác (_pick-obst.mjs bốc đá và socola một lượt để hai bộ không trùng nhau).
const ONLY = (process.env.ONLY || "").split(",").map(Number).filter(Boolean);
let picked;
if (ONLY.length) {
  const bad = ONLY.filter((n) => !pool.includes(n));
  if (bad.length) { console.log(`ONLY co level khong du dieu kien: ${bad.join(",")} — dung lai`); process.exit(1); }
  picked = ONLY.slice().sort((a, b) => a - b);
} else {
  const want = Math.max(1, Math.round((pool.length * PCT) / 100));
  // SEED cố định → chạy lại ra ĐÚNG bộ level ấy. Không có seed thì mỗi lần chạy lại là một bộ
  // khác, mà đá đã rải rồi thì không gỡ được (xem cảnh báo phá huỷ ở trên).
  const rng = mkRng(Number(process.env.SEED || 20260814));
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  picked = idx.slice(0, want).map((i) => pool[i]).sort((a, b) => a - b);
}

const out = [];
for (let k = 0; k < picked.length; k++) {
  const n = picked[k], L = d[n], W = L.cols, H = L.rows;
  const top = k % 2 === 0;                       // xen kẽ TRÊN / DƯỚI cho khỏi lặp
  // ⚠ ĐỪNG ĐÓNG CỨNG HÀNG. Tranh emoji bị khoét nền nên hàng sát mép thường TRỐNG TRƠN: L117
  // rải ở hàng 2-3 ra ĐÚNG 0 ô đá, tức level không có gì thay đổi mà vẫn bị tính là "đã thêm
  // đá". Nên quét cả nửa bàn phía ấy và lấy dải có NHIỀU SLIME NHẤT — đá phải thật sự chặn
  // đường thì mới là chướng ngại.
  const rowSlime = (r) => { let s = 0; for (let c = MARGIN; c < W - MARGIN; c++) if (isC(L.board[r * W + c])) s++; return s; };
  let r0 = top ? MARGIN : H - MARGIN - BAND, best = -1;
  const lo = top ? MARGIN : Math.floor(H / 2);
  const hiR = top ? Math.floor(H / 2) - BAND : H - MARGIN - BAND;
  for (let r = lo; r <= hiR; r++) {
    let s = 0; for (let b = 0; b < BAND; b++) s += rowSlime(r + b);
    if (s > best) { best = s; r0 = r; }
  }
  const before = {};
  L.board.forEach((v) => { if (isC(v)) before[v] = (before[v] || 0) + 1; });
  let laid = 0;
  const ate = {};
  for (let r = r0; r < r0 + BAND; r++)
    for (let c = MARGIN; c < W - MARGIN; c++) {
      const i = r * W + c, v = L.board[i];
      if (isC(v)) { ate[v] = (ate[v] || 0) + 1; laid++; L.board[i] = ROCK; }
    }
  // Một màu bị đá ăn SẠCH thì màu ấy biến mất khỏi bàn — xe màu đó thành xe không bao giờ đầy,
  // tức level chết. Cảnh báo để còn dời dải đá.
  const wiped = Object.keys(ate).filter((c) => before[c] === ate[c]);
  out.push({ n, size: `${W}x${H}`, where: top ? "TREN" : "DUOI", rows: `${r0}-${r0 + BAND - 1}`, laid, wiped });
}

console.log(ONLY.length
  ? `ONLY: rai da vao ${picked.length} level da chi dinh (pool du dieu kien: ${pool.length})`
  : `pool: ${pool.length} level thuong trong L${R0}-${R1} chua co da | ${PCT}% -> ${picked.length} level`);
console.log("lv   | co ban | vi tri | hang  | o da | canh bao");
for (const o of out)
  console.log(`L${String(o.n).padEnd(4)}| ${o.size.padEnd(7)}| ${o.where.padEnd(7)}| ${o.rows.padEnd(6)}| ${String(o.laid).padStart(4)} | `
    + (o.wiped.length ? `MAU ${o.wiped.join(",")} BI XOA SACH` : "-"));
console.log(`\nMOC TIEP: ONLY=${picked.join(",")} RANGE=${R0}-${R1} ROCK_BAND=40-100 ... scan-shards.mjs`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
writeD(d);
console.log("\nda ghi designed.json — BAT BUOC dung lai hang xe cho dung nhung level nay");
