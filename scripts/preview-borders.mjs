// preview-borders.mjs — dựng 3 KIỂU VIỀN mẫu trên 1 level có sẵn, xuất PNG để user chọn.
//   A. STICKER HALO: viền 2-3 ô bám theo HÌNH DÁNG chủ thể (như sticker); ngoài cùng ĐỂ TRỐNG
//      (board navy của game tự lộ — vốn đẹp sẵn).
//   B. KHUNG TRANH: khung chữ nhật 2 ô chạy quanh mép; khoảng giữa khung↔chủ thể để trống.
//   C. CARO 2 MÀU TỐI: nền phủ như cũ nhưng caro 12/13 (có texture, hết phẳng lì).
// Dùng: node scripts/preview-borders.mjs <level>
import sharp from "sharp";
import fs from "fs";

const lvl = Number(process.argv[2] || 135);
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const L = d[lvl];
const { cols, rows } = L;
const isC = (v) => v >= 0 && v < 90;

// nhận diện VIỀN CẤU TRÚC (mảng đồng màu ≥30 ô chạm rìa) → phần còn lại = CHỦ THỂ
function rimMask(board) {
  const seen = new Array(board.length).fill(false);
  const rim = new Array(board.length).fill(false);
  const idx = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(r, c);
    if (!isC(board[i]) || seen[i]) continue;
    const col = board[i]; const q = [i]; seen[i] = true; const comp = [i]; let edge = false;
    while (q.length) {
      const cur = q.pop(); const cr = (cur / cols) | 0, cc = cur % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) { edge = true; continue; }
        const ni = idx(nr, nc);
        if (!isC(board[ni])) { edge = true; continue; }
        if (board[ni] === col && !seen[ni]) { seen[ni] = true; q.push(ni); comp.push(ni); }
      }
    }
    if (edge && comp.length >= 30) for (const k of comp) rim[k] = true;
  }
  return rim;
}

const rim = rimMask(L.board);
const subject = L.board.map((v, i) => (isC(v) && !rim[i] ? v : -1));

// khoảng cách Chebyshev tới chủ thể (BFS 8 hướng)
function distToSubject() {
  const dist = new Array(subject.length).fill(Infinity);
  const q = [];
  subject.forEach((v, i) => { if (v >= 0) { dist[i] = 0; q.push(i); } });
  let head = 0;
  while (head < q.length) {
    const cur = q[head++]; const cr = (cur / cols) | 0, cc = cur % cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const ni = nr * cols + nc;
      if (dist[ni] > dist[cur] + 1) { dist[ni] = dist[cur] + 1; q.push(ni); }
    }
  }
  return dist;
}
const dist = distToSubject();

const variants = {};
// A. sticker halo (2 ô, màu 12) — ngoài cùng trống
variants.A_halo = subject.map((v, i) => (v >= 0 ? v : dist[i] >= 1 && dist[i] <= 2 ? 14 : -1)); // sticker viền KEM (be 14) — tách hẳn nền tối
// B. khung tranh (2 ô quanh mép) + chủ thể
variants.B_frame = subject.map((v, i) => {
  if (v >= 0) return v;
  const r = (i / cols) | 0, c = i % cols;
  const m = Math.min(r, c, rows - 1 - r, cols - 1 - c);
  return m <= 1 ? 11 : -1; // khung GỖ NÂU (11) — như khung tranh thật
});
// C. caro 12/13 phủ nền như cũ
variants.C_checker = L.board.map((v, i) => {
  if (subject[i] >= 0) return subject[i];
  if (!rim[i] && !isC(v)) return isC(v) ? v : (dist[i] < 99 && v === -1 && false ? -1 : -1);
  if (rim[i] || isC(v)) { const r = (i / cols) | 0, c = i % cols; return (r + c) % 2 ? 12 : 10; } // caro navy + xám đậm (dịu)
  return -1;
});

// D. BOX-FILL rule CHỐT (user): viền = HÌNH CHỮ NHẬT thật (bbox+1 đổ đầy, không co halo);
// tổng viền ≤30% board — vượt thì ảnh không đạt rule (chọn ảnh khác). Màu: cấm trùng màu sát ranh.
{
  let minR=rows,maxR=-1,minC=cols,maxC=-1;
  subject.forEach((v,i)=>{if(v<0)return;const r=(i/cols)|0,c=i%cols;if(r<minR)minR=r;if(r>maxR)maxR=r;if(c<minC)minC=c;if(c>maxC)maxC=c;});
  minR=Math.max(0,minR-1);maxR=Math.min(rows-1,maxR+1);minC=Math.max(0,minC-1);maxC=Math.min(cols-1,maxC+1);
  const inBox=i=>{const r=(i/cols)|0,c=i%cols;return r>=minR&&r<=maxR&&c>=minC&&c<=maxC;};
  const rimCells=new Set();subject.forEach((v,i)=>{if(v<0&&inBox(i))rimCells.add(i);});
  const adj=new Set();
  for(const i of rimCells){const r=(i/cols)|0,c=i%cols;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const nr=r+dr,nc=c+dc;
      if(nr<0||nc<0||nr>=rows||nc>=cols)continue;const ni=nr*cols+nc;
      if(subject[ni]>=0)adj.add(subject[ni]);}}
  const fillColor=[12,14,10,9,11,13,15,16].find(c=>!adj.has(c))??[...Array(19).keys()].find(c=>!adj.has(c))??12;
  variants.D_boxfill=subject.map((v,i)=>v>=0?v:(rimCells.has(i)?fillColor:-1));
  const pct=Math.round(100*rimCells.size/(cols*rows));
  console.log('D: viền '+rimCells.size+' ô = '+pct+'% board (rule ≤30%: '+(pct<=30?'ĐẠT':'VƯỢT — ảnh không hợp rule')+'), màu '+fillColor);
}
// render PNG (mỗi ô 16px) — palette game
const PAL = ["#fe4038", "#fe8f28", "#fed734", "#37cb5c", "#2ac0cc", "#408afa", "#9756fd", "#fd55a5", "#ffffff", "#cbcbcb", "#4a4a4a", "#985828", "#262630", "#3050a0", "#e0b888", "#98d0f0", "#208038", "#f8c0c8", "#902030"];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const MAT = hex("#17301c"); // nền board (xanh rêu tối như preview build-one)
async function render(board, name) {
  const S = 32;
  const buf = Buffer.alloc(cols * S * rows * S * 3);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = board[r * cols + c];
    const [R, G, B] = v >= 0 && v < PAL.length ? hex(PAL[v]) : MAT;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = ((r * S + y) * cols * S + (c * S + x)) * 3;
      buf[px] = R; buf[px + 1] = G; buf[px + 2] = B;
    }
  }
  await sharp(buf, { raw: { width: cols * S, height: rows * S, channels: 3 } }).png().toFile(`scripts/_level-preview/border-${name}.png`);
  console.log(`scripts/_level-preview/border-${name}.png`);
}
fs.mkdirSync("scripts/_level-preview", { recursive: true });
for (const [name, board] of Object.entries(variants)) await render(board, name);
