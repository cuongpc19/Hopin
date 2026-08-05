// tint-ovuong — sinh bộ ô bàn cờ 19 màu từ MỘT ảnh gốc đen: public/art/ovuong.png
//
// Ảnh gốc là ô vuông bo góc gần như đơn sắc (thân tối, vệt bóng trắng góc trên-trái, viền vát).
// Vì nó đơn sắc nên nhuộm màu được: giữ nguyên HÌNH và ĐỘ BÓNG, chỉ thay tông màu.
//
// Cách nhuộm (theo độ sáng L của từng điểm ảnh):
//   L <= Lb  → màu đích tối dần về viền   : out = target · (FLOOR + (1-FLOOR)·L/Lb)
//   L >  Lb  → sáng dần lên trắng (bóng)  : out = target + (255-target)·((L-Lb)/(1-Lb))^GLOSS
// Lb = độ sáng THÂN ô (đo từ chính ảnh gốc), nên thân ô ra đúng bằng màu trong palette.ts.
//
// Khung khớp bộ ô cũ: thân 101×100 đặt tại (15,16) trong khung 128×128 — đo từ tile-3.png,
// KHÔNG lấy cả bóng đổ của ảnh gốc (bóng đổ làm các ô kề nhau lộ đường ghép, đúng cái mà
// mấy commit "tiles meet edge to edge / stop looking quilted" đã phải chữa).
//
//   node scripts/tint-ovuong.mjs            → chỉ xuất ảnh xem thử scripts/_ovuong-preview.png
//   APPLY=1 node scripts/tint-ovuong.mjs    → ghi đè public/art/slime/tile-<id>.png (có sao lưu)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = process.env.SRC || "public/art/ovuong.png";
const OUTDIR = "public/art/slime";
const BACKUP = "art-orig/tile-truoc-ovuong";
const APPLY = process.env.APPLY === "1";

const FLOOR = Number(process.env.FLOOR || 0.35);  // viền tối nhất = màu đích × FLOOR
const GLOSS = Number(process.env.GLOSS || 0.85);  // <1 = bóng loang rộng hơn, >1 = bóng gọn lại

// palette.ts — giữ khớp thủ công (script .mjs không import .ts được)
const COLORS = [
  0xfe4038, 0xfe8f28, 0xfed734, 0x37cb5c, 0x2ac0cc, 0x408afa, 0x9756fd, 0xfd55a5,
  0xffffff, 0xcbcbcb, 0x4a4a4a, 0x985828, 0x262630, 0x3050a0, 0xe0b888, 0x98d0f0,
  0x208038, 0xf8c0c8, 0x902030,
];
const NAMES = ["do", "cam", "vang", "luc", "xanh ngoc", "xanh duong", "tim", "hong", "trang",
  "xam nhat", "xam dam", "nau", "den", "xanh dam", "be", "xanh troi", "luc dam", "hong dao", "do man"];

const CANVAS = 128, BODY_W = 101, BODY_H = 100, OFF_X = 15, OFF_Y = 16;

const { data: src0, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const src = Buffer.from(src0);
const lum = (i) => (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;

// ---- tự tách NỀN ĐỒNG MÀU nếu ảnh không có nền trong ---------------------------
// Ảnh xuất từ trình tạo ảnh AI hay là JPG nền trắng (hoặc PNG vẽ luôn hoa văn ca-rô thành
// pixel thật). Nếu 4 góc đều đục thì loang từ mép vào, xoá mọi điểm gần màu góc.
// Chỉ hợp với nền ĐỒNG MÀU — nền ca-rô phải xử lý riêng (scripts/strip-checker.mjs).
{
  const corner = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]].map(([x, y]) => (y * W + x) * C);
  const opaque = corner.every((i) => src[i + 3] > 200);
  if (opaque) {
    const TOL = Number(process.env.BGTOL || 26);
    const c0 = [0, 1, 2].map((k) => corner.reduce((a, i) => a + src[i + k], 0) / 4);
    const near = (p) => { const i = p * C; return Math.abs(src[i] - c0[0]) < TOL && Math.abs(src[i + 1] - c0[1]) < TOL && Math.abs(src[i + 2] - c0[2]) < TOL; };
    const bg = new Uint8Array(W * H); const st = [];
    const seed = (p) => { if (!bg[p] && near(p)) { bg[p] = 1; st.push(p); } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0;
      if (x > 0) seed(p - 1); if (x < W - 1) seed(p + 1);
      if (y > 0) seed(p - W); if (y < H - 1) seed(p + W);
    }
    // co thêm vài vòng: rìa ảnh JPG bị hoà với nền nên còn quầng sáng nếu không ăn bớt
    for (let k = 0, n = Number(process.env.BGFEATHER || 2); k < n; k++) {
      const grow = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const p = y * W + x; if (bg[p]) continue;
        if (bg[p - 1] || bg[p + 1] || bg[p - W] || bg[p + W]) grow.push(p);
      }
      for (const p of grow) bg[p] = 1;
    }
    let n = 0;
    for (let p = 0; p < W * H; p++) if (bg[p]) { src[p * C + 3] = 0; n++; }
    console.log(`Nen KHONG trong suot → da tach nen mau rgb(${c0.map(Math.round).join(",")}), xoa ${(100 * n / (W * H)).toFixed(1)}% anh.`);
  }
}

