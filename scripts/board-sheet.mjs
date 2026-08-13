// BƯỚC 4 — XEM BẰNG MẮT. Vẽ BÀN THẬT (mosaic slime) của một file pick ra ảnh ghép:
//   PICK=pool-pick.json OUT=/tmp/xem node scripts/board-sheet.mjs
//
// Xếp theo SỐ MÀU giảm dần, nên tấm cuối chính là phần đuôi yếu — nhìn tấm đó là biết ngay
// có phải hạ MINCOL / siết SIM trong emoji-pick.mjs không. Đừng chốt một lô ảnh mà chưa nhìn:
// điểm "đẹp" không thấy được chuyện 8 biển cấm vòng đỏ nhìn ra y như nhau (2026-08-13).
import sharp from "sharp";
import fs from "node:fs";
const D = "public/art/level art/emoji";
const COL = ["#fe4038","#fe8f28","#fed734","#37cb5c","#2ac0cc","#408afa","#9756fd","#fd55a5","#ffffff",
  "#cbcbcb","#4a4a4a","#985828","#262630","#3050a0","#e0b888","#98d0f0","#208038","#f8c0c8","#902030"];
const pick = JSON.parse(fs.readFileSync(`${D}/${process.env.PICK}`, "utf8"));
const items = Object.values(pick).sort((a, b) => b.colours - a.colours || b.score - a.score);
const C = 10, BOARD = 132, LB = 18, CW = BOARD + 8, CH = BOARD + LB;
const PER = Number(process.env.PER || 100);
let part = 0;
for (let s = 0; s < items.length; s += PER) {
  const chunk = items.slice(s, s + PER);
  const R = Math.ceil(chunk.length / C), W = C * CW, H = R * CH + 8;
  const g = [];
  g.push(`<rect width="${W}" height="${H}" fill="#1b1e30"/>`);
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i], L = v.level, n = L.cols;
    const px = (i % C) * CW + 4, py = Math.floor(i / C) * CH + 4;
    const u = BOARD / n;
    g.push(`<rect x="${px}" y="${py}" width="${BOARD}" height="${BOARD}" fill="#2b2f4a" rx="6"/>`);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const val = L.board[r * n + c];
      if (val < 0) continue;
      const f = val >= 90 ? "#5b6070" : (COL[val] || "#888");
      g.push(`<rect x="${(px + c * u).toFixed(2)}" y="${(py + r * u).toFixed(2)}" width="${(u + 0.3).toFixed(2)}" height="${(u + 0.3).toFixed(2)}" fill="${f}"/>`);
    }
    g.push(`<text x="${px + BOARD / 2}" y="${py + BOARD + 13}" font-family="Arial" font-size="11" fill="#c9cee0" text-anchor="middle">${v.name} · ${v.size} · ${v.colours}m</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${process.env.OUT}-${++part}.png`);
  console.log(`sheet ${part}: ${chunk.length} ban  ${W}x${H}`);
}
