// liệt kê level có VIỀN CẤU TRÚC màu trắng-8 / xám-nhạt-9 (khối "chết" cần tô lại)
import fs from "fs";
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const isC = (v) => v >= 0 && v < 90;
const lvls = [...Array(25).keys()].map((i) => i + 1).concat([...Array(22).keys()].map((i) => i + 131));
for (const k of lvls) {
  const L = d[k];
  if (!L) continue;
  const { cols, rows } = L;
  const seen = new Array(L.board.length).fill(false);
  const rimCount = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (!isC(L.board[i]) || seen[i]) continue;
    const col = L.board[i], q = [i]; seen[i] = true; const comp = [i]; let edge = false;
    while (q.length) {
      const cur = q.pop(), cr = (cur / cols) | 0, cc = cur % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) { edge = true; continue; }
        const ni = nr * cols + nc;
        if (!isC(L.board[ni])) { if (L.board[ni] < 90) edge = true; continue; }
        if (L.board[ni] === col && !seen[ni]) { seen[ni] = true; q.push(ni); comp.push(ni); }
      }
    }
    if (edge && comp.length >= 30) rimCount[col] = (rimCount[col] || 0) + comp.length;
  }
  const white = (rimCount[8] || 0) + (rimCount[9] || 0);
  if (white >= 30) console.log(`L${k}: viền trắng/xám ${white} ô (rim: ${JSON.stringify(rimCount)}) [${L.img || ""}]`);
}
