// check-gate — phân biệt "level siêu khó" với "level KHÔNG THỂ THẮNG".
//
// Vì sao cần: một level đọc 5% có thể là hai thứ hoàn toàn khác nhau —
//   • khó thật: có đường thắng, người chơi giỏi/may thì qua  → đúng thứ level cổng cần
//   • bất khả thi: không tồn tại đường thắng nào             → user chơi mãi không qua, nghĩ game lỗi
// Thước winrate thường không tách được: cả hai đều đọc ~0-5%.
//
// ⚠ ĐỪNG dùng `SKILL=1` làm "người chơi hoàn hảo" — đó là bẫy tôi đã sập ngày 2026-08-08.
// Ở build-levels.mjs:1072 nhiệt độ chọn là `TEMP·(1-skill)·LOAD`, nên skill=1 làm bot chơi
// TẤT ĐỊNH: mọi ván đi đúng một đường, đường đó thua thì đọc 0%. Đo thật: L30 ra 51% ở
// skill 0.75 nhưng 0% ở skill 1.0 — cao hơn mà tệ hơn, vì hết ngẫu nhiên để dò đường.
//
// Cách đúng: TÌM NHÂN CHỨNG. Chỉ cần MỘT ván thắng trong vài nghìn lượt mô phỏng là đã
// chứng minh đường thắng tồn tại. Không tìm thấy thì không chứng minh được điều ngược lại,
// nên báo cáo là "nghi ngờ", không phải "bất khả thi".
//
// Đây là bài học L11/L16/L51 ở dạng khác: ba level đó không thể thắng suốt thời gian dài mà
// không ai biết. check-seats.mjs bắt lỗi số ghế; cái này bắt lỗi không có đường thắng.
//
//   node scripts/check-gate.mjs 30 34 35
import { readD } from "./genlib.mjs";
import { measureDBatch, blend } from "./calib.mjs";
import { measure2 } from "./simcore2.mjs";
import { lossProfile } from "./design-core.mjs";

// Dải skill để dò. Skill thấp = nhiều ngẫu nhiên = dò được nhiều đường khác nhau, nên nó
// tìm nhân chứng TỐT HƠN skill cao, ngược với trực giác (xem ghi chú tất định ở trên).
const SKILLS = (process.env.SKILLS || "0.5,0.65,0.75,0.85").split(",").map(Number);
const TRIALS = Number(process.env.TRIALS ?? 200);
const N_B = Number(process.env.N_B ?? 400);

const ns = process.argv.slice(2).map(Number).filter(Boolean);
if (!ns.length) {
  console.error("dung: node scripts/check-gate.mjs 30 34 35");
  process.exit(1);
}

const d = readD();
const Ls = ns.map((n) => d[n]);
ns.forEach((n, i) => {
  if (!Ls[i]) {
    console.error(`L${n}: khong co trong designed.json`);
    process.exit(1);
  }
});

// Mô hình B — bộ mô phỏng khác hẳn, nên một ván thắng ở đây cũng là nhân chứng hợp lệ.
const bWin = Ls.map((L) => measure2(L, N_B));

// Mô hình D ở nhiều mức skill; giữ mức tốt nhất.
const dRuns = SKILLS.map((s) => measureDBatch(Ls, { skill: s, trials: TRIALS, tag: "g" + String(s).replace(".", "") }));

console.log(`nhan chung: B ${N_B} luot + D ${TRIALS} luot x skill ${SKILLS.join("/")}\n`);
console.log("lv  | B    | " + SKILLS.map((s) => `D@${s}`.padStart(6)).join(" | ") + " | thua@    | ket luan");

let suspect = 0;
ns.forEach((n, i) => {
  const dCells = dRuns.map((r) => r[i] ?? 0);
  const best = Math.max(bWin[i], ...dCells);
  const lp = lossProfile(Ls[i], 40);
  const witness = best > 0;
  if (!witness) suspect++;
  // Thua sớm đọc ra là "level hỏng" chứ không phải "level khó" (LEVEL-DESIGN.md §4) —
  // cảnh báo riêng, kể cả khi level thừa sức thắng được.
  const early = lp.lossAt < 25 ? "  ⚠ thua qua som" : "";
  console.log(
    `L${String(n).padEnd(3)}| ${String(bWin[i]).padStart(3)}% | ` +
      dCells.map((v) => `${String(v).padStart(5)}%`).join(" | ") +
      ` | ${String(Math.round(lp.lossAt)).padStart(3)}% ban | ` +
      (witness ? `KHO — co duong thang (tot nhat ${best}%)` : "NGHI NGO — khong tim ra van thang nao") +
      early,
  );
});

console.log(
  "\nthuoc da hieu chuan (D@0.75, tham khao): " +
    ns.map((n, i) => `L${n}=${blend(bWin[i], dRuns[SKILLS.indexOf(0.75)]?.[i] ?? bWin[i])}%`).join(" · "),
);
if (suspect) console.log(`\n${suspect} level khong tim ra nhan chung — KHONG chung minh duoc la bat kha thi, nhung dung ship truoc khi soi tay.`);
process.exit(suspect ? 1 : 0);
