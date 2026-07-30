// stubborn4.mjs — xử 4 level "lì" còn lại của band (L141/L146/L147/L151, 2026-07-31).
// Khác rebuild-band: ẢNH nằm TRONG vòng search (thử tối đa 6 ảnh/level — ảnh nhiều màu
// trần khó cao hơn) + twin HÀNH-LÝ (addBaggageTwins, gánh dương thật) thay tunetwins.
//   L141 (ramp 20): bisect layer2 hi 140; kẹt dễ → chồng thêm baggage-twin.
//   L146/147 (twin-heavy 25, KHÔNG layer2 — spec user): baseline ≥35 rồi baggage-twin gánh.
//   L151 (mixed 18): layer2 + baggage-twin + xe "?".
// Cuối: dọn layer2 "1 ô lẻ" của L138 (chạy trước patch min-8).
import fs from "fs";
import path from "path";
import {
  ROOT, isC, readD, writeD, measure, colorDepth, reCar, makeOrder,
  addLayer2Clusters, addBaggageTwins, addBuried, buildBoard,
} from "./genlib.mjs";

const LOG = path.join(ROOT, "scripts/_stubborn4-log.txt");
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const TARGET = { 141: 20, 146: 25, 147: 25, 151: 18 };
const KIND = { 141: "ramp", 146: "twin", 147: "twin", 151: "mixed" };
const strip = (ch) => ch.map((c) => ({ color: c.color, count: c.count }));

// kho ảnh: sliced + tồn hard, trừ mọi ảnh đã có chủ (field img trong designed + 2 ảnh L1/L2)
function candidates() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(png|jpg)$/i.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, "../Pixel Flow/public/art/level art/sliced"));
  walk(path.join(ROOT, "../Pixel Flow/public/art/level art/hard"));
  return out;
}
const usedNames = new Set(["3_penguin_animals1.png", "2_elephant_animals2.png"]);
{
  const d0 = readD();
  for (const k of Object.keys(d0)) if (d0[k] && d0[k].img) usedNames.add(d0[k].img);
}

fs.writeFileSync(LOG, "");
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;

