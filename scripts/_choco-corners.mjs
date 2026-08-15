// Đặt HỘP SOCOLA vào GÓC cho một dải level (user 2026-08-14: "làm 30 level có socola, socola
// nên để kích thước 7x7 hoặc 8x8 và nằm ở các góc. Với map 25x25 thì để kích thước là 4x4").
//
//   node scripts/_choco-corners.mjs            # xem trước
//   WRITE=1 node scripts/_choco-corners.mjs    # ghi designed.json
//
// ⚠ GÓC BÀN THƯỜNG TRỐNG. Tranh emoji có nền bị khoét nên 13/30 bàn không có góc nào đặt vừa
// một khối 8×8 toàn slime. Nên không đặt cứng ở (1,1) mà TÌM CHỖ TOÀN SLIME GẦN GÓC NHẤT —
// đo được: cả 30 bàn đều có chỗ cách góc 4.5-6.5 ô tính từ tâm hộp, tức viền hộp chạm góc
// hoặc lùi vào 1-3 ô. Hộp phải nằm trên slime vì nó GIẤU slime; đè lên ô trống thì lúc vỡ
// chẳng có gì hiện ra.
//
// XOAY ĐỀU 4 GÓC theo số level: 30 hộp dồn một góc thì nhìn như lỗi lặp chứ không như thiết kế.
//
// RUY BĂNG xen kẽ một-màu / cầu vồng. Màu một-màu phải có ĐỦ ô NGOÀI hộp (≥1.5× count cho
// thoải mái) và KHÔNG được là màu nền của bàn — ruy băng màu nền thì hộp mở gần như tức thì
// vì màu nền lúc nào cũng với tới được.
import fs from "node:fs";
import { readD, writeD, isC } from "./genlib.mjs";

const RAINBOW = -1;
// Bảng màu — phải khớp src/game/palette.ts (dùng để loại màu gần xám khỏi ruy băng).
const PALETTE = [0xfe4038,0xfe8f28,0xfed734,0x37cb5c,0x2ac0cc,0x408afa,0x9756fd,0xfd55a5,0xffffff,
  0xcbcbcb,0x4a4a4a,0x985828,0x262630,0x3050a0,0xe0b888,0x98d0f0,0x208038,0xf8c0c8,0x902030];
const [R0, R1] = (process.env.RANGE || "501-530").split("-").map(Number);
const d = readD();

/** Cỡ hộp theo cỡ bàn: bàn 25 thì 4×4, bàn to hơn thì 8×8 (user cho 7 hoặc 8). */
const sizeFor = (W) => (W <= 25 ? 4 : 8);

/** Chỗ đặt n×n TOÀN SLIME gần góc `tag` nhất, tránh các ô đã bị hộp khác chiếm; null nếu không có. */
function nearestAt(L, n, tag, taken = null) {
  const W = L.cols, H = L.rows;
  const [cr, cc] = tag === "TT" ? [0, 0] : tag === "TP" ? [0, W - 1] : tag === "DT" ? [H - 1, 0] : [H - 1, W - 1];
  const fit = (r0, c0) => {
    for (let r = r0; r < r0 + n; r++) for (let c = c0; c < c0 + n; c++) {
      const i = r * W + c;
      if (!isC(L.board[i])) return false;
      if (taken && taken.has(i)) return false;
    }
    return true;
  };
  let best = null;
  for (let r = 0; r <= H - n; r++) for (let c = 0; c <= W - n; c++) {
    if (!fit(r, c)) continue;
    const dd = Math.max(Math.abs(r + (n - 1) / 2 - cr), Math.abs(c + (n - 1) / 2 - cc));
    if (!best || dd < best.d) best = { r, c, d: dd, at: r * W + c };
  }
  return best;
}

