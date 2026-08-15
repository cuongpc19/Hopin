// Bóc nền CARO GIẢ khỏi ảnh Gemini rồi cắt viền + thu nhỏ thành icon.
//   IN=Manythings/x.png OUT=public/art/daily.png SIZE=256 node scripts/_dechecker.mjs
//
// ⚠ ẢNH GEMINI KHÔNG CÓ ALPHA THẬT. Nó VẼ hoạ tiết caro "trong suốt" thành pixel — đo được
// 71% ảnh là hai tông xám 1,1,1 và 127,127,127, còn alpha thì 255 khắp nơi. Nên `trim()` của
// sharp không cắt được gì, và dán thẳng vào game là ra một icon nền caro.
//
// LOANG TỪ VIỀN, không thay màu toàn cục: chỉ xoá phần nền NỐI RA MÉP. Thay toàn cục sẽ đục
// thủng mọi mảng xám nằm TRONG huy hiệu (vòng nguyệt quế trắng, dải băng kem, viền bạc).
import sharp from "sharp";

const IN = process.env.IN, OUT = process.env.OUT;
const SIZE = Number(process.env.SIZE || 256);
if (!IN || !OUT) { console.error("dat IN= va OUT="); process.exit(1); }

const { data, info } = await sharp(IN).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

// Ô caro: gần như không bão hoà, và độ sáng rơi vào một trong hai tông.
const isChecker = (i) => {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  // Ngưỡng phải PHỦ CẢ RĂNG CƯA giữa hai ô caro. Bản đầu chỉ nhận đúng hai tông 0 và 127 nên
  // để lại một lưới đường viền mảnh giá trị trung gian — đủ để trim() không cắt được gì.
  if (mx - mn > 24) return false;
  return mx < 165;
};

const seen = new Uint8Array(W * H);
const q = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x;
  if (seen[p] || !isChecker(p * C)) return;
  seen[p] = 1; q.push(p);
};
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
for (let h = 0; h < q.length; h++) {
  const p = q[h], x = p % W, y = (p / W) | 0;
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
}
let cleared = 0;
for (let p = 0; p < W * H; p++) if (seen[p]) { data[p * C + 3] = 0; cleared++; }
console.log(`xoa nen: ${cleared} px = ${((100 * cleared) / (W * H)).toFixed(1)}%`);

// Cắt viền theo alpha rồi thu nhỏ. `trim` cần alpha thật — giờ đã có.
const buf = await sharp(data, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
const out = await sharp(buf).trim({ threshold: 1 })
  .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 }).toBuffer();
const meta = await sharp(buf).trim({ threshold: 1 }).metadata();
await sharp(out).toFile(OUT);
console.log(`cat con ${meta.width}x${meta.height} -> ghi ${OUT} ${SIZE}x${SIZE}, ${(out.length / 1024).toFixed(0)} KB`);
