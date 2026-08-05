// BẤT BIẾN GHẾ = Ô: mỗi màu, tổng sức chứa xe phải bằng ĐÚNG số ô của màu đó (kể cả lớp 2).
// Xe chỉ rời bay khi ĐẦY 100%, nên lệch một ô là level không thể thắng.
import { readD, isC } from "./genlib.mjs";

const d = readD();
let bad = 0;
for (const n of Object.keys(d).map(Number).sort((a, b) => a - b)) {
  const L = d[n];
  if (!L?.board || !L?.chests) continue;
  const cells = {}, seats = {};
  for (const v of L.board) if (isC(v)) cells[v] = (cells[v] || 0) + 1;
  if (L.layer2) for (const v of L.layer2) if (v >= 0) cells[v] = (cells[v] || 0) + 1;
  for (const c of L.chests) seats[c.color] = (seats[c.color] || 0) + (c.count || 0);
  const ids = [...new Set([...Object.keys(cells), ...Object.keys(seats)])];
  const err = ids.filter((c) => (cells[c] || 0) !== (seats[c] || 0));
  if (err.length) {
    bad++;
    console.log(`L${n} HONG: ` + err.map((c) => `id${c} o=${cells[c] || 0} ghe=${seats[c] || 0}`).join(", "));
  }
}
console.log(bad ? `\n${bad} level hong bat bien` : "OK — moi level: ghe = o");
process.exit(bad ? 1 : 0);