const CORNERS = ["TT", "TP", "DP", "DT"]; // xoay theo chiều kim đồng hồ
const OPP = { TT: "DP", TP: "DT", DP: "TT", DT: "TP" };
// ⚠ SỐ ĐẾM CỦA HỘP CẦU VỒNG PHẢI CAO HẲN, không dùng chung công thức với hộp một màu.
// Đo 2026-08-14: hộp 5×5 cầu vồng số 8 làm winrate tụt ĐÚNG 0 điểm — "1-2 xe chạy lên là hết
// luôn" (user). Vì màu nào cũng trừ số nên nó rút theo TỐC ĐỘ ĂN CHUNG của cả bàn, chẳng liên
// quan gì tới cỡ hộp. User chốt 60-80; rải đều để 8 hộp không giống hệt nhau.
const RAIN_COUNTS = [60, 65, 70, 75, 80];
// Vài level có HAI hộp (user: "thi thoảng 4-5 level có 2 socola trong 1 level").
// Cứ 7 level một cái → 5 level trong dải 30: hộp thứ hai đặt ở góc ĐỐI DIỆN cho cân bàn.
const TWO_BOX = (i) => i % 7 === 0;

// ONLY=n,n,n — đặt hộp vào đúng bộ level chỉ định thay vì cả dải liên tục. Cần khi bộ level là
// một nhúm rải rác (5% của L200-400 chẳng hạn) chứ không phải một đoạn liền.
const ONLY = (process.env.ONLY || "").split(",").map(Number).filter(Boolean);
const TARGETS = ONLY.length ? ONLY.slice().sort((a, b) => a - b) : Array.from({ length: R1 - R0 + 1 }, (_, i) => R0 + i);

const rows = [];
for (let ti = 0; ti < TARGETS.length; ti++) {
  const n = TARGETS[ti];
  const L = d[n];
  if (!L?.board) continue;
  const N = sizeFor(L.cols);
  // Thứ tự TRONG BỘ, không phải khoảng cách tới R0: nó điều khiển xoay góc, nhịp cầu vồng và
  // level hai hộp. Lấy theo số level thì một bộ rải rác sẽ nhảy cóc — góc dồn cụm và nhịp
  // "cứ 4 level một cầu vồng" thành ngẫu nhiên.
  const idx = ti;
  const total = {};
  L.board.forEach((v) => { if (isC(v)) total[v] = (total[v] || 0) + 1; });
  const allCells = Object.values(total).reduce((a, b) => a + b, 0);

  const taken = new Set();
  const boxes = [];
  const wanted = TWO_BOX(idx) ? 2 : 1;
  // Hộp 1 ở góc theo lượt; hộp 2 (nếu có) ở góc đối diện. Góc nào không đặt được thì thử tiếp.
  const firstOrder = CORNERS.slice(idx % 4).concat(CORNERS.slice(0, idx % 4));

  for (let k = 0; k < wanted; k++) {
    const order = k === 0 ? firstOrder : [OPP[boxes[0].tag], ...CORNERS.filter((t) => t !== boxes[0].tag)];
    let spot = null, tag = "";
    for (const t of order) { const s = nearestAt(L, N, t, taken); if (s) { spot = s; tag = t; break; } }
    if (!spot) { if (k === 0) console.log(`L${n}: khong dat duoc hop ${N}x${N}`); break; }
    for (let r = spot.r; r < spot.r + N; r++) for (let c = spot.c; c < spot.c + N; c++) taken.add(r * L.cols + c);
    boxes.push({ spot, tag });
  }
  if (!boxes.length) continue;

  // Ô còn lại NGOÀI MỌI hộp — nguồn để mở hộp, nên phải trừ cả hai hộp.
  const out = {};
  let outAll = 0;
  L.board.forEach((v, i) => { if (isC(v) && !taken.has(i)) { out[v] = (out[v] || 0) + 1; outAll++; } });

  // Level hai hộp: một CẦU VỒNG + một MỘT MÀU, để người chơi thấy hai luật cạnh nhau trên cùng
  // một bàn. Level một hộp: cứ bốn level một cái cầu vồng (xem ghi chú màu bên dưới).
  const GREYISH = new Set([8, 9, 10, 12]); // trắng · xám nhạt · xám đậm · đen
  void PALETTE;
  const pickSolid = (need) => {
    // Màu hiếm nhất mà vẫn đủ dư ngoài hộp và không phải màu nền (<40% bàn).
    // BỎ QUA MÀU GẦN XÁM: chúng không có tông màu để nhuộm thân hộp nên rơi về nâu socola —
    // mà thân nâu chính là cái nhầm "hộp nâu = slime nâu phải ăn" user bắt sửa 2026-08-14.
    //
    // Thử 1.5× trước rồi HẠ XUỐNG 1.25×. Level hai hộp có ít ô còn lại hơn hẳn (mất 128 ô vào
    // hai cái hộp), nên ngưỡng 1.5× cứng làm L529 không tìm ra màu nào và rơi về cầu vồng —
    // thành hai hộp cầu vồng trên cùng một bàn, mất đúng cái ý "hai luật cạnh nhau".
    // Bước cuối CHO PHÉP MÀU XÁM. Thân hộp sẽ rơi về nâu socola — nhưng nếu bỏ qua thì hộp đó
    // thành CẦU VỒNG, mà thân hộp cầu vồng cũng nâu y hệt. Nâu thì đằng nào cũng nâu, nên thà
    // giữ được LUẬT KHÁC NHAU giữa hai hộp còn hơn. Đúng ca L529: bàn gần như chỉ có xám id9.
    for (const [margin, allowGrey] of [[1.5, false], [1.25, false], [1.25, true]]) {
      const ok = Object.entries(out)
        .filter(([c, k]) => k >= need * margin && total[c] / allCells < 0.4 && (allowGrey || !GREYISH.has(Number(c))))
        .sort((a, b) => a[1] - b[1]);
      if (ok.length) return Number(ok[0][0]);
    }
    return null;
  };
  const solidCount = Math.round((N * N * 3) / 8);
  const rainCount = RAIN_COUNTS[idx % RAIN_COUNTS.length];

  boxes.forEach((b, k) => {
    // Hai hộp → hộp đầu cầu vồng, hộp sau một màu. Một hộp → cứ 4 level một cái cầu vồng.
    const rainbow = boxes.length > 1 ? k === 0 : idx % 4 === 3;
    const solid = rainbow ? null : pickSolid(solidCount);
    const ribbon = rainbow || solid === null ? RAINBOW : solid;
    const count = ribbon === RAINBOW ? Math.min(rainCount, Math.floor(outAll * 0.5)) : solidCount;
    rows.push({
      n, N, tag: b.tag, at: b.spot.at, r: b.spot.r, c: b.spot.c, d: b.spot.d,
      count, ribbon, have: ribbon === RAINBOW ? outAll : out[ribbon], two: boxes.length > 1,
    });
  });
}

