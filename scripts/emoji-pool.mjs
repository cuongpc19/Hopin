// BƯỚC 1/2 của bộ dựng level từ emoji.  Chạy:  node scripts/emoji-pool.mjs
//
// Dựng CẢ KHO (chủ thể × 2 cỡ) và LƯU từng level object lại, kèm số đo "đẹp".
// Lưu để bước xếp slot (emoji-assign.mjs) chỉ việc chép — dựng lại 60 bàn cho mỗi lần đổi
// thứ tự thì quá phí.
//
// Cần: public/art/level art/emoji/ chứa <tên>.png + cand.txt ("<mã hex> <tên> <chủ đề>").
// Ảnh nguồn lấy từ Noto Emoji (SIL OFL — dùng thương mại được). ĐỪNG dùng OpenMoji: CC BY-SA,
// điều khoản share-alike sẽ lây sang cả game.
//
// ⚠ ĐỘ ĐẶC CỦA ẢNH GỐC KHÔNG DỰ ĐOÁN ĐƯỢC chủ thể có qua rule viền hay không (bee đặc 43%
// thì đạt, banana 46% lại trượt). Nên phải dựng thật từng cái rồi loại, không lọc trước.
// Và chủ thể THÂN TRẮNG luôn trượt: nền sheet là trắng nên bộ tách nền ăn mất thân.
import sharp from "sharp";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const D = "public/art/level art/emoji";
// CAND=<file> chọn danh sách ứng viên; POOL=<file> chọn nơi ghi kho.
// Mỗi dòng: "<mã hex noto> <tên> <chủ đề>". Ảnh phải nằm sẵn ở <tên>.png trong D.
const CAND = process.env.CAND || "cand.txt";
const POOL = process.env.POOL || "pool.json";
const SHEETPFX = process.env.SHEETPFX || "pool";
// SIZES=25,31 — cỡ board cần dựng. Board CÀNG TO thì tỉ lệ qua rule viền càng cao, vì viền
// tính theo % board: cùng một chủ thể trượt ở 25 vẫn có thể đạt ở 35.
const SIZES = (process.env.SIZES || "25,31").split(",").map(Number);
const ALL = fs.readFileSync(`${D}/${CAND}`, "utf8").trim().split("\n")
  .map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 3).map((r) => [r[1], r[2]]);

const CELL = 512;
const sheets = [];
for (let s = 0; s * 10 < ALL.length; s++) sheets.push(ALL.slice(s * 10, s * 10 + 10));
for (let s = 0; s < sheets.length; s++) {
  const layers = [];
  for (let i = 0; i < sheets[s].length; i++) {
    const buf = await sharp(`${D}/${sheets[s][i][0]}.png`).trim({ threshold: 10 })
      .resize(CELL, CELL, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).toBuffer();
    layers.push({ input: buf, left: (i % 5) * CELL, top: Math.floor(i / 5) * CELL });
  }
  await sharp({ create: { width: CELL * 5, height: CELL * 2, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(layers).png().toFile(`${D}/${SHEETPFX}${s}.png`);
}

// "đẹp" = giàu màu + phủ rộng + LIỀN MẢNG (ít đốm lẻ). Đốm lẻ vừa làm tranh lấm tấm
// vừa là thứ §7 chỉ ra là khiến level không ép dễ được — nên nó xấu ở cả hai nghĩa.
function beauty(L) {
  const W = L.cols, H = L.rows, b = L.board, seen = new Array(b.length).fill(false);
  const isC = (v) => v >= 0 && v < 90;
  let tiny = 0, blobs = 0, cells = 0;
  for (let i = 0; i < b.length; i++) {
    if (!isC(b[i])) continue; cells++;
    if (seen[i]) continue;
    const c = b[i]; const st = [i]; seen[i] = true; let sz = 0;
    while (st.length) { const p = st.pop(); sz++; const x = p % W, y = (p / W) | 0;
      for (const [a, d] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
        if (a < 0 || d < 0 || a >= W || d >= H) continue; const q = d * W + a;
        if (!seen[q] && b[q] === c) { seen[q] = true; st.push(q); } } }
    blobs++; if (sz <= 2) tiny++;
  }
  const colours = new Set(b.filter(isC)).size;
  const clean = blobs ? 1 - tiny / blobs : 0;
  const cover = cells / (W * H);
  return { colours, clean: +clean.toFixed(3), cover: +cover.toFixed(3), cells,
           score: +(colours * 3 + clean * 40 + cover * 20).toFixed(1) };
}

// File nháp DÙNG CHUNG cho mọi lượt dựng — nên hai lượt emoji-pool chạy CÙNG LÚC sẽ ghi đè
// lên nhau. SCRATCH=<file> để chạy song song hai danh sách ứng viên (nhớ đặt cả POOL/SHEETPFX
// khác nhau nữa).
const SCRATCH = process.env.SCRATCH || "scripts/_pool-one.json";
const pool = {};
for (let s = 0; s < sheets.length; s++) {
  for (let i = 0; i < sheets[s].length; i++) {
    const [name, theme] = sheets[s][i];
    for (const size of SIZES) {
      try {
        fs.writeFileSync(SCRATCH, "{}");
        execFileSync(process.execPath, ["scripts/build-one.mjs", `${D}/${SHEETPFX}${s}.png`, String(i), "900", "11", String(size)],
          { env: { ...process.env, KEEPDARK: "1", OUTFILE: SCRATCH }, encoding: "utf8", stdio: "pipe" });
        const L = JSON.parse(fs.readFileSync(SCRATCH, "utf8"))[900];
        pool[`${name}@${size}`] = { name, theme, size, level: L, ...beauty(L) };
      } catch { /* trượt rule viền ở cỡ này */ }
    }
  }
}
fs.writeFileSync(`${D}/${POOL}`, JSON.stringify(pool));
const names = new Set(Object.values(pool).map((p) => p.name));
console.log(`kho: ${Object.keys(pool).length} bản dựng, ${names.size} chủ thể dùng được / ${ALL.length}`);
