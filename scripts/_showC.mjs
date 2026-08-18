// XEM THIẾT KẾ một hoặc nhiều level TRƯỚC KHI TUNE — in hàng xe + vẽ bàn ra ảnh.
//
//   SLOT=2,8,15 node scripts/_showC.mjs            # theo slot của bộ C
//   LV=9101,9114 node scripts/_showC.mjs           # theo số bàn bất kỳ
//   SLOT=all OUT=/tmp/all.png node scripts/_showC.mjs
//
// Env: SLOT | LV · RUNG ("cap,wave,pressure,lay,minCar", mặc định 95,2,0.15,0,22) · OUT.
//
// ⚠ ĐÂY LÀ BẢN DỰNG THỬ Ở MỘT NẤC THANG, KHÔNG PHẢI BẢN CUỐI. Lượt tune sẽ thử tới 240 nấc rồi
// chọn nấc khớp target, nên số xe / sức chứa / lớp-2 sẽ khác. Bàn cờ thì KHÔNG đổi — cái nhìn
// được ở đây là hình vẽ và cấu trúc, không phải con số cuối cùng.
import fs from "node:fs";
import { readD } from "./genlib.mjs";
import { buildX, cfg } from "./_tuneAll.mjs";

const NAME = ["đỏ","cam","vàng","lục","ngọc","lam","tím","hồng","trắng","xám-nhạt","xám-đậm",
  "nâu","đen","lam-đậm","be","xanh-nhạt","lục-đậm","hồng-nhạt","đỏ-đậm"];
const d = readD();
const setC = (() => { try { return JSON.parse(fs.readFileSync("scripts/_setC.json", "utf8")); } catch { return []; } })();
const [cap, wave, pressure, lay, minCar] = (process.env.RUNG || "95,2,0.15,0,22").split(",").map(Number);
const rung = { cap, wave, pressure, lay, minCar, hid: 0 };

let list;
if (process.env.LV) list = process.env.LV.split(",").map(Number).map((n) => ({ to: n, s: null }));
else {
  const want = process.env.SLOT === "all" ? null : (process.env.SLOT || "2,8,15,30").split(",").map(Number);
  list = setC.filter((r) => !want || want.includes(r.s));
}
if (!list.length) { console.log("khong co level nao — dat SLOT= hoac LV="); process.exit(1); }

for (const r of list) {
  const src = d[r.to];
  if (!src) { console.log(`L${r.to}: khong co ban`); continue; }
  const L = buildX(src, r.to, rung);
  const c = cfg(r.to);
  const pairs = new Set(L.chests.filter((x) => x.pairId != null).map((x) => x.pairId)).size;
  const buried = L.chests.filter((x) => x.buried).length;
  const lay2 = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  const cells = L.board.filter((v) => v >= 0 && v < 90).length;
  const head = r.s ? `SLOT ${r.s} (L${r.to}, bàn gốc L${r.from})` : `L${r.to}`;
  console.log(`\n=== ${head} — ${L.cols}x${L.rows}, ${cells} ô, ${new Set(L.board.filter((v) => v >= 0 && v < 90)).size} màu`);
  console.log(`    target ${c.lo}-${c.hi}%  |  ${L.chests.length} xe  |  ${pairs} cặp xe đôi  |  ${buried} xe chôn  |  lớp-2 ${lay2} ô`);
  let line = "    ";
  L.chests.forEach((x, i) => {
    line += `${i + 1}.${NAME[x.color] ?? x.color}×${x.count}${x.pairId != null ? "*" : ""}${x.buried ? "?" : ""}  `;
    if ((i + 1) % 5 === 0) { console.log(line); line = "    "; }
  });
  if (line.trim()) console.log(line);
}
console.log("\n* = xe đôi   ? = xe chôn");
if (process.env.OUT) {
  const lv = list.map((r) => r.to).join(",");
  console.log(`\nvẽ bàn:  LV=${lv} OUT=${process.env.OUT} node scripts/_sheetC.mjs`);
}
