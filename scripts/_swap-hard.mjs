// TRÁO ẢNH cho level ÷5 không ép được về dải (user 2026-08-14: "nếu k đạt target thì thay thế
// bởi ảnh level dễ rồi build lại").
//
//   MISS=45,300,545 node scripts/_swap-hard.mjs          # xem trước, không ghi
//   MISS=45,300,545 WRITE=1 node scripts/_swap-hard.mjs  # ghi designed.json
//
// TRÁO chứ không thay: ảnh của level ÷5 đi sang level thường và ngược lại, nên không bức nào
// bị mất khỏi game. Sau bước này PHẢI dựng lại hàng xe cho CẢ HAI level (_tuneAll --scan
// ONLY=...), vì hàng xe cũ thuộc về board cũ — đổi board là bất biến ghế=ô vỡ ngay.
//
// ⚠ ĐÁ LÀ PHÁ HUỶ: mã ≥90 GHI ĐÈ lên ô màu, màu gốc mất hẳn. Nên không thể "gỡ đá" khỏi một
// board. Hệ quả: chỉ nhận board KHÔNG CÓ ĐÁ làm ảnh cho vào, và nếu level ÷5 đang có đá thì
// phải RẢI LẠI đá lên board mới ở ĐÚNG những hàng cũ.
//
// Chọn ảnh cho vào theo LEVEL-DESIGN §7: board ép khó được là board NHIỀU MÀU và NHIỀU ĐỐM LẺ
// (vụn). Level hụt vì QUÁ DỄ thì cần ảnh vụn hơn; hụt vì QUÁ KHÓ thì cần ảnh liền mảng hơn.
import fs from "node:fs";
import { readD, writeD, isC } from "./genlib.mjs";

