// _tuneAll — dựng lại hàng xe cho TOÀN BỘ level từ L36 (user 2026-08-13, bản rút gọn).
//
// Mốc user đặt — CHỈ mô hình B, không dùng D:
//   • chia hết cho 5   → B trong 30-50
//   • còn lại          → B trong 60-100
//   • %5 từ L40: một nửa số level dùng lớp-2
//   • %15 từ L40: ~5% slime là "?" (cụm CÙNG MỘT MÀU, nằm cạnh nhau)
//
// Vì sao nhanh hơn bản trước: dải rộng cho phép DỪNG SỚM. Thang được dựng trước (8ms/nấc,
// không phải đo) rồi xếp theo SỐ XE TĂNG DẦN; đo từ nấc ít xe nhất đi lên và dừng khi đã có
// 3 nấc lọt dải. Nhờ vậy tiêu chí "ít xe" là hệ quả của thứ tự đi, không phải một hàm chấm
// điểm chạy sau, và phần lớn level thường trúng ngay nấc đầu.
//
//   node scripts/_tuneAll.mjs --scan (SHARD/NSHARD, OUT=file)   → nấc đã chọn cho từng level
//   node scripts/_tuneAll.mjs --write p-*.json                   → đo lại n=200 rồi GHI
import fs from "node:fs";
import { readD, writeD, isC, mkRng } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { lossProfile, positionPenalty } from "./design-core.mjs";
import { build } from "./gen-design.mjs";

const N_B = Number(process.env.N_B || 60);
const d = readD();
const [R0, R1] = (process.env.RANGE || "36-286").split("-").map(Number);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
// FIVESONLY=1 — chỉ những level ÷5. Dùng khi CHỈ dải ÷5 đổi target: dựng lại level thường
// với đúng dải cũ chỉ tốn giờ mà ra lại gần như cùng một nấc.
const FIVESONLY = process.env.FIVESONLY === "1";
export const ALL = Object.keys(d).map(Number)
  .filter((n) => n >= R0 && n <= R1 && (!ONLY || ONLY.has(n)) && (!FIVESONLY || n % 5 === 0))
  .sort((a, b) => a - b);
// ⚠ TÍNH TRÊN TOÀN BỘ LEVEL, KHÔNG PHẢI TRÊN `ALL`. Lấy theo `ALL` thì bốc "một nửa" phụ thuộc
// vào RANGE của lần chạy: chạy lại một level lẻ (RANGE=90-90) làm pool chỉ còn 1 phần tử và
// round(1/2)=1 → level nào chạy riêng cũng bị ép có lớp-2. Đã dính đúng lỗi này: 9 level
// (50,75,90,100,115,185,240,250,285) mọc lớp-2 ngoài ý muốn, thành 34/50 thay vì 25/50.
const FIVES = Object.keys(d).map(Number).filter((n) => n % 5 === 0 && n >= 36).sort((a, b) => a - b);

// ---- lớp-2: đúng một nửa số level %5 từ L40 (user: "tỷ lệ 50%") --------------------------
const LAY_SET = (() => {
  const pool = FIVES.filter((n) => n >= 40);
  const rng = mkRng(20260813);
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return new Set(idx.slice(0, Math.round(pool.length / 2)).map((i) => pool[i]));
})();

// User 2026-08-14: "các level chia hết cho 5 có độ khó tăng 15%", áp dụng TỪ L41 TRỞ ĐI.
// Chốt hiểu theo nghĩa TƯƠNG ĐỐI trên chính con số winrate: 30-50 × 0.85 = 26-43 (user chọn,
// giữa ba cách hiểu — trừ thẳng 15 điểm, nhân 0.85, hay coi độ khó = 100−B rồi ×1.15).
// L40 và mọi level ÷5 phía dưới GIỮ dải cũ 30-50: yêu cầu nói rõ "từ 41 trở đi".
const FIVE_FROM = Number(process.env.FIVE_FROM || 41);
const FIVE_BAND = (process.env.FIVE_BAND || "26-43").split("-").map(Number);

// Dải HỘP SOCOLA (user 2026-08-14): L501-530 đều có một hộp 8×8 ở góc và cùng nhắm 30-60,
// KHÔNG theo luật ÷5 nữa — cả 30 bàn là một bộ, level ÷5 trong đó cũng dùng dải này.
const CHOCO = (process.env.CHOCO_RANGE || "501-530").split("-").map(Number);
const CHOCO_BAND = (process.env.CHOCO_BAND || "30-60").split("-").map(Number);

