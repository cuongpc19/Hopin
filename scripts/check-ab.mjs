// KIỂM PHÉP THỬ A/B 15 MÀN ĐẦU — chạy sau mỗi lần đụng vào level ≤15.
//
//   node scripts/check-ab.mjs
//
// Trả lời ba câu, theo đúng thứ tự quan trọng:
//
// 1. NHÁNH A CÓ THẮNG ĐƯỢC KHÔNG. `check-seats.mjs` chỉ soi `designed.json`, nên bộ level của
//    nhánh A chưa từng đi qua bất biến ghế=ô. Một bàn lệch ghế là bàn KHÔNG THỂ THẮNG, và ở
//    đây nó còn tệ hơn bình thường: chỉ một nửa số người chơi gặp, nên nhìn bảng số sẽ ra
//    "nhánh A giữ người kém hơn" chứ không ra "nhánh A hỏng".
//
// 2. HAI NHÁNH ĐANG THẬT SỰ KHÁC NHAU Ở ĐÂU. Lúc chụp là 5 bàn (L2, L7, L9, L11, L15). Con số
//    này SẼ ĐỔI khi có đợt tune mới chạm vào L1-15 — và đó là điều cần biết, vì mỗi bàn đổi
//    thêm là một biến nữa trong phép thử. Đổi hết cả 15 bàn thì hai nhánh không còn so được
//    với nhau theo cách ban đầu định.
//
// 3. VÂN TAY. In `sig` của cả hai nhánh cho từng level, để đọc bảng winrate mà không cần tin
//    vào nhãn `ab` — dòng nào mang vân tay nào là nằm ở nhánh ấy, không cãi được.
import fs from "node:fs";
import { levelFingerprint } from "./genlib.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const cur = readJson("src/levels/designed.json");
const leg = readJson("src/levels/ab-legacy.json");
const isC = (v) => v >= 0 && v < 90;

// ---- 1. bất biến ghế = ô trên bộ level của nhánh A ------------------------------------------
// Cùng phép đếm với check-seats.mjs: ô lớp 2 cộng vào tổng ô (clearCell đôn nó lên board), xe
// hammer/wood không mang màu nên không tính.
let broken = 0;
for (const k of Object.keys(leg)) {
  const L = leg[k];
  const need = {}, have = {};
  for (const v of L.board) if (isC(v)) need[v] = (need[v] ?? 0) + 1;
  if (L.layer2) for (const v of L.layer2) if (isC(v)) need[v] = (need[v] ?? 0) + 1;
  for (const c of L.chests) if ((c.kind ?? "color") === "color") have[c.color] = (have[c.color] ?? 0) + c.count;
  const bad = [];
  for (const id of new Set([...Object.keys(need), ...Object.keys(have)]))
    if ((need[id] ?? 0) !== (have[id] ?? 0)) bad.push(`id${id}: ô=${need[id] ?? 0} ghế=${have[id] ?? 0}`);
  if (bad.length) { broken++; console.log(`✗ L${k} HỎNG — ${bad.join(" · ")}`); }
}
console.log(broken ? `\n${broken} level nhánh A không thể thắng. SỬA TRƯỚC KHI CHẠY PHÉP THỬ.\n`
  : `Bất biến ghế=ô: ${Object.keys(leg).length}/${Object.keys(leg).length} level nhánh A sạch.\n`);

// ---- 2 + 3. khác nhau ở đâu, vân tay nào ----------------------------------------------------
const nums = Object.keys(leg).map(Number).sort((a, b) => a - b);
const diff = [];
console.log("lv  | tranh     | hàng xe        | sig A (launch) | sig B (hiện tại)");
for (const n of nums) {
  const a = leg[n], b = cur[n];
  if (!b) { console.log(`L${n} | (designed.json KHÔNG có level này)`); continue; }
  const sameBoard = JSON.stringify(a.board) === JSON.stringify(b.board) && a.cols === b.cols && a.rows === b.rows;
  const sameCars = JSON.stringify(a.chests) === JSON.stringify(b.chests);
  if (!sameBoard || !sameCars) diff.push(n);
  const sa = levelFingerprint(a), sb = levelFingerprint(b);
  console.log(
    `L${String(n).padEnd(3)}| ${(sameBoard ? "giống" : "KHÁC").padEnd(10)}| ` +
    `${(sameCars ? "giống" : `KHÁC ${a.chests.length}→${b.chests.length} xe`).padEnd(15)}| ` +
    `${sa.padEnd(15)}| ${sb}${sa === sb ? "  (trùng — level này không phân biệt được hai nhánh)" : ""}`,
  );
}
console.log(
  `\n${diff.length}/${nums.length} level thật sự khác nhau: ${diff.length ? "L" + diff.join(", L") : "KHÔNG CÓ"}.`,
);
if (!diff.length) console.log("⚠ Hai nhánh đang giống hệt nhau — phép thử không đo được gì.");