const d = readD();
const MISS = (process.env.MISS || "").split(",").map(Number).filter(Boolean);
if (!MISS.length) { console.error("dat MISS=45,300,... (danh sach level ÷5 hut dai)"); process.exit(1); }
const scan = process.env.SCAN
  ? Object.fromEntries(process.env.SCAN.split(",").flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8"))).map((r) => [r.n, r.b]))
  : {};

// ĐIỂM ÉP-KHÓ = màu×3 + độ-vụn×60, với độ vụn = tỉ lệ đốm chỉ có 1-2 ô trên tổng số đốm.
// LEVEL-DESIGN §7: board NHIỀU MÀU + NHIỀU ĐỐM LẺ là board ép khó được; board liền mảng ít màu
// thì đụng trần dù chỉnh hàng xe kiểu gì (đúng ca L90 icecream: 6 màu, mảng 211/175/119 ô, sàn
// 79% trước một target 20%). Cùng công thức với scripts/_hardable.json.
function score(L) {
  const W = L.cols, H = L.rows, b = L.board, seen = new Array(b.length).fill(false);
  let tiny = 0, blobs = 0;
  for (let i = 0; i < b.length; i++) {
    if (!isC(b[i]) || seen[i]) continue;
    const c = b[i], st = [i]; seen[i] = true; let sz = 0;
    while (st.length) {
      const p = st.pop(); sz++; const x = p % W, y = (p / W) | 0;
      for (const [a, e] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (a < 0 || e < 0 || a >= W || e >= H) continue;
        const q = e * W + a;
        if (!seen[q] && b[q] === c) { seen[q] = true; st.push(q); }
      }
    }
    blobs++; if (sz <= 2) tiny++;
  }
  return new Set(b.filter(isC)).size * 3 + (blobs ? tiny / blobs : 0) * 60;
}

const hasRock = (L) => L.board.some((v) => v >= 90);
// Hàng nào của board đang mang đá — để rải lại đúng những hàng ấy lên ảnh mới.
const rockRows = (L) => {
  const rows = new Set();
  L.board.forEach((v, i) => { if (v >= 90) rows.add(Math.floor(i / L.cols)); });
  return [...rows].sort((a, b) => a - b);
};

// ⚠ ĐIỂM ÉP-KHÓ KHÔNG DỰ ĐOÁN ĐƯỢC B. Đo 2026-08-14 trên 106 bàn ÷5 vừa dựng: hệ số tương quan
// giữa điểm và B đạt được là r = 0.011 — tức BẰNG KHÔNG. L285 điểm 74 (cao, đáng lẽ dễ ép khó)
// rơi xuống B=13; L320 điểm 53 lại mắc ở 46. Nên KHÔNG dùng điểm để nhắm một mức khó cụ thể.
//
// Cái duy nhất điểm còn dùng được là XÁC SUẤT NỀN: 102/106 bàn lọt dải có điểm nằm trong một
// khoảng hẹp (tứ phân vị 61-75). Nên chọn ảnh thay từ ĐÚNG KHOẢNG ẤY — không phải vì nó sẽ ra
// đúng con số nào, mà vì đó là vùng mà phần lớn ảnh khác đã lọt. Lấy thái cực (điểm 6, bàn
// phẳng lì nhất kho) là đánh cược vào một quan hệ đã chứng minh là không tồn tại.
//
// TRÁO XONG PHẢI ĐO LẠI. Vẫn hụt thì đổi ảnh khác — không có đường tắt nào bỏ được bước đo.
const BAND = (process.env.DONOR_BAND || "61-75").split("-").map(Number);
const MID = (BAND[0] + BAND[1]) / 2;
const donors = Object.keys(d).map(Number)
  .filter((n) => n >= 41 && n % 5 !== 0 && d[n]?.board && !hasRock(d[n]))
  .map((n) => ({ n, s: score(d[n]) }))
  .filter((x) => x.s >= BAND[0] && x.s <= BAND[1])
  .sort((a, z) => Math.abs(a.s - MID) - Math.abs(z.s - MID));

const SKIP = new Set((process.env.SKIP || "").split(",").map(Number).filter(Boolean)); // ảnh đã thử mà vẫn hụt
const used = new Set();
const plan = [];
for (const n of MISS) {
  const L = d[n];
  if (!L?.board) { console.log(`L${n}: khong co board, bo qua`); continue; }
  const b = scan[n];
  const pool = donors.filter((x) => !used.has(x.n) && !SKIP.has(x.n));
  if (!pool.length) { console.log(`L${n}: het anh ung vien trong khoang ${BAND.join("-")}`); continue; }
  const donor = pool[0];
  used.add(donor.n);
  plan.push({ five: n, donor: donor.n, b, tooEasy: b === undefined || b > 43,
    sFive: +score(L).toFixed(1), sDonor: +donor.s.toFixed(1), rocks: hasRock(L) ? rockRows(L) : null });
}

console.log("lv÷5 | B do duoc | huong    | diem ep-kho | <-> level thuong | diem | da");
for (const p of plan)
  console.log(`L${String(p.five).padEnd(5)}| ${String(p.b ?? "?").padStart(9)} | ${(p.tooEasy ? "qua DE" : "qua KHO").padEnd(8)} | ${String(p.sFive).padStart(11)} | L${String(p.donor).padEnd(15)} | ${String(p.sDonor).padStart(4)} | ${p.rocks ? "hang " + p.rocks.join(",") : "-"}`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }

for (const p of plan) {
  const A = d[p.five], B = d[p.donor];
  const a = { cols: A.cols, rows: A.rows, board: A.board };
  const b = { cols: B.cols, rows: B.rows, board: B.board };
  // Chỉ tráo phần ẢNH. layer2/hidden thuộc về board cũ nên xoá đi — _tuneAll dựng lại chúng
  // TRƯỚC khi đo, đúng như lượt build gốc (đắp sau là mọi con số đo được đều sai).
  Object.assign(A, b); Object.assign(B, a);
  for (const L of [A, B]) { delete L.layer2; delete L.hidden; }
  // Rải lại đá lên ảnh mới, đúng những hàng cũ (bỏ lề 2 ô mỗi bên như add-rocks.mjs).
  if (p.rocks) for (const r of p.rocks) for (let c = 2; c < A.cols - 2; c++) {
    const i = r * A.cols + c;
    if (i < A.board.length && isC(A.board[i])) A.board[i] = 90;
  }
}
writeD(d);
console.log(`\nda trao ${plan.length} cap va ghi designed.json`);
console.log(`BUOC TIEP: dung lai hang xe cho ca hai phia, neu khong ghe != o:`);
console.log(`  ONLY=${plan.flatMap((p) => [p.five, p.donor]).sort((a, b) => a - b).join(",")} node scripts/_tuneAll.mjs --scan`);