// Dải 25×25 (user 2026-08-14): L470-500 chuyển hết sang bàn 25×25 giữ nguyên ảnh cũ, cùng nhắm
// 40-50 — KHÔNG theo luật ÷5 nữa, cả 31 bàn là một bộ.
const SMALL = (process.env.SMALL_RANGE || "470-500").split("-").map(Number);
const SMALL_BAND = (process.env.SMALL_BAND || "40-50").split("-").map(Number);
const inSmall = (n) => n >= SMALL[0] && n <= SMALL[1];

// Level vừa được RẢI ĐÁ (user 2026-08-14). Sàn 40, trần thả — user: "để winrate >40%", không
// phải một dải. Đá chỉ làm khó thêm, nên chỉ cần chặn đáy là đủ; trần rộng còn giúp bộ tune
// dừng sớm ở nấc ít xe nhất.
const ROCKS = new Set((process.env.ROCK_LEVELS || "68,73,117,174").split(",").map(Number).filter(Boolean));

export function cfg(n) {
  const five = n % 5 === 0;
  const harder = five && n >= FIVE_FROM;
  if (ROCKS.has(n)) return { lo: 40, hi: 100, lays: [0], hid: 0 };
  if (inSmall(n)) {
    // lays = [0, 40]: thang phải có CẢ HAI CHIỀU. Bàn 25×25 chỉ còn ~480 ô (so với ~890 của
    // 35×35) nên phần lớn ra RẤT DỄ — lượt đầu 15/31 bàn đọc trên 50, có bàn chạm 100 — mà
    // thang lúc đó không có lớp-2 cho level thường nên không còn núm nào để ép xuống. Vài bàn
    // khác lại quá khó (15), tức cũng cần nấc KHÔNG lớp-2. Cho thang thử cả hai rồi chọn.
    return { lo: SMALL_BAND[0], hi: SMALL_BAND[1], lays: [0, 40], hid: 0 };
  }
  if (n >= CHOCO[0] && n <= CHOCO[1]) {
    return { lo: CHOCO_BAND[0], hi: CHOCO_BAND[1], lays: five ? [40] : [0], hid: 0 };
  }
  return {
    lo: five ? (harder ? FIVE_BAND[0] : 30) : 60,
    hi: five ? (harder ? FIVE_BAND[1] : 50) : 100,
    lays: five && n >= 40 && LAY_SET.has(n) ? [40] : [0],
    hid: n % 15 === 0 && n >= 40 ? 0.05 : 0,
  };
}

// ---- slime "?" theo CỤM MỘT MÀU ----------------------------------------------------------
// genlib.makeHidden rải blob không phân biệt màu; user muốn "cùng 1 màu ở gần nhau", nên blob
// ở đây bị ép nằm gọn trong MỘT vùng liền khối của MỘT màu. Chỉ lấy ô lõi (cả 4 ô kề đều là
// slime) — ô rìa mà ẩn thì tia đứng ngoài không bao giờ mở được nó ra.
export function addHiddenColorBlobs(L, frac, seed) {
  const { cols, rows, board } = L;
  const N = board.length;
  const slime = (i) => i >= 0 && i < N && isC(board[i]);
  const elig = new Set();
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    if (slime(i) && slime(i - cols) && slime(i + cols) && slime(i - 1) && slime(i + 1)) elig.add(i);
  }
  const total = board.reduce((a, v) => a + (isC(v) ? 1 : 0), 0);
  const want = Math.round(total * frac);
  if (want < 6 || elig.size < 6) return 0;

  const nb = (i) => { const r = (i / cols) | 0, c = i % cols; return [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1]; };
  const seen = new Set(), comps = [];
  for (const s of elig) {
    if (seen.has(s)) continue;
    const col = board[s], st = [s], comp = [];
    seen.add(s);
    while (st.length) {
      const i = st.pop(); comp.push(i);
      for (const j of nb(i)) if (j >= 0 && elig.has(j) && !seen.has(j) && board[j] === col) { seen.add(j); st.push(j); }
    }
    if (comp.length >= 6) comps.push(comp);
  }
  if (!comps.length) return 0;

  const rng = mkRng(seed);
  for (let i = comps.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [comps[i], comps[j]] = [comps[j], comps[i]]; }
  const hidden = new Array(N).fill(-1);
  let have = 0;
  for (const comp of comps) {
    if (have >= want) break;
    const start = comp[Math.floor(rng() * comp.length)];
    const inComp = new Set(comp), q = [start], mark = new Set([start]);
    while (q.length && have < want) {
      const i = q.shift();
      hidden[i] = board[i]; have++;
      for (const j of nb(i)) if (j >= 0 && inComp.has(j) && !mark.has(j)) { mark.add(j); q.push(j); }
    }
  }
  if (have < 6) return 0;
  L.hidden = hidden;
  return have;
}

