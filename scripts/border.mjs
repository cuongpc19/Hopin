// border.mjs — RULE VIỀN CHỐT (2026-07-30, user):
//   • Viền = HÌNH CHỮ NHẬT nhỏ nhất (bbox chủ thể + 1 ô đệm), ĐỔ ĐẦY từ chủ thể ra mép hộp.
//   • KHÔNG bám hình (halo) — user chê "thô quá". KHÔNG thu nhỏ chủ thể để lách rule.
//   • Tổng ô viền ≤ 30% board — vượt → ảnh KHÔNG ĐẠT, phải chọn ảnh khác (chủ thể đặc/gọn).
//   • Màu viền: được trùng màu chủ thể, nhưng CẤM trùng màu của ô chủ thể SÁT viền (8 hướng).
// Dùng chung cho build-one.mjs + các gen script (gen15/gen7...).

export const MAX_BORDER_PCT = 30;

// Ưu tiên màu viền theo theme. ⚠ CẤM navy-12 làm viền chữ nhật trên board tối: 12 TRÙNG màu
// thảm nền → khung tàng hình + lỗ kín trong chủ thể thành "hố đen" (L20 cầu vồng, user
// 2026-08-01 "hơi quái"). Khác thời phủ-kín cũ (§20 cho phép 12) — với khung NHỎ thì 12 vô nghĩa.
export const PREFER_DARK = [14, 10, 9, 11, 13, 15, 16];
export const PREFER_LIGHT = [14, 8, 9, 15, 17];

/**
 * Áp viền chữ nhật lên board (mutate). Ô chủ thể = giá trị >= 0, trống = -1.
 * @param {number[]} board  mảng cols*rows, CHƯA đổ nền
 * @param {number} cols @param {number} rows
 * @param {object} opts { margin: số ô trống giữ ở rìa board (SAFE_MARGIN, default 1),
 *                        prefer: thứ tự màu ưu tiên, maxPct: default 30 }
 * @returns {{ok:boolean, pct:number, cells:number, fillColor:number|null, box:{r0,r1,c0,c1}|null}}
 *   ok=false → KHÔNG mutate board (ảnh không đạt rule — caller phải đổi ảnh).
 */
export function applyBoxBorder(board, cols, rows, opts = {}) {
  const margin = opts.margin ?? 1;
  const prefer = opts.prefer ?? PREFER_DARK;
  const maxPct = opts.maxPct ?? MAX_BORDER_PCT;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let i = 0; i < board.length; i++) {
    if (board[i] < 0) continue;
    const r = (i / cols) | 0, c = i % cols;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (c < minC) minC = c; if (c > maxC) maxC = c;
  }
  if (maxR < 0) return { ok: false, pct: 0, cells: 0, fillColor: null, box: null };
  const r0 = Math.max(margin, minR - 1), r1 = Math.min(rows - 1 - margin, maxR + 1);
  const c0 = Math.max(margin, minC - 1), c1 = Math.min(cols - 1 - margin, maxC + 1);
  const cells = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const i = r * cols + c;
    if (board[i] < 0) cells.push(i);
  }
  const pct = Math.round((100 * cells.length) / (cols * rows));
  if (pct > maxPct) return { ok: false, pct, cells: cells.length, fillColor: null, box: { r0, r1, c0, c1 } };
  // màu chủ thể sát viền (8 hướng) → cấm dùng làm màu viền
  const adj = new Set();
  for (const i of cells) {
    const r = (i / cols) | 0, c = i % cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const v = board[nr * cols + nc];
      if (v >= 0) adj.add(v);
    }
  }
  const fillColor = prefer.find((c) => !adj.has(c))
    ?? [...Array(19).keys()].find((c) => !adj.has(c)) ?? 12;
  for (const i of cells) board[i] = fillColor;
  return { ok: true, pct, cells: cells.length, fillColor, box: { r0, r1, c0, c1 } };
}
