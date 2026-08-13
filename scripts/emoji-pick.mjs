// BƯỚC 3 của bộ dựng level từ emoji — CHỌN RA MỘT BỘ ẢNH SẠCH TRÙNG.
//   POOL=pool6.json TAKE=300 RICH=0.2 node scripts/emoji-pick.mjs
//
// Đọc một pool vừa dựng (emoji-pool.mjs), loại mọi bàn trùng với ẢNH ĐANG DÙNG trong game
// và với các pool CŨ, rồi chọn ra TAKE bàn: ưu tiên cỡ to, đủ tỉ lệ bàn nhiều màu, rải đều
// chủ đề. Ghi <POOL-tên>-pick.json + bảng liệt kê.
//
// ⚠ VÌ SAO PHẢI CÓ FILE NÀY. Bộ lọc trùng đã sai BA LẦN (2026-08-12):
//   1. Lọc theo TÊN không đủ: 46 mã emoji mang nhiều tên khác nhau giữa các file ứng viên
//      (drum / drum2 / drum3 đều là 1f941) → hai "chủ thể" khác tên mà cùng một bức ảnh.
//   2. So chữ ký board vỡ trên level CÓ ĐÁ: đá ghi đè lên một ô màu nên mảng khác nhau.
//      Che đá thành -9 cũng sai, vì bên pool ô đó vẫn là màu. Cách đúng: BỎ QUA đúng những
//      vị trí ấy ở CẢ HAI phía (xem match()).
//   3. Trùng KHÔNG-Y-HỆT vẫn lọt: hai mặt đồng hồ khác giờ, hai biển cảnh báo khác ký hiệu
//      → chữ ký khác nhau vài ô nhưng nhìn là một. Nên có thêm ngưỡng GIỐNG NHAU (SIM).
import fs from "node:fs";
import { readD } from "./genlib.mjs";

const D = "public/art/level art/emoji";
const POOL = process.env.POOL || "pool6.json"; // nhiều pool: ngăn bằng dấu phẩy
const POOLS = POOL.split(",").map((s) => s.trim()).filter(Boolean);
const TAKE = Number(process.env.TAKE || 300);
const RICH_FRAC = Number(process.env.RICH || 0.2); // tỉ lệ bàn phải có > RICH_MIN màu
const RICH_MIN = Number(process.env.RICHMIN || 10);
// Ngưỡng GIỐNG NHAU. Đo 2026-08-13 trên 8 biển cấm vòng đỏ (nosmoking / nobicycles / …):
// chúng giống nhau 78-88.5%, nên 0.92 để lọt cả 8 vào một lô — đúng kiểu "trùng ảnh" mà mắt
// thấy ngay còn chữ ký board thì không. 0.86 cắt được phần lớn họ đó.
const SIM = Number(process.env.SIM || 0.86);
// Sàn số màu. Bàn ≤4 màu ra hình quá trống (cái cửa = một hình chữ nhật nâu, quả trứng = một
// vệt be) — dựng được nhưng không đáng làm level.
const MINCOL = Number(process.env.MINCOL || 5);
const SIZES = (process.env.SIZES || "35,31").split(",").map(Number); // thứ tự ƯU TIÊN

const pool = {};
for (const f of POOLS) Object.assign(pool, JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8")));

// ---- mọi bàn ĐÃ TỒN TẠI: level trong game + mọi pool cũ ------------------------------------
const olds = [];
const d = readD();
for (const L of Object.values(d)) if (L?.board) olds.push(L.board);
for (const f of fs.readdirSync(D)) {
  if (!f.endsWith(".json") || POOLS.includes(f) || f === "assign.json" || f === "probe-report.json") continue;
  if (f.endsWith("-pick.json")) continue; // ket qua cua chinh buoc nay
  let p; try { p = JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8")); } catch { continue; }
  for (const v of Object.values(p)) if (v?.level?.board) olds.push(v.level.board);
}

// Ô ≥90 là ĐÁ: nó ĐÈ LÊN một ô màu nên hai bên không thể khớp ở đó — bỏ qua vị trí ấy ở cả
// hai phía. Trả về TỈ LỆ ô khớp trên số ô so được (không phải true/false), để bắt cả bản
// "gần y hệt" chứ không chỉ bản trùng khít.
const sim = (a, b) => {
  if (a.length !== b.length) return 0;
  let same = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= 90 || b[i] >= 90) continue;
    n++; if (a[i] === b[i]) same++;
  }
  return n ? same / n : 0;
};
const clashesOld = (board) => olds.some((o) => sim(o, board) >= SIM);

// ---- gom theo chủ thể, giữ bản ở cỡ được ưu tiên -------------------------------------------
const subj = new Map();
for (const v of Object.values(pool)) {
  if (!SIZES.includes(v.size)) continue;
  const o = subj.get(v.name) ?? { name: v.name, theme: v.theme, byS: new Map() };
  o.byS.set(v.size, v);
  subj.set(v.name, o);
}

