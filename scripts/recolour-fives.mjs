// Đưa tranh NHIỀU MÀU về các slot chia hết cho 5, để sau này còn làm level khó được.
//
// Vì sao: tranh ít màu thì các mảng liền khối rất to, và board như thế KHÔNG ÉP KHÓ ĐƯỢC —
// L90 (icecream, 6 màu, ba mảng 211/175/119 ô) quét 120 nấc vẫn không xuống dưới 79% dù
// target là 20%. Số màu là đòn bẩy độ khó mạnh hơn cả hàng xe ở hai đầu thang.
//
// Cách làm: HOÁN VỊ, không vứt tranh nào. Một slot ÷5 nghèo màu đổi chỗ với một slot thường
// giàu màu — cùng cỡ board (giữ nhịp 25/31) và không tạo ra trùng chủ đề ở cả hai đầu.
//
//   MIN=<số màu tối thiểu> node scripts/recolour-fives.mjs
import fs from "node:fs";
const D = "public/art/level art/emoji";
const MIN = Number(process.env.MIN || 7);
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const rows = JSON.parse(fs.readFileSync(`${D}/assign.json`, "utf8"));

const at = new Map(rows.map((r) => [r.lv, r]));
const colours = (n) => new Set(d[n].board.filter((v) => v >= 0 && v < 90)).size;
const themeOf = (n) => at.get(n)?.theme ?? "?";
const sizeOf = (n) => d[n].cols;

const lvs = rows.map((r) => r.lv).sort((a, b) => a - b);
const LO = lvs[0], HI = lvs[lvs.length - 1];
// đổi chỗ có tạo trùng chủ đề với hàng xóm không (bỏ qua chính hai ô đang đổi)
const clashes = (pos, theme, other) => {
  for (const nb of [pos - 1, pos + 1]) {
    if (nb < LO || nb > HI || nb === other) continue;
    if (themeOf(nb) === theme) return true;
  }
  return false;
};

const need = lvs.filter((n) => n % 5 === 0 && colours(n) < MIN).sort((a, b) => colours(a) - colours(b));
const donors = lvs.filter((n) => n % 5 !== 0 && colours(n) >= MIN);
const done = [];
for (const n of need) {
  const cand = donors
    .filter((m) => !done.some((x) => x.to === m) && sizeOf(m) === sizeOf(n))
    .filter((m) => !clashes(n, themeOf(m), m) && !clashes(m, themeOf(n), n))
    .sort((a, b) => colours(b) - colours(a));
  if (!cand.length) { console.log(`L${n}: KHÔNG tìm được bàn đổi`); continue; }
  const m = cand[0];
  const before = colours(n);
  [d[n], d[m]] = [d[m], d[n]];
  const rn = at.get(n), rm = at.get(m);
  const keep = { name: rn.name, theme: rn.theme, score: rn.score };
  Object.assign(rn, { name: rm.name, theme: rm.theme, score: rm.score });
  Object.assign(rm, keep);
  done.push({ n, m, before, after: colours(n) });
}
fs.writeFileSync("src/levels/designed.json", JSON.stringify(d, null, 2));
fs.writeFileSync(`${D}/assign.json`, JSON.stringify(rows, null, 1));
console.log(`đổi ${done.length} chỗ (mốc ≥${MIN} màu):`);
for (const x of done) console.log(`  L${x.n}: ${x.before} → ${x.after} màu   (đổi với L${x.m})`);
const left = lvs.filter((n) => n % 5 === 0 && colours(n) < MIN);
console.log(left.length ? `còn thiếu: ${left.map((n) => "L" + n).join(" ")}` : "mọi level ÷5 nay đều ≥" + MIN + " màu");
