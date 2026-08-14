// Ép một level dễ hết mức thang đo được (chỉ đi về phía dễ: wave nhỏ, áp lực 0, bỏ lớp-2).
//
// Thang chỉ đi về phía DỄ: wave nhỏ (bám sát nhịp bóc), áp lực 0, và cho phép BỎ lớp-2.
// §3.1: `orderByPeel` phát xe đúng trình tự bàn được bóc → đầu hàng luôn có màu ăn được, đó là
// mốc 94% của thước. Mọi núm ở đây chỉ để chọn SỐ XE, không phải để chỉnh khó.
import fs from "node:fs";
import { readD } from "./genlib.mjs";
import { measure2 } from "./simcore2.mjs";
import { lossProfile } from "./design-core.mjs";
import { build } from "./gen-design.mjs";

const d = readD();
const N = Number(process.env.LV || 11);
const NB = Number(process.env.N_B || 120);
const out = [];
for (const cap of [130, 95, 65, 45, 30]) for (const wave of [1, 2]) for (const lay of [0, 40]) for (const minCar of [22, 40]) {
  const L = build(d[N], N, { cap, wave, pressure: 0, lay, minCar });
  const b = measure2(L, NB);
  out.push({ b, cars: L.chests.length, lay, rung: { cap, wave, pressure: 0, lay, minCar } });
}
out.sort((a, z) => z.b - a.b || a.cars - z.cars);
console.log(`L${N} — hien tai ${d[N].chests.length} xe, lop2 ${d[N].layer2 ? d[N].layer2.filter((v) => v >= 0).length : 0}, B=${measure2(d[N], NB)}`);
console.log(" B  | xe | lop2 | thua@ | nac");
for (const r of out.slice(0, 10)) {
  const L = build(d[N], N, r.rung);
  console.log(`${String(r.b).padStart(3)} | ${String(r.cars).padStart(2)} | ${String(r.lay).padStart(4)} | ${String(lossProfile(L).lossAt ?? "-").padStart(4)}% | cap${r.rung.cap} w${r.rung.wave} mc${r.rung.minCar}`);
}
fs.writeFileSync(`scripts/_ease-${N}.json`, JSON.stringify(out));