const rejOld = [], rejSelf = [], rejThin = [], cands = [];
for (const o of [...subj.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  // Trong cùng một chủ thể, lấy bản ở cỡ ưu tiên cao nhất mà dựng được.
  let rec = null;
  for (const s of SIZES) if (o.byS.has(s)) { rec = o.byS.get(s); break; }
  if (!rec) continue;
  if (rec.colours < MINCOL) { rejThin.push(`${o.name}(${rec.colours})`); continue; }
  if (clashesOld(rec.level.board)) { rejOld.push(o.name); continue; }
  cands.push({ ...o, rec });
}
// Trùng LẪN NHAU trong chính lô mới (hai emoji khác nhau ra gần cùng một bức). Giữ bản ĐẸP
// hơn: duyệt theo điểm giảm dần thì bản vào trước luôn là bản tốt hơn của cả họ.
const fresh = [];
for (const c of [...cands].sort((a, b) => b.rec.score - a.rec.score)) {
  if (fresh.some((f) => sim(f.rec.level.board, c.rec.level.board) >= SIM)) { rejSelf.push(c.name); continue; }
  fresh.push(c);
}

// ---- chọn TAKE bàn: đủ quota nhiều màu trước, rồi rải chủ đề, trong nhóm thì đẹp trước ----
const rich = fresh.filter((c) => c.rec.colours > RICH_MIN).sort((a, b) => b.rec.score - a.rec.score);
const plain = fresh.filter((c) => c.rec.colours <= RICH_MIN).sort((a, b) => b.rec.score - a.rec.score);
const needRich = Math.ceil(TAKE * RICH_FRAC);

// Rải chủ đề = duyệt vòng tròn qua các chủ đề, mỗi vòng lấy một bàn của mỗi chủ đề, nên
// không có chủ đề nào chiếm hết chỗ trước khi chủ đề khác được xét.
const roundRobin = (list, n) => {
  const byT = new Map();
  for (const c of list) { if (!byT.has(c.theme)) byT.set(c.theme, []); byT.get(c.theme).push(c); }
  const out = [], keys = [...byT.keys()];
  while (out.length < n) {
    let moved = false;
    for (const k of keys) { const q = byT.get(k); if (!q.length) continue;
      out.push(q.shift()); moved = true; if (out.length >= n) break; }
    if (!moved) break;
  }
  return out;
};

const pickRich = roundRobin(rich, Math.min(needRich, rich.length));
const takenR = new Set(pickRich.map((c) => c.name));
const rest = [...rich.filter((c) => !takenR.has(c.name)), ...plain];
const pickRest = roundRobin(rest, Math.max(0, TAKE - pickRich.length));
const picked = [...pickRich, ...pickRest];

// ---- ghi ra ------------------------------------------------------------------------------
const out = {};
for (const c of picked) out[`${c.name}@${c.rec.size}`] = c.rec;
const base = POOLS[0].replace(/\.json$/, "");
fs.writeFileSync(`${D}/${base}-pick.json`, JSON.stringify(out));
const table = picked.map((c) => ({ name: c.name, theme: c.theme, size: c.rec.size, colours: c.rec.colours, score: c.rec.score }));
fs.writeFileSync(`${D}/${base}-pick.txt`,
  table.map((t) => `${t.name.padEnd(24)}${t.theme.padEnd(12)}${t.size}  ${String(t.colours).padStart(2)} mau  diem ${t.score}`).join("\n") + "\n");

const bySize = {}, byCol = {}, byTheme = {};
table.forEach((t) => { bySize[t.size] = (bySize[t.size] || 0) + 1; byCol[t.colours] = (byCol[t.colours] || 0) + 1; byTheme[t.theme] = (byTheme[t.theme] || 0) + 1; });
console.log(`pool ${POOLS.join("+")}: ${subj.size} chu the dung duoc o co ${SIZES.join("/")}`);
console.log(`  loai vi QUA IT MAU (<${MINCOL}): ${rejThin.length}${rejThin.length ? "  (" + rejThin.slice(0, 10).join(",") + (rejThin.length > 10 ? ",..." : "") + ")" : ""}`);
console.log(`  loai vi TRUNG anh cu : ${rejOld.length}${rejOld.length ? "  (" + rejOld.slice(0, 12).join(",") + (rejOld.length > 12 ? ",..." : "") + ")" : ""}`);
console.log(`  loai vi TRUNG lan nhau: ${rejSelf.length}${rejSelf.length ? "  (" + rejSelf.slice(0, 12).join(",") + (rejSelf.length > 12 ? ",..." : "") + ")" : ""}`);
console.log(`  con sach: ${fresh.length}  ->  CHON ${picked.length}/${TAKE}`);
console.log(`co ban : ${Object.entries(bySize).map(([k, v]) => k + "x" + k + ":" + v).join("  ")}`);
console.log(`so mau : ${Object.keys(byCol).sort((a, b) => a - b).map((k) => k + ":" + byCol[k]).join("  ")}`);
const richN = table.filter((t) => t.colours > RICH_MIN).length;
console.log(`> ${RICH_MIN} mau: ${richN}/${picked.length} = ${(100 * richN / Math.max(1, picked.length)).toFixed(0)}%  (yeu cau ${Math.round(RICH_FRAC * 100)}%)`);
console.log(`chu de : ${Object.entries(byTheme).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ":" + v).join("  ")}`);
console.log(`\nghi ${base}-pick.json + ${base}-pick.txt`);
