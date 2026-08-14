// THAY ẢNH cho level không ép được về dải, hai chiều, rồi để _tuneAll dựng lại hàng xe.
//
// Hai chiều thay, vì hai nhóm trượt ngược nhau:
//   • slot chia hết cho 5 mà trần vẫn > 50  → cần tranh ép khó ĐƯỢC (nấc khó nhất 15-50)
//   • slot thường mà trần vẫn < 60          → cần tranh dễ (nấc khó nhất > 50, tức không gắt)
// Danh sách ứng viên lấy từ _screen.mjs; chọn theo điểm đẹp, tránh trùng chủ đề với hai level
// kề bên, và ưu tiên GIỮ NGUYÊN CỠ BÀN của slot để không phá nhịp cỡ mà emoji-assign đã xếp.
import fs from "node:fs";

const D = "public/art/level art/emoji";
const HARD_SLOTS = (process.env.HARD || "").split(",").filter(Boolean).map(Number);
const EASY_SLOTS = (process.env.EASY || "").split(",").filter(Boolean).map(Number);
const screened = JSON.parse(fs.readFileSync("scripts/_screened.json", "utf8"));
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const assign = JSON.parse(fs.readFileSync(`${D}/assign.json`, "utf8"));
const themeAt = {};
for (const r of assign) themeAt[r.lv] = r.theme;

// nạp lại board thật của từng ứng viên (bảng sàng chỉ giữ tên)
const pool = {};
for (const f of fs.readdirSync(D)) {
  if (!f.endsWith(".json") || ["assign.json", "probe-report.json", "good.json"].includes(f)) continue;
  let p; try { p = JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8")); } catch { continue; }
  for (const v of Object.values(p)) if (v?.level?.board) pool[`${v.name}@${v.size}`] = v;
}

const canHard = screened.filter((x) => x.hard != null && x.hard >= 15 && x.hard <= 50);
// Sàn 6 màu cho slot thường: bàn 4 màu dựng được nhưng nhìn ra một mảng phẳng (bộ chọn ảnh đã
// đặt MINCOL=5 vì đúng lý do đó), mà điểm đẹp lại không phạt chuyện ấy nên nó vẫn trồi lên đầu.
const canEasy = screened.filter((x) => x.hard != null && x.hard > 55 && x.colours >= 6);
const taken = new Set();

function pick(list, slot, wantSize) {
  const bad = new Set([themeAt[slot - 1], themeAt[slot + 1]].filter(Boolean));
  const ok = list.filter((x) => !taken.has(x.name + "@" + x.size) && pool[x.name + "@" + x.size]);
  const rank = (x) => (x.size === wantSize ? 0 : 40) + (bad.has(x.theme) ? 25 : 0) - x.score;
  const best = ok.slice().sort((a, b) => rank(a) - rank(b))[0];
  if (best) taken.add(best.name + "@" + best.size);
  return best;
}

const log = [];
for (const [slots, list, kind] of [[HARD_SLOTS, canHard, "kho"], [EASY_SLOTS, canEasy, "de"]]) {
  for (const lv of slots) {
    const cur = d[lv];
    const p = pick(list, lv, cur.cols);
    if (!p) { log.push(`L${lv}: KHONG CON UNG VIEN ${kind}`); continue; }
    const rec = pool[p.name + "@" + p.size];
    const old = assign.find((r) => r.lv === lv);
    log.push(`L${lv}  ${old ? old.name : "?"}@${cur.cols} -> ${p.name}@${p.size}  (${p.colours} mau, nac kho nhat ${p.hard}, diem ${p.score.toFixed(0)})`);
    d[lv] = JSON.parse(JSON.stringify(rec.level));
    if (old) { old.name = p.name; old.theme = p.theme; old.size = p.size; old.colours = p.colours; old.score = p.score; }
  }
}
console.log(log.join("\n"));
if (process.env.DRY === "1") { console.log("\nDRY=1 — khong ghi"); process.exit(0); }
fs.writeFileSync("src/levels/designed.json", JSON.stringify(d, null, 2));
fs.writeFileSync(`${D}/assign.json`, JSON.stringify(assign, null, 1));
console.log(`\nda thay ${log.filter((l) => l.includes("->")).length} anh`);
