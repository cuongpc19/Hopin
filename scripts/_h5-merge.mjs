// Gộp kết quả hai lượt quét dải ÷5 (user 2026-08-14, band 26-43) thành MỘT bộ nấc + MỘT bộ
// số đo ở n=200, để `_tuneAll.mjs --write` khỏi phải đo lại từ đầu.
//
//   node scripts/_h5-merge.mjs        → ghi _h5-rows.json (nấc) + _h5-pre.json (số đo)
//
// ⚠ VÌ SAO CÓ HAI LƯỢT. Lượt 1 chọn nấc bằng phép đo n=60 rồi mới đo lại n=200: 104/109 level
// đổi số, lệch tới 12 điểm CẢ HAI CHIỀU. Band 26-43 chỉ rộng 17 điểm nên nhiễu đó đủ để đá 28
// level ra ngoài dải — không phải vì ảnh xấu mà vì NẤC ĐƯỢC CHỌN TRÊN MỘT PHÉP ĐO ỒN. Lượt 2
// quét lại đúng 28 level ấy ở N_B=200, tức chọn nấc trên chính con số sẽ được báo cáo.
// Bài học chung: dải càng hẹp thì độ phân giải lúc CHỌN càng phải cao, không chỉ lúc BÁO.
import fs from "node:fs";

const rd = (re) => fs.readdirSync("scripts").filter((f) => re.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync("scripts/" + f, "utf8")));

const scan1 = rd(/^_h5-\d+\.json$/);                 // lượt 1: nấc chọn ở n=60
const fin1 = rd(/^_h5f-\d+\.json$/);                 // lượt 1: đo lại n=200
const scan2 = rd(/^_h5b-\d+\.json$/);                // lượt 2: nấc chọn Ở n=200 (b đã là n=200)
const scan3 = rd(/^_h5s-\d+\.json$/);                // lượt 3: 4 cặp vừa TRÁO ẢNH, cũng ở n=200

const rung = new Map(), pre = new Map();
for (const r of scan1) rung.set(r.n, r);
for (const r of fin1) pre.set(r.n, r.b);
for (const r of scan2) { rung.set(r.n, r); pre.set(r.n, r.b); } // lượt 2 đè lượt 1
// Lượt 3 đè tất cả: board của 4 level ÷5 ấy ĐÃ ĐỔI, nên nấc ở lượt 1/2 thuộc về một bàn không
// còn tồn tại. Kèm theo 4 level thường nhận ảnh cũ — chúng cũng phải có hàng xe mới.
for (const r of scan3) { rung.set(r.n, r); pre.set(r.n, r.b); }

// GIỮ NGUYÊN HÀNG XE CŨ (user 2026-08-14: "level 45,70,130 k cần làm khó hơn, bản cũ đủ khó
// rồi"). Đo lại bản cũ thì L45=42 và L130=39 vốn ĐÃ nằm trong dải mới 26-43; build lại chỉ đổi
// được 4 và 13 điểm nhưng phải thêm 13 và 8 xe — đi ngược luật "ít xe". L70 vượt trần 3 điểm
// nhưng user chốt là đủ khó.
const KEEP = new Set((process.env.KEEP_OLD || "45,70,130").split(",").map(Number).filter(Boolean));
for (const n of KEEP) { rung.delete(n); pre.delete(n); }

const rows = [...rung.values()].sort((a, b) => a.n - b.n);
fs.writeFileSync("scripts/_h5-rows.json", JSON.stringify(rows));
fs.writeFileSync("scripts/_h5-pre.json", JSON.stringify([...pre].map(([n, b]) => ({ n, b })).sort((a, b) => a.n - b.n)));

// Dải phải lấy THEO TỪNG LEVEL: sau bước tráo ảnh, danh sách này có cả level THƯỜNG (bàn nhận
// ảnh cũ) mà dải của chúng là 60-100. Hardcode 26-43 thì 4 bàn thường bị báo hụt oan.
const band = (n) => (n % 5 === 0 ? [26, 43] : [60, 100]);
const miss = rows.filter((r) => { const b = pre.get(r.n), [lo, hi] = band(r.n); return b < lo || b > hi; });
console.log(`${rows.length} level | lan 2 quet lai ${scan2.length} | con hut dai: ${miss.length}`);
if (miss.length) console.log("  " + miss.map((r) => `L${r.n}=${pre.get(r.n)}`).join("  "));
console.log("  MISS=" + miss.map((r) => r.n).join(","));
fs.writeFileSync("scripts/_h5-miss.txt", miss.map((r) => r.n).join(","));