export function buildX(src, n, rung) {
  const L = build(src, n, rung);
  if (rung.hid) addHiddenColorBlobs(L, rung.hid, n * 7919 + 101);
  return L;
}

function ladderFor(n) {
  const c = cfg(n);
  const caps = (process.env.CAPS || "130,95,65,45,30").split(",").map(Number);
  const waves = (process.env.WAVES || "1,2,3,5").split(",").map(Number);
  // Level dễ không cần núm khó: quét áp lực cao ở đó là đi ngược hướng cần tìm (§8.8).
  // Dải 25×25 cũng cần nấc áp lực cao: bàn nhỏ vốn dễ, mà dải 40-50 chỉ rộng 10 điểm nên
  // thiếu núm là không với tới được (lượt đầu 15/31 bàn vượt trần).
  const press = (n % 5 === 0 || inSmall(n)) ? [0, 0.15, 0.3] : [0, 0.15];
  const mins = (process.env.MINCAR_LADDER || "22,40").split(",").map(Number);
  const out = [];
  for (const cap of caps) for (const wave of waves) for (const pressure of press) for (const lay of c.lays) for (const minCar of mins)
    out.push({ cap, wave, pressure, lay, minCar, hid: c.hid });
  return out;
}

// ---- chọn nấc cho MỘT level --------------------------------------------------------------
const HITS = Number(process.env.HITS || 3);   // dừng sau bấy nhiêu nấc lọt dải
function pickOne(n) {
  const c = cfg(n);
  // dựng hết thang trước (8ms/nấc) → biết CHÍNH XÁC số xe của từng nấc mà chưa tốn phép đo
  const built = ladderFor(n).map((r) => ({ r, L: buildX(d[n], n, r) }));
  // Sàn 6 xe là ƯU TIÊN, không phải chặn — board ít màu (L132: 25x25) có thể cho MỌI nấc dưới
  // 6 xe, và lúc đó lọc cứng làm thang rỗng → `nearest` null → cả shard chết giữa chừng và mất
  // luôn 13 level phía sau. Đúng bài học §8.1: đừng biến ưu tiên thành chặn.
  const big = built.filter((x) => x.L.chests.length >= 6);
  const rungs = big.length ? big : built;
  rungs.sort((a, b) => a.L.chests.length - b.L.chests.length);
  const hits = [];
  let measured = 0;
  let nearest = null;
  for (const x of rungs) {
    const b = measure2(x.L, N_B);
    measured++;
    const off = Math.max(0, c.lo - b) + Math.max(0, b - c.hi);
    if (!nearest || off < nearest.off) nearest = { ...x, b, off };
    if (off === 0) { hits.push({ ...x, b, off }); if (hits.length >= HITS) break; }
  }
  const pool = hits.length ? hits : [nearest];
  // trong số nấc đã lọt dải: tránh nấc thua ở 4% bàn (user đọc là "level hỏng", không phải khó)
  for (const x of pool) x.lossAt = lossProfile(x.L).lossAt;
  const mid = (c.lo + c.hi) / 2;
  const key = (x) => x.off * 2 + (x.b >= 90 ? 0 : positionPenalty(x.lossAt)) + Math.abs(x.b - mid) * 0.05 + x.L.chests.length * 0.25;
  const best = pool.slice().sort((a, z) => key(a) - key(z))[0];
  return { n, b: best.b, off: best.off, cars: best.L.chests.length, lossAt: best.lossAt, rung: best.r, measured, total: rungs.length };
}

if (process.argv.includes("--scan")) {
  const SHARD = Number(process.env.SHARD || 0), NSHARD = Number(process.env.NSHARD || 1);
  const todo = ALL.filter((_, i) => i % NSHARD === SHARD);
  console.error(`shard ${SHARD}: ${todo.length} level`);
  const out = [];
  for (const n of todo) {
    const r = pickOne(n);
    out.push(r);
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out));
    console.error(`  L${n} B=${r.b}${r.off ? " (lech " + r.off + ")" : ""} xe=${r.cars} — do ${r.measured}/${r.total} nac`);
  }
  if (!process.env.OUT) console.log(JSON.stringify(out));
  process.exit(0);
}

