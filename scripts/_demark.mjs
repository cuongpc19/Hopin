// XOÁ dấu ✦ mà Gemini in vào góc phải dưới ảnh nó sinh ra (user 2026-08-17: "xóa dấu gemini").
//
//   node scripts/_demark.mjs anh1.png anh2.png        # xem trước, chỉ báo vị trí
//   WRITE=1 node scripts/_demark.mjs anh1.png ...     # ghi đè ảnh
//
// Env: DIR (mặc định store/crazygames) · SCAN (cạnh vùng quét ở góc, mặc định 420) · PAD.
//
// CÁCH DÒ: dấu là đốm SÁNG HƠN HẲN ô ca-rô nó nằm trong, và rất nhỏ. Lấy phân vị 99.5 của độ
// sáng trong vùng góc rồi khoanh mọi pixel vượt ngưỡng. Không đóng cứng toạ độ vì mỗi khổ ảnh
// Gemini đặt dấu ở một chỗ hơi khác.
//
// CÁCH XOÁ: nội suy từ bốn cạnh của khung bao, trọng số nghịch đảo khoảng cách, rồi làm mềm mép.
// Vì dấu luôn nằm gọn trong MỘT ô ca-rô phẳng nên nội suy tái tạo đúng sắc độ và chuyển sắc của
// ô đó; thứ mất đi chỉ là vân vải, mà ở mảng ~40px trên nền be thì mắt không bắt được, nhất là
// sau khi nén JPEG.
//
// ⚠ Chỉ xoá dấu NHÌN THẤY. Google còn nhúng SynthID vào chính điểm ảnh — thứ đó không mất đi và
// công cụ này không đụng tới.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DIR || "store/crazygames";
const SCAN = Number(process.env.SCAN || 420);
const PAD = Number(process.env.PAD || 24);
const files = process.argv.slice(2);
if (!files.length) { console.log("dung: node scripts/_demark.mjs <ten file...>"); process.exit(1); }

for (const f of files) {
  const src = path.join(DIR, f);
  const meta = await sharp(src).metadata();
  const W = Math.min(SCAN, meta.width), H = Math.min(SCAN, meta.height);
  const ox = meta.width - W, oy = meta.height - H;

  const { data, info } = await sharp(src)
    .extract({ left: ox, top: oy, width: W, height: H }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const C = info.channels;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * C;
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  // ⚠ NGƯỠNG TUYỆT ĐỐI KHÔNG DÙNG ĐƯỢC. Dấu chỉ sáng hơn ô ca-rô nó nằm trong một chút, mà trong
  // cùng vùng quét còn có con đường và vệt bóng sáng hơn hẳn nó — lấy phân vị 99.5 của cả vùng
  // thì bắt trúng đường chứ không trúng dấu. So với NỀN CỤC BỘ mới đúng: làm mờ mạnh để có nền,
  // rồi tìm chỗ vọt lên trên nền ấy.
  const bl = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .blur(18).removeAlpha().raw().toBuffer();
  const diff = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * C;
    diff[i] = lum[i] - (0.299 * bl[p] + 0.587 * bl[p + 1] + 0.114 * bl[p + 2]);
  }
  const thr = Number(process.env.THR || 5);
  // ⚠ KHÔNG khoanh chung mọi pixel vượt ngưỡng — phải TÁCH VÙNG LIÊN THÔNG rồi chọn vùng có
  // dáng của cái dấu, nếu không khung bao phình ra ôm cả những đốm sáng rời rạc khác.
  const seen = new Uint8Array(W * H);
  const blobs = [];
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || diff[s] < thr) continue;
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1, cnt = 0;
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      cnt++;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && diff[j] >= thr) { seen[j] = 1; stack.push(j); }
      }
    }
    blobs.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, cnt });
  }
  // Dấu ✦: NHỎ, gần vuông, và đặc vừa phải (ngôi sao bốn cánh lấp ~1/3 khung bao của nó).
  // Trần 80px chứ không phải 160: nới rộng thì mép con đường lọt vào, đo được một vùng 153×93
  // nằm sát mép vùng quét bị chấm là "dấu" trên ảnh vuông.
  //
  // Chọn vùng TO NHẤT trong số hợp lệ. Đã thử chọn "gần góc phải dưới nhất" và SAI trên hai
  // trong ba ảnh: quanh dấu còn vài đốm sáng nhỏ nằm sát góc hơn, nên nó bốc trúng đốm rác.
  // Dấu là thứ sáng-hơn-nền lớn nhất ở vùng đó — đo trên cả ba khổ ảnh đều cho cùng chữ ký
  // ~48×50 px, fill 0.31-0.36, và đều là vùng lớn nhất.
  const cand = blobs.filter((b) => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const ar = w / h, fill = b.cnt / (w * h);
    return b.cnt >= 300 && w <= 90 && h <= 90 && ar > 0.7 && ar < 1.4 && fill > 0.25 && fill < 0.6;
  }).sort((a, b) => b.cnt - a.cnt);
  if (!cand.length) { console.log(`${f}: khong thay dau (${blobs.length} vung sang, khong vung nao dung dang)`); continue; }
  const { x0, y0, x1, y1, cnt: n } = cand[0];
  console.log(`${f}: dau o x ${ox + x0}..${ox + x1}  y ${oy + y0}..${oy + y1}  (${x1 - x0 + 1}x${y1 - y0 + 1}, ${n} px)`);
  if (process.env.WRITE !== "1") continue;

  // Vùng làm việc = khung bao + lề, cắt từ ẢNH GỐC để nội suy trên pixel thật.
  const rx = Math.max(0, ox + x0 - PAD), ry = Math.max(0, oy + y0 - PAD);
  const rw = Math.min(meta.width - rx, x1 - x0 + 1 + PAD * 2);
  const rh = Math.min(meta.height - ry, y1 - y0 + 1 + PAD * 2);
  const reg = await sharp(src).extract({ left: rx, top: ry, width: rw, height: rh })
    .removeAlpha().raw().toBuffer();

  // Khung cần vá, toạ độ trong vùng làm việc, nới 3px cho hết viền mờ của dấu.
  const bx0 = ox + x0 - rx - 3, bx1 = ox + x1 - rx + 3;
  const by0 = oy + y0 - ry - 3, by1 = oy + y1 - ry + 3;
  const at = (x, y, c) => reg[(y * rw + x) * 3 + c];
  const out = Buffer.from(reg);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const dl = x - (bx0 - 1), dr = (bx1 + 1) - x, dt = y - (by0 - 1), db = (by1 + 1) - y;
    const wl = 1 / dl, wr = 1 / dr, wt = 1 / dt, wb = 1 / db;
    const s = wl + wr + wt + wb;
    for (let c = 0; c < 3; c++) {
      const v = (at(bx0 - 1, y, c) * wl + at(bx1 + 1, y, c) * wr
        + at(x, by0 - 1, c) * wt + at(x, by1 + 1, c) * wb) / s;
      // Làm mềm mép: sát viền thì pha dần về pixel gốc, tránh đường gờ.
      const edge = Math.min(dl, dr, dt, db);
      const k = Math.min(1, edge / 6);
      out[(y * rw + x) * 3 + c] = Math.round(v * k + at(x, y, c) * (1 - k));
    }
  }
  const patch = await sharp(out, { raw: { width: rw, height: rh, channels: 3 } }).png().toBuffer();
  const buf = await sharp(src).composite([{ input: patch, left: rx, top: ry }]).png().toBuffer();
  fs.writeFileSync(src, buf);
  console.log(`  -> da xoa, ghi de ${src}`);
}