// hộp bao phần ĐẶC (bỏ bóng đổ mờ)
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (src[(y * W + x) * C + 3] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
}
// Lb = độ sáng TRUNG VỊ của thân ô → thân ra đúng màu palette, không bị lệch tông
const body = [];
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
  const i = (y * W + x) * C; if (src[i + 3] > 200) body.push(lum(i));
}
body.sort((a, b) => a - b);
const Lb = body[Math.floor(body.length / 2)];
console.log(`Anh goc ${W}x${H} · than o (${x0},${y0})-(${x1},${y1}) = ${x1 - x0 + 1}x${y1 - y0 + 1} · do sang than Lb=${Lb.toFixed(3)}`);
console.log(`Khung xuat ${CANVAS}x${CANVAS}, than ${BODY_W}x${BODY_H} tai (${OFF_X},${OFF_Y})  ·  FLOOR=${FLOOR} GLOSS=${GLOSS}\n`);

// Cắt thân ô rồi thu nhỏ về đúng cỡ thân của bộ ô cũ (làm MỘT lần, dùng lại cho mọi màu).
// LÀM MƯỢT TRƯỚC KHI THU NHỎ: ảnh gốc có nhiễu lấm tấm rất nhẹ, thu từ 491px xuống 101px thì
// nhiễu đó đọng lại thành hoa văn ca-rô trên thân ô — lộ nhất ở các màu sáng (trắng/xám/hồng).
// Đây đúng là kiểu nhiễu mà FEATURES.txt ghi đã khiến 3 bản tile "3D jelly" trước bị bỏ.
const SMOOTH = Number(process.env.SMOOTH ?? 2.2);   // 0 = tắt

// ---- KÉO DÀY MẶT TRƯỚC ----------------------------------------------------------
// Ảnh gốc có mặt trước (phần "thân" nhìn nghiêng) chỉ dày 8,3% chiều cao ô. Game vẽ ô ở cỡ
// ~11px nên phần đó còn chưa tới 1 điểm ảnh → không bao giờ hiện ra. Ảnh mẫu user muốn có
// thân dày cỡ 20-25%. Ở đây CẮT ĐÔI ảnh gốc tại ranh mặt-trên/mặt-trước rồi thu nhỏ HAI PHẦN
// RIÊNG: mặt trên co lại, mặt trước giãn ra, tổng vẫn vừa khung cũ nên ô không đổi kích thước.
const BODY_FRAC = Number(process.env.BODY ?? 0.21);   // 0 = giữ nguyên tỉ lệ gốc
const crop = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
const mkBase = () => {
  const b = sharp(src, { raw: { width: W, height: H, channels: C } }).extract(crop);
  return SMOOTH > 0 ? b.blur(SMOOTH) : b;
};

