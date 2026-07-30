// precompute-wins.mjs — "SÁCH GIẢI": tìm sẵn các ván thắng (chuỗi nước đầy đủ) cho L131-152
// bằng trip-sim (mô phỏng hành trình đã verify per-trip). Mỗi level quét tới 400 seed, giữ tối đa
// 3 ván thắng NGẮN nhất. Ghi ra Manythings/Design level/win-plans.json + in tóm tắt.
import * as SC from "./simcore.mjs";
import fs from "fs";

const designed = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const OUT = "../Pixel Flow/Manythings/Design level/win-plans.json";
const result = {};
for (let lvl = 131; lvl <= 152; lvl++) {
  const L = designed[lvl];
  if (!L || !L.slam) continue;
  const s0 = SC.makeState(L);
  const wins = [];
  let tried = 0;
  for (let t = 1; t <= 400 && wins.length < 3; t++) {
    tried = t;
    const r = SC.rollout(s0, t * 7919 + 13);
    if (r.win) wins.push(r.plan);
  }
  wins.sort((a, b) => a.length - b.length);
  result[lvl] = { tried, found: wins.length, plans: wins };
  console.log(`L${lvl}: ${wins.length} ván thắng (quét ${tried} seed)${wins.length ? " — ngắn nhất " + wins[0].length + " nước" : " — KHÔNG tìm ra"}`);
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log("✔ đã ghi " + OUT);
