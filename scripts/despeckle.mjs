// despeckle — gộp các MẢNG LIÊN THÔNG NHỎ (< minBlob ô) vào màu hàng xóm phổ biến nhất.
//
// Vì sao đây là đòn bẩy độ khó chính (đo 2026-08-05): ảnh import 10 màu để lại rất nhiều đốm
// lẻ 1-3 ô. Mỗi màu rải rác thành đốm sinh một xe "kén ăn" — nó phải vòng nhiều lượt mới gom
// đủ, mà xe chỉ rời ô chờ khi ĐẦY, nên nó khoá bay và làm bàn tắc. Gộp đốm lẻ đưa L2 từ 17%
// lên 94%. Bonus: tranh SẠCH HƠN chứ không xấu đi — bản gốc nhiễu như nhiễu tivi.
//
// frac < 1 → chỉ gộp một PHẦN số đốm (đốm nhỏ nhất trước). Đây là thang mịn giữa "nhiễu
// nguyên bản" (khó) và "sạch hẳn" (dễ), vì minBlob nguyên nhảy quá thô: 1→2→3 = 26→32→94%.
import { isC } from "./genlib.mjs";

export function despeckle(L, minBlob, frac = 1) {
  if (minBlob <= 1 || frac <= 0) return L;
  const b = L.board.slice(), { cols, rows } = L;
  for (let pass = 0; pass < 4; pass++) {
    const seen = new Uint8Array(b.length); const comps = [];
    for (let i = 0; i < b.length; i++) {
      if (!isC(b[i]) || seen[i]) continue;
      const col = b[i], cells = [i]; seen[i] = 1;
      for (let h = 0; h < cells.length; h++) {
        const j = cells[h], r = (j / cols) | 0, c = j % cols;
        for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const q = rr * cols + cc;
          if (!seen[q] && b[q] === col) { seen[q] = 1; cells.push(q); }
        }
      }
      if (cells.length < minBlob) comps.push(cells);
    }
    if (!comps.length) break;
    // đốm NHỎ NHẤT gộp trước (tie-break theo vị trí để tất định)
    comps.sort((x, y) => x.length - y.length || x[0] - y[0]);
    const take = pass === 0 ? Math.round(frac * comps.length) : comps.length;
    let done = 0;
    for (const cells of comps) {
      if (done++ >= take) break;
      const tal = {};
      for (const j of cells) {
        const r = (j / cols) | 0, c = j % cols;
        for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const w = b[rr * cols + cc];
          if (isC(w) && w !== b[cells[0]]) tal[w] = (tal[w] || 0) + 1;
        }
      }
      const best = Object.entries(tal).sort((x, y) => y[1] - x[1])[0];
      if (best) for (const j of cells) b[j] = +best[0];
    }
    if (frac < 1) break;   // thang mịn: chỉ một lượt, không loang tiếp
  }
  L.board = b; return L;
}
