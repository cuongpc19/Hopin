// Thua thì thua Ở ĐÂU? — phân biệt "level khó" với "level hỏng".
// Level khó: thua khi đã ăn 80-95% bàn (hết đường ở đoạn cuối).
// Level hỏng: thua khi mới ăn 20-40% (tắc ngay từ đầu, ghế thừa đọng đầy ô chờ).
// FROM=33 TO=46 N=60 node scripts/_diag-loss.mjs
import { readD } from "./genlib.mjs";
import { rollout2, mkWorld } from "./simcore2.mjs";

const FROM = Number(process.env.FROM || 33);
const TO = Number(process.env.TO || 46);
const N = Number(process.env.N || 60);
const d = readD();

console.log("lv | win% | thua: %ban da an (tb / min / max) | so nuoc tb khi thua");
for (let n = FROM; n <= TO; n++) {
  const L = d[n];
  if (!L) continue;
  const total = mkWorld(L).s.left ?? null;
  let wins = 0;
  const eaten = [], trips = [];
  for (let i = 0; i < N; i++) {
    const r = rollout2(L, 7919 + i * 131, null, {});
    if (r.win) { wins++; continue; }
    const tot = r.left + 0; // left = còn lại
    eaten.push(r.left);
    trips.push(r.trips.length);
  }
  // tổng ô của level
  const cells = L.board.filter((v) => v != null && v >= 0 && v < 90).length
    + (L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0);
  const pct = eaten.map((left) => Math.round((100 * (cells - left)) / cells));
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  console.log(
    `L${n} | ${String(Math.round((100 * wins) / N)).padStart(3)}% | ` +
    `${String(avg(pct)).padStart(3)}% / ${String(Math.min(...pct, 999)).padStart(3)}% / ${String(Math.max(...pct, 0)).padStart(3)}% | ${avg(trips)}`
  );
}