for (const lvlS of Object.keys(TARGET)) {
  const lvl = +lvlS;
  if (only && !only.has(lvl)) continue;
  const target = TARGET[lvl];
  const kind = KIND[lvl];
  const t0 = Date.now();
  let global = null; // best trên MỌI ảnh: {dist, full, base, img, bgColor, pct, chests, layer2}
  let tried = 0;
  for (const img of candidates()) {
    if (usedNames.has(path.basename(img))) continue;
    if (tried >= 6) break;
    const res = buildBoard(img, lvl, 12, 25);
    if (!res.ok) continue;
    const d = readD(); const L = d[lvl];
    const colors = new Set(L.board.filter(isC)).size;
    const fill = L.board.filter(isC).length;
    if (colors < 9 || fill < 240) continue; // lì = cần nhiều màu + đủ khối
    tried++;
    const bgColor = res.bgColor;
    L.slam = true; delete L.tray;
    let bestImg = null;

    if (kind === "twin") {
      L.layer2 = null;
      const cdep = colorDepth(L);
      for (const cfg of [{ bgHead: 3, deepN: 0 }, { bgHead: 4, deepN: 0 }, { bgHead: 2, deepN: 1 }, { gentle: true }]) {
        for (let seed = 1; seed <= 6; seed++) {
          const cars = reCar(L, lvl * 31 + seed * 7, { minCars: 14 });
          L.chests = makeOrder(cars, cdep, lvl * 7919 + seed * 137, { bgColor, ...cfg });
          const base = measure(L, 40);
          if (base < 35) continue;
          for (const np of [4, 6]) {
            addBaggageTwins(L, np, cdep, lvl * 17 + seed);
            const full = measure(L, 64);
            const gánh = base - full;
            L.chests.forEach((c) => { /* giữ pairId để chấm */ });
            const okBand = full >= 10 && full <= 40;
            const dist = Math.abs(full - target) + (okBand ? 0 : 50) + (gánh >= 8 ? 0 : gánh >= 5 ? 4 : 25);
            if (!bestImg || dist < bestImg.dist) bestImg = { dist, full, base, gánh, chests: JSON.parse(JSON.stringify(L.chests)), layer2: null };
            L.chests = strip(L.chests);
            if (bestImg.dist <= 3) break;
          }
          if (bestImg && bestImg.dist <= 3) break;
        }
        if (bestImg && bestImg.dist <= 3) break;
      }
    } else {
      // ramp/mixed: bisect layer2 → sweep → nếu vẫn dễ chồng baggage-twin
      let lo = 0, hi = 140;
      for (let it = 0; it < 6; it++) {
        const mid = Math.round((lo + hi) / 2);
        addLayer2Clusters(L, lvl * 613 + 11, mid, { bgColor });
        const cdep = colorDepth(L);
        let s = 0;
        for (let seed = 1; seed <= 3; seed++) {
          const cars = reCar(L, lvl * 31 + seed * 7, { minCars: 12 });
          L.chests = makeOrder(cars, cdep, lvl * 7919 + seed * 137, { bgColor, bgHead: 3, deepN: 2 });
          s += measure(L, 14);
        }
        if (s / 3 > target) lo = mid; else hi = mid;
      }
      const wantMid = Math.round((lo + hi) / 2);
      for (const wv of [...new Set([wantMid, Math.max(0, wantMid - 8), Math.min(140, wantMid + 8)])]) {
        addLayer2Clusters(L, lvl * 613 + 11, wv, { bgColor });
        const cdep = colorDepth(L);
        for (const cfg of [{ bgHead: 3, deepN: 2 }, { bgHead: 3, deepN: 3 }, { bgHead: 4, deepN: 4 }, { bgHead: 2, deepN: 2 }]) {
          for (let seed = 1; seed <= 6; seed++) {
            const cars = reCar(L, lvl * 31 + seed * 7, { minCars: 12 });
            L.chests = makeOrder(cars, cdep, lvl * 7919 + seed * 137, { bgColor, ...cfg });
            let full = measure(L, 48);
            let twinNote = "";
            if (full > target + 6) { // vẫn dễ → chồng baggage-twin
              const base = full;
              addBaggageTwins(L, 4, cdep, lvl * 17 + seed);
              full = measure(L, 64);
              twinNote = ` (baggage: ${base}→${full})`;
            }
            const okBand = full >= 10 && full <= 40;
            const dist = Math.abs(full - target) + (okBand ? 0 : 50);
            if (!bestImg || dist < bestImg.dist) bestImg = { dist, full, base: -1, gánh: 0, twinNote, chests: JSON.parse(JSON.stringify(L.chests)), layer2: L.layer2 ? L.layer2.slice() : null };
            L.chests = strip(L.chests);
            if (bestImg.dist <= 3) break;
          }
          if (bestImg && bestImg.dist <= 3) break;
        }
        if (bestImg && bestImg.dist <= 3) break;
      }
    }
    if (bestImg && (!global || bestImg.dist < global.dist)) {
      global = { ...bestImg, img, bgColor, pct: res.borderPct };
    }
    log(`L${lvl}: thử ${path.basename(img).slice(0, 36)} → dist ${bestImg ? bestImg.dist : "-"} (full ${bestImg ? bestImg.full : "-"})`);
    if (global && global.dist <= 3) break;
  }
  if (!global) { log(`L${lvl}: ✗ vẫn không đạt — cần ảnh mới từ user`); continue; }
  // áp bản thắng: build lại đúng ảnh (board deterministic) rồi gán chests/layer2
  buildBoard(global.img, lvl, 12, 25);
  const d = readD(); const L = d[lvl];
  L.slam = true; delete L.tray;
  L.img = path.basename(global.img);
  L.chests = global.chests;
  if (global.layer2) L.layer2 = global.layer2; else delete L.layer2;
  if (kind === "mixed") addBuried(L, 0.33, lvl * 131 + 7, L.lanes || 4);
  writeD(d);
  usedNames.add(L.img);
  const tw = new Set(L.chests.filter((c) => c.pairId != null).map((c) => c.pairId)).size;
  const l2 = L.layer2 ? L.layer2.filter((v) => v >= 0).length : 0;
  log(`L${lvl}: ✓ CHỐT ${L.img} viền ${global.pct}% | ${L.chests.length} xe ${tw} twin ${l2}chôn | trip-sim ${global.full}%${global.twinNote || ""} gánh ${global.gánh} (target ${target}) [${Math.round((Date.now() - t0) / 1000)}s]`);
}

// dọn layer2 1-ô-lẻ của L138 (build trước patch min-8)
{
  const d = readD(); const L = d[138];
  if (L && L.layer2 && L.layer2.filter((v) => v >= 0).length < 8) {
    delete L.layer2;
    writeD(d);
    log(`L138: bỏ layer2 1-ô-lẻ → trip-sim ${measure(L, 64)}% (target 26)`);
  }
}
log("✔ stubborn4 xong");