let cropped;
if (BODY_FRAC > 0) {
  // tìm ranh: quét cột giữa từ dưới lên, chỗ độ sáng tụt mạnh nhất
  const xc = Math.round((x0 + x1) / 2);
  let split = y1, best = 0;
  for (let y = Math.floor(y0 + (y1 - y0) * 0.6); y < y1 - 3; y++) {
    const a = lum((y * W + xc) * C), b = lum(((y + 3) * W + xc) * C);
    if (a - b > best) { best = a - b; split = y; }
  }
  const bodyH = Math.max(1, Math.round(BODY_H * BODY_FRAC));
  const topH = BODY_H - bodyH;
  // sharp không cho extract hai lần trên cùng một chuỗi → vật chất hoá phần đã cắt+làm mượt
  const flat = await mkBase().png().toBuffer();
  const cutY = Math.max(1, Math.min(crop.height - 1, split - y0));
  const topPart = await sharp(flat).extract({ left: 0, top: 0, width: crop.width, height: cutY })
    .resize(BODY_W, topH, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer();
  const botPart = await sharp(flat).extract({ left: 0, top: cutY, width: crop.width, height: crop.height - cutY })
    .resize(BODY_W, bodyH, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer();
  const merged = Buffer.concat([topPart, botPart]);
  cropped = { data: merged, info: { width: BODY_W, height: BODY_H, channels: 4 } };
  console.log(`Ranh mat tren/truoc o y=${split} (goc). Mat truoc: ${(100 * (y1 - split + 1) / crop.height).toFixed(1)}% → keo thanh ${(100 * BODY_FRAC).toFixed(0)}% (${bodyH}/${BODY_H}px).`);
} else {
  cropped = await mkBase().resize(BODY_W, BODY_H, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
}
const cd = cropped.data, cc = cropped.info.channels;

function tint(target) {
  const tr = (target >> 16) & 0xff, tg = (target >> 8) & 0xff, tb = target & 0xff;
  const out = Buffer.alloc(BODY_W * BODY_H * 4);
  for (let p = 0; p < BODY_W * BODY_H; p++) {
    const i = p * cc, o = p * 4;
    const a = cc > 3 ? cd[i + 3] : 255;
    const L = (0.2126 * cd[i] + 0.7152 * cd[i + 1] + 0.0722 * cd[i + 2]) / 255;
    let r, g, b;
    if (L <= Lb) {                                   // vùng tối: màu đích tối dần về viền
      const k = FLOOR + (1 - FLOOR) * (Lb > 0 ? L / Lb : 1);
      r = tr * k; g = tg * k; b = tb * k;
    } else {                                          // vùng sáng: loang lên trắng (bóng)
      const s = Math.pow((L - Lb) / (1 - Lb), GLOSS);
      r = tr + (255 - tr) * s; g = tg + (255 - tg) * s; b = tb + (255 - tb) * s;
    }
    out[o] = Math.max(0, Math.min(255, Math.round(r)));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
    out[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    out[o + 3] = a;
  }
  return out;
}

const frame = async (raw) => sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: raw, raw: { width: BODY_W, height: BODY_H, channels: 4 }, left: OFF_X, top: OFF_Y }])
  .png().toBuffer();

const tiles = [];
for (let i = 0; i < COLORS.length; i++) tiles.push(await frame(tint(COLORS[i])));

// ---- ảnh xem thử: 19 ô xếp lưới trên nền navy giống mặt bàn ------------------
const COLS = 10, CELL = 128;
const rows = Math.ceil(tiles.length / COLS);
const preview = await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: { r: 43, g: 47, b: 74, alpha: 255 } } })
  .composite(tiles.map((buf, i) => ({ input: buf, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL })))
  .png().toBuffer();
fs.writeFileSync("scripts/_ovuong-preview.png", preview);
console.log(`→ scripts/_ovuong-preview.png (19 mau tren nen navy)`);

// ---- ảnh so sánh: hàng trên ô CŨ, hàng dưới ô MỚI ---------------------------
const oldBufs = [];
for (let i = 0; i < COLORS.length; i++) {
  const p = path.join(OUTDIR, `tile-${i}.png`);
  oldBufs.push(fs.existsSync(p) ? await sharp(p).resize(CELL, CELL).png().toBuffer() : null);
}
const cmp = [];
for (let i = 0; i < COLORS.length; i++) {
  if (oldBufs[i]) cmp.push({ input: oldBufs[i], left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL * 2 });
  cmp.push({ input: tiles[i], left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL * 2 + CELL });
}
fs.writeFileSync("scripts/_ovuong-sosanh.png", await sharp({ create: { width: COLS * CELL, height: rows * CELL * 2, channels: 4, background: { r: 43, g: 47, b: 74, alpha: 255 } } })
  .composite(cmp).png().toBuffer());
console.log(`→ scripts/_ovuong-sosanh.png (hang tren = o CU, hang duoi = o MOI)`);

if (!APPLY) {
  console.log(`\nChua ghi de. Xem thu roi chay:  APPLY=1 node scripts/tint-ovuong.mjs`);
} else {
  fs.mkdirSync(BACKUP, { recursive: true });
  for (let i = 0; i < COLORS.length; i++) {
    const p = path.join(OUTDIR, `tile-${i}.png`);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(BACKUP, `tile-${i}.png`));
    fs.writeFileSync(p, tiles[i]);
  }
  console.log(`\n✔ Da ghi ${COLORS.length} o vao ${OUTDIR}/  (ban cu luu o ${BACKUP}/)`);
  console.log(`  Nho tang so ?v= trong GameScene.ts de trinh duyet nap lai anh moi.`);
}
console.log(`\nDanh sach mau: ${COLORS.map((c, i) => `${i}=${NAMES[i]}`).join(", ")}`);
