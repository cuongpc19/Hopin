// XẾP LẠI bộ C: bàn NHIỀU MÀU NHẤT về các slot KHÓ (user 2026-08-18: "tìm các level nào có
// nhiều dải màu nhất thì turn cho các level khó").
//
//   node scripts/_reassignC.mjs            # xem trước
//   WRITE=1 node scripts/_reassignC.mjs    # ghi
//
// ⚠ HOÁN VỊ TẠI CHỖ, KHÔNG CHÉP LẠI TỪ BÀN GỐC. Chạy lại _buildC.mjs sẽ chép đè từ L50-500 —
// mà những bàn ấy vẫn còn đá và socola, tức xoá sạch công của _cleanC.mjs. Ở đây chỉ đảo chỗ
// các bàn ĐÃ LÀM SẠCH giữa 9101-9133 với nhau.
//
// Vì sao nhiều màu = khó: mỗi màu là một hàng xe riêng phải chờ đúng lượt, nên bàn 12 màu có
// nhiều cách kẹt hơn hẳn bàn 6 màu. Bộ tune vẫn phải đo, nhưng xuất phát từ bàn nhiều màu thì
// nó có chỗ để siết; bàn 5 màu ép xuống 10% gần như bất khả.
import fs from "node:fs";
import { readD, writeD } from "./genlib.mjs";

const d = readD();
const setC = JSON.parse(fs.readFileSync("scripts/_setC.json", "utf8"));
const HARD = setC.filter((r) => r.tier !== "easy").map((r) => r.s).sort((a, b) => a - b);

const info = setC.map((r) => {
  const L = d[r.to];
  const live = L.board.filter((v) => v >= 0 && v < 90);
  return { from: r.from, cols: new Set(live).size, cells: live.length, size: L.cols, board: L };
});
// Nhiều màu trước; hoà thì bàn to hơn trước (nhiều ô hơn = dài hơi hơn).
info.sort((a, b) => b.cols - a.cols || b.cells - a.cells);

// CHỦ ĐỀ của từng bàn, gán bằng mắt — không suy ra được từ dữ liệu bàn cờ.
// Cần vì lượt xếp theo màu để ba phương tiện rơi vào slot 29, 31, 32 (xe cứu thương, xe cảnh
// sát, tàu thuỷ) — user 2026-08-18: "có mấy level hình liên quan đến xe ấy, đặt hơi cạnh nhau".
const THEME = {
  81:"do-an", 192:"do-an", 171:"do-an", 182:"do-an", 73:"do-an", 256:"do-an", 52:"do-an", 142:"do-an",
  503:"con-vat", 176:"con-vat", 162:"con-vat", 502:"con-vat", 60:"con-vat", 251:"con-vat", 62:"con-vat",
  282:"xe-co", 268:"xe-co", 273:"xe-co", 395:"xe-co", 188:"xe-co",
  575:"cay-co", 111:"bau-troi", 492:"bau-troi", 61:"ngoai-troi",
  243:"cong-trinh", 109:"cong-trinh",
  252:"am-nhac", 79:"am-nhac",
  67:"do-vat", 223:"do-vat", 254:"do-vat", 168:"do-vat", 181:"do-vat",
};
const themeOf = (from) => THEME[from] || "khac";

const slots = setC.map((r) => r.s).sort((a, b) => a - b);
const easySlots = slots.filter((s) => !HARD.includes(s));
const assign = new Map();
HARD.forEach((s, i) => assign.set(s, info[i]));           // nhiều màu nhất -> slot khó
const rest = info.slice(HARD.length).reverse();            // còn lại: ít màu trước, nhiều màu sau
easySlots.forEach((s, i) => assign.set(s, rest[i]));

// RẢI CHỦ ĐỀ: đổi chỗ hai slot THƯỜNG khi làm bớt số cặp cùng chủ đề nằm gần nhau. Chỉ động
// vào slot thường — slot khó đã bị ràng buộc bởi số màu và không được đụng tới.
const GAP = Number(process.env.THEME_GAP || 4);
const clash = () => {
  let c = 0;
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
    if (slots[b] - slots[a] > GAP) break;
    if (themeOf(assign.get(slots[a]).from) === themeOf(assign.get(slots[b]).from)) c += GAP + 1 - (slots[b] - slots[a]);
  }
  return c;
};
let cur = clash();
const before = cur;
for (let pass = 0; pass < 400 && cur > 0; pass++) {
  let moved = false;
  for (const x of easySlots) for (const y of easySlots) {
    if (x >= y) continue;
    const a = assign.get(x), b = assign.get(y);
    assign.set(x, b); assign.set(y, a);
    const c2 = clash();
    if (c2 < cur) { cur = c2; moved = true; } else { assign.set(x, a); assign.set(y, b); }
  }
  if (!moved) break;
}
console.log(`rai chu de: diem dung ${before} -> ${cur} (cang thap cang thoang, GAP=${GAP})`);


console.log(`slot khó: ${HARD.join(", ")}`);
console.log("\nslot | target | tier      | ban goc | mau | co ban");
const out = [];
for (const s of slots) {
  const old = setC.find((r) => r.s === s);
  const c = assign.get(s);
  out.push({ s, from: c.from, to: old.to, target: old.target, tier: old.tier, board: c.board });
  console.log(`  ${String(s).padStart(2)} | ${String(old.target).padStart(6)} | ${old.tier.padEnd(9)} | `
    + `L${String(c.from).padEnd(6)}| ${String(c.cols).padStart(3)} | ${c.size}x${c.size} | ${themeOf(c.from)}`);
}
const hardCols = HARD.map((s) => assign.get(s).cols);
console.log(`\nslot khó nhận ${Math.min(...hardCols)}-${Math.max(...hardCols)} màu | slot thường ${Math.min(...easySlots.map((s) => assign.get(s).cols))}-${Math.max(...easySlots.map((s) => assign.get(s).cols))} màu`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
for (const r of out) d[r.to] = r.board;
writeD(d);
fs.writeFileSync("scripts/_setC.json", JSON.stringify(out.map(({ board, ...r }) => r), null, 1));
console.log("\nda xep lai va ghi designed.json + scripts/_setC.json");
