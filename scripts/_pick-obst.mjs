// Chọn hai bộ level RỜI NHAU trong một dải để thêm ĐÁ và thêm SOCOLA (user 2026-08-15: "từ
// level 200-400: lấy 5% level trong nhóm này rồi thêm slime đá... lấy 5% level trong nhóm này
// rồi thêm socola", cả hai target winrate 30-60%).
//
//   node scripts/_pick-obst.mjs
//   RANGE=200-400 PCT=5 SEED=20260815 node scripts/_pick-obst.mjs
//
// CHỈ IN RA, không đụng vào designed.json. Hai dòng cuối là biến ONLY= để đưa thẳng sang
// _rocks-random.mjs và _choco-corners.mjs.
//
// VÌ SAO TÁCH RA MỘT FILE RIÊNG thay vì để mỗi script tự bốc: hai script bốc riêng thì không có
// gì ngăn chúng trúng cùng một level, mà một level vừa đá vừa socola thì hai chướng ngại chồng
// lên nhau và cái target 30-60% chung cho cả hai bộ mất nghĩa. Bốc một lần ở đây thì rời nhau
// theo cấu trúc, không phải nhờ may.
//
// PHẦN TRĂM TÍNH TRÊN CẢ DẢI, không phải trên pool đủ điều kiện: user nói "5% level trong nhóm
// này", nhóm là L200-400 = 201 level → 10 level mỗi bộ. Tính trên pool (160 level thường) sẽ ra
// 8, ít hơn cái user hình dung.
import { readD, mkRng } from "./genlib.mjs";

const [R0, R1] = (process.env.RANGE || "200-400").split("-").map(Number);
const PCT = Number(process.env.PCT || 5);
const SEED = Number(process.env.SEED || 20260815);
const d = readD();

// Level THƯỜNG (không ÷5) — level ÷5 đã được tune vào dải khó 26-43, chồng thêm chướng ngại lên
// đó là phá cái thang khó đã dựng. Bỏ luôn level đã có sẵn đá hoặc socola.
const pool = [];
for (let n = R0; n <= R1; n++) {
  const L = d[n];
  if (!L?.board || n % 5 === 0) continue;
  if (L.board.some((v) => v >= 90) || L.boxes?.length) continue;
  pool.push(n);
}

const want = Math.round(((R1 - R0 + 1) * PCT) / 100);
const rng = mkRng(SEED);
const bag = pool.slice();
for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }

const rocks = bag.slice(0, want).sort((a, b) => a - b);
const choco = bag.slice(want, want * 2).sort((a, b) => a - b);

const size = (n) => `${d[n].cols}x${d[n].rows}`;
console.log(`dai L${R0}-${R1} | ${pool.length} level thuong du dieu kien | ${PCT}% cua ${R1 - R0 + 1} = ${want} level moi bo\n`);
console.log("DA    :", rocks.map((n) => `L${n}(${size(n)})`).join(" "));
console.log("SOCOLA:", choco.map((n) => `L${n}(${size(n)})`).join(" "));
const clash = rocks.filter((n) => choco.includes(n));
console.log(`\ntrung nhau: ${clash.length ? clash.join(",") + " — LOI" : "khong"}`);
console.log(`\nONLY=${rocks.join(",")} WRITE=1 node scripts/_rocks-random.mjs`);
console.log(`ONLY=${choco.join(",")} WRITE=1 node scripts/_choco-corners.mjs`);
console.log(`ONLY=${rocks.concat(choco).sort((a, b) => a - b).join(",")} FORCE=30-60 ... scan-shards.mjs`);
