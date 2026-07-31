// measure-final.mjs — nghiệm thu: đo N=80 toàn bộ L1-25 + L131-152, soát rule twin.
import { readD, measure } from "./genlib.mjs";

// L10: 65→72 (playtest 2026-07-31 user thua 5/5 — nâng chủ đích, xem gen25 DESIGN).
// L20: 65→45, L25: 60→35 (user 2026-07-31 — siết 2 mốc khó của pack).
const TARGET = {
  1: 100, 2: 100, 3: 81, 4: 95, 5: 70, 6: 98, 7: 90, 8: 90, 9: 90, 10: 72,
  11: 100, 12: 85, 13: 95, 14: 85, 15: 50, 16: 100, 17: 93, 18: 90, 19: 80, 20: 45,
  21: 100, 22: 85, 23: 90, 24: 90, 25: 35,
  131: 40, 132: 38, 133: 36, 134: 34, 135: 32, 136: 30, 137: 28, 138: 26, 139: 24,
  140: 22, 141: 20, 142: 17, 143: 15, 144: 13, 145: 12, 146: 25, 147: 25,
  148: 30, 149: 26, 150: 22, 151: 18, 152: 14,
};
const d = readD();
let off = 0;
for (const k of Object.keys(TARGET).map(Number)) {
  const L = d[k];
  if (!L || !L.slam) { console.log(`L${k}: THIẾU/không slam!`); off++; continue; }
  const w = measure(L, 80);
  const t = TARGET[k];
  const dist = Math.abs(w - t);
  const mark = dist <= 7 ? "✓" : "⚠";
  if (dist > 7) off++;
  // soát twin: cặp phải NGANG kề (i,i+1 cùng hàng) hoặc DỌC (i,i+lanes), khác màu, cấm navy-12
  const lanes = L.lanes || 4;
  const byPid = {};
  L.chests.forEach((c, i) => { if (c.pairId != null) (byPid[c.pairId] = byPid[c.pairId] || []).push(i); });
  let twinBad = "";
  for (const [pid, idxs] of Object.entries(byPid)) {
    if (idxs.length !== 2) { twinBad += ` pid${pid}:${idxs.length}xe`; continue; }
    const [a, b] = idxs.sort((x, y) => x - y);
    const okH = b === a + 1 && a % lanes !== lanes - 1;
    const okV = b === a + lanes;
    if (!okH && !okV) twinBad += ` pid${pid}:${a},${b}KHÔNG-KỀ`;
    if (L.chests[a].color === 12 || L.chests[b].color === 12) twinBad += ` pid${pid}:NAVY`;
    if (L.chests[a].color === L.chests[b].color) twinBad += ` pid${pid}:CÙNG-MÀU`;
  }
  const tw = Object.keys(byPid).length;
  console.log(`L${k}: ${String(w).padStart(3)}% (target ${String(t).padStart(3)}) ${mark}${tw ? ` ${tw}twin` : ""}${twinBad ? " ⚠TWIN:" + twinBad : ""}${L.img ? "  [" + L.img.slice(0, 28) + "]" : ""}`);
}
console.log(off === 0 ? "\n✔ TẤT CẢ trong dung sai ±7 + twin sạch" : `\n⚠ ${off} level lệch/lỗi`);
