// Đóng gói dist/ thành zip để nộp CrazyGames.
//
//   node scripts/make-zip.mjs            → hopin-crazygames.zip
//
// VÌ SAO PHẢI TỰ VIẾT, không dùng công cụ có sẵn trên Windows:
//
//   • PowerShell `Compress-Archive` ghi đường dẫn bằng DẤU GẠCH NGƯỢC (`art\x.png`).
//     Chuẩn ZIP (APPNOTE 4.4.17.1) quy định phải là dấu gạch xuôi. Máy chủ giải nén bằng
//     Node/Java/Python sẽ coi `art\x.png` là MỘT tên file có dấu `\` trong đó, không tạo
//     thư mục nào — nên `index.html` vẫn tìm thấy (nó ở gốc, không có dấu `\`) mà toàn bộ
//     ảnh và mã thì 404. Game mở ra trắng trơn, và triệu chứng trông y như "thiếu
//     index.html". Đo ngày 2026-08-08: 98/99 mục bị dấu `\`.
//   • `tar -a -c -f x.zip` trên Windows KHÔNG tạo zip — nó lặng lẽ tạo file tar thường.
//     Kiểm bằng 4 byte đầu: zip thật bắt đầu bằng 50 4b 03 04.
//
// Nên ở đây tự ghi ZIP: deflate bằng zlib có sẵn, tên file luôn dùng `/`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SRC = process.argv[2] ?? "dist";
const OUT = process.argv[3] ?? "hopin-crazygames.zip";

// ---- CRC32 (bảng chuẩn, ZIP bắt buộc) --------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ZIP lưu thời gian theo định dạng DOS (giây chia 2, năm tính từ 1980).
function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

// ---- gom danh sách file ------------------------------------------------------
function walk(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    // LUÔN nối bằng "/" — đây chính là điểm mấu chốt của cả file này.
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(abs, rel));
    else if (e.isFile()) out.push({ abs, rel });
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`Khong thay thu muc ${SRC}. Chay 'VITE_TARGET=crazy npm run build' truoc.`);
  process.exit(1);
}
const files = walk(SRC).sort((a, b) => a.rel.localeCompare(b.rel));
if (!files.some((f) => f.rel === "index.html")) {
  console.error("KHONG co index.html o GOC. Phai nen NOI DUNG ben trong dist/, khong nen ca thu muc.");
  process.exit(1);
}

// ---- ghi zip -----------------------------------------------------------------
const now = dosTime(new Date());
const locals = [];
const centrals = [];
let offset = 0;

for (const f of files) {
  const raw = fs.readFileSync(f.abs);
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  // Nếu nén xong còn to hơn thì cất nguyên (method 0) — đúng như mọi bộ nén tử tế làm.
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const name = Buffer.from(f.rel, "utf8");
  const crc = crc32(raw);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); // chữ ký local header
  lh.writeUInt16LE(20, 4); // cần version 2.0
  lh.writeUInt16LE(0x0800, 6); // cờ: tên file là UTF-8
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(now.time, 10);
  lh.writeUInt16LE(now.date, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(data.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);
  locals.push(lh, name, data);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); // chữ ký central directory
  ch.writeUInt16LE(20, 4); // version tạo ra
  ch.writeUInt16LE(20, 6); // version cần để đọc
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(now.time, 12);
  ch.writeUInt16LE(now.date, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(data.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(0, 38); // thuộc tính ngoài: 0 = file thường
  ch.writeUInt32LE(offset, 42);
  centrals.push(ch, name);

  offset += lh.length + name.length + data.length;
}

const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);

fs.writeFileSync(OUT, Buffer.concat([...locals, cd, eocd]));

const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
console.log(`${OUT}  —  ${files.length} file, ${mb} MB`);
console.log(`index.html o goc: co`);
console.log(`duong dan dung dau "/": co (khong mot dau "\\" nao)`);