// ---- đo lại ở độ phân giải cao, CHIA SHARD ĐƯỢC ------------------------------------------
// Tách khỏi --pick vì --pick phải chạy một tiến trình (nó ghi file), mà 251 phép đo ở n=200
// trong một tiến trình thì mất ~30 phút.
if (process.argv.includes("--final")) {
  const files = process.argv.slice(process.argv.indexOf("--final") + 1).filter((f) => !f.startsWith("-"));
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8"))).sort((a, b) => a.n - b.n);
  const SHARD = Number(process.env.SHARD || 0), NSHARD = Number(process.env.NSHARD || 1);
  const mine = rows.filter((_, i) => i % NSHARD === SHARD);
  const NF = Number(process.env.N_FINAL || 200);
  const out = [];
  for (const r of mine) {
    out.push({ n: r.n, b: measure2(buildX(d[r.n], r.n, r.rung), NF) });
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out));
    console.error(`  L${r.n} = ${out[out.length - 1].b}`);
  }
  if (!process.env.OUT) console.log(JSON.stringify(out));
  process.exit(0);
}

// ⚠ TÊN CỜ PHẢI KHÁC gen-design.mjs. File này import `build` từ đó, mà gen-design chạy khối
// `--pick` của nó NGAY LÚC IMPORT — nên đặt tên trùng thì lệnh bị nó cướp mất (và nếu quên
// DRY=1 thì chính nó ghi đè designed.json bằng bộ tune cũ của L2-46).
if (process.argv.includes("--write")) {
  const files = process.argv.slice(process.argv.indexOf("--write") + 1);
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8"))).sort((a, b) => a.n - b.n);
  // số đo n=200 đã có sẵn từ --final thì dùng lại, khỏi đo lần nữa
  const pre = {};
  if (process.env.FINAL) for (const f of process.env.FINAL.split(",")) for (const x of JSON.parse(fs.readFileSync(f, "utf8"))) pre[x.n] = x.b;
  // §0.4: con số được phép báo cáo là con số đo trên nấc CUỐI CÙNG, ở độ phân giải cao —
  // quét ở N_B thấp lệch tới 8 điểm và không cùng chiều.
  const NF = Number(process.env.N_FINAL || 200);
  console.log("lv   | dai    | B(n=" + NF + ") | xe | vun | lop2 | ? | doi | nac");
  const out = {}, miss = [];
  for (const r of rows) {
    const c = cfg(r.n);
    const L = buildX(d[r.n], r.n, r.rung);
    const b = pre[r.n] ?? measure2(L, NF);
    const off = Math.max(0, c.lo - b) + Math.max(0, b - c.hi);
    if (off) miss.push({ n: r.n, b });
    const tiny = L.chests.filter((x) => x.count < 10).length;
    const lay = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
    const hid = L.hidden ? L.hidden.filter((v) => v >= 0).length : 0;
    const tw = new Set(L.chests.filter((x) => x.pairId != null).map((x) => x.pairId)).size;
    console.log(`L${String(r.n).padEnd(4)}| ${c.lo}-${String(c.hi).padEnd(3)}| ${String(b).padStart(6)} | ${String(L.chests.length).padStart(2)} |` +
      ` ${String(tiny).padStart(3)} | ${String(lay).padStart(4)} | ${String(hid).padStart(2)} | ${String(tw).padStart(3)} |` +
      ` cap${r.rung.cap} w${r.rung.wave} p${r.rung.pressure} mc${r.rung.minCar}${off ? "   << lech " + off : ""}`);
    out[r.n] = L;
  }
  console.log(`\n${rows.length} level, ${miss.length} level ngoai dai: ${miss.map((m) => "L" + m.n + "=" + m.b).join(", ") || "khong co"}`);
  if (process.env.DRY === "1") { console.log("DRY=1 — khong ghi"); process.exit(0); }
  for (const n of Object.keys(out)) d[n] = out[n];
  writeD(d);
  console.log("da ghi src/levels/designed.json");
  process.exit(0);
}

console.log("dung: --scan (SHARD/NSHARD/OUT) ; --write p-*.json");
