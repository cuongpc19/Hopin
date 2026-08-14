// SÀNG kho ảnh dự phòng: bàn nào ép xuống dải khó được, bàn nào không (đo nấc khó nhất, một phép đo/bàn).
//
// Phép thử: dựng đúng NẤC KHÓ NHẤT của thang (xe nhỏ, wave dài, áp lực cao) rồi đo B một lần.
// Nấc khó nhất còn đọc trên 50 thì bàn đó không bao giờ làm được level chia hết cho 5 — đó là
// tính chất của bức tranh (LEVEL-DESIGN §7: màu vỡ vụn thì có trần, đổi hàng xe không cứu nổi).
// Ngược lại nấc khó nhất đọc dưới 30 thì bàn quá gắt, cũng loại.
import fs from "node:fs";
import { measure2 } from "./simcore2.mjs";
import { build } from "./gen-design.mjs";

const spare = JSON.parse(fs.readFileSync("scripts/_spare.json", "utf8"));
const SHARD = Number(process.env.SHARD || 0), NSHARD = Number(process.env.NSHARD || 1);
const NB = Number(process.env.N_B || 60);
const HARD = { cap: 30, wave: 5, pressure: 0.3, lay: 0, minCar: 22 };
const EASY = { cap: 130, wave: 1, pressure: 0, lay: 0, minCar: 40 };
const mine = spare.filter((_, i) => i % NSHARD === SHARD);
const out = [];
for (const s of mine) {
  let hard = null, easy = null;
  try { hard = measure2(build(s.level, 100, HARD), NB); } catch { /* bàn hỏng thì bỏ */ }
  // chỉ đo nấc dễ cho những bàn đã qua cửa khó — dùng để biết bàn còn kéo lên nổi dải thường không
  if (hard != null && hard <= 55) { try { easy = measure2(build(s.level, 101, EASY), NB); } catch { /* kệ */ } }
  out.push({ name: s.name, theme: s.theme, size: s.size, colours: s.colours, score: s.score, hard, easy });
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out));
}
if (!process.env.OUT) console.log(JSON.stringify(out));