console.log("lv   | hop | goc | vi tri    | cach goc | so | ruy bang        | o ngoai hop");
for (const r of rows)
  console.log(`L${r.n}${r.two ? "*" : " "}| ${r.N}x${r.N} | ${r.tag}  | r${String(r.r).padStart(2)}c${String(r.c).padStart(2)}    | ${r.d.toFixed(1).padStart(6)}   | ${String(r.count).padStart(2)} | `
    + `${(r.ribbon === RAINBOW ? "CAU VONG" : "mot mau id" + r.ribbon).padEnd(15)} | ${r.have}`);
const rain = rows.filter((r) => r.ribbon === RAINBOW).length;
const lv2 = [...new Set(rows.filter((r) => r.two).map((r) => r.n))];
console.log(`\n${rows.length} hop tren ${new Set(rows.map((r) => r.n)).size} level | ${rain} cau vong / ${rows.length - rain} mot mau`);
console.log(`goc: ` + CORNERS.map((t) => t + ":" + rows.filter((r) => r.tag === t).length).join(" "));
console.log(`level co HAI hop (* o tren): ${lv2.length} — ${lv2.map((x) => "L" + x).join(" ")}`);

if (process.env.WRITE !== "1") { console.log("\nxem truoc — dat WRITE=1 de ghi"); process.exit(0); }
const byLv = {};
for (const r of rows) (byLv[r.n] = byLv[r.n] || []).push({ at: r.at, n: r.N, count: r.count, ribbon: r.ribbon });
for (const [lv, bs] of Object.entries(byLv)) d[lv].boxes = bs;
writeD(d);
console.log("\nda ghi designed.json — chay check-choco.mjs roi dung lai hang xe");
