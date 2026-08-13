// Dải ĐÁ CỨNG liền nhau (mã 90), 2 hàng, ở TRÊN hoặc DƯỚI — theo mẫu L43 và yêu cầu user
// 2026-08-09 ("đá thì phải liền nhau, line đá có thể ở trên, có thể ở dưới").
//
// Sửa mảng TARGETS bên dưới rồi:  node scripts/add-rocks.mjs
// Sau đó BẮT BUỘC dựng lại hàng xe cho đúng những level đó (gen-design --pick), rồi
// check-seats. Bỏ bước ấy là 8 level thừa ghế so với ô = không thể thắng.
//
// ⚠ PHẢI CHẠY TRƯỚC KHI TUNE HÀNG XE: đá chiếm ô nên đổi số ô của từng màu, mà bất biến
// ghế=ô tính theo đúng con số đó. Thêm đá sau khi tune là hỏng cả loạt level.
import fs from "node:fs";
const ROCK = 90, BAND = 2, MARGIN = 2;
const TARGETS = [65, 75, 80, 90, 95, 105, 110, 120]; // 8/60 bàn — "thi thoảng"
const d = JSON.parse(fs.readFileSync("src/levels/designed.json", "utf8"));
const out = [];
TARGETS.forEach((n, k) => {
  const L = d[n], W = L.cols, H = L.rows;
  const top = k % 2 === 0;                      // xen kẽ trên / dưới
  const r0 = top ? MARGIN : H - MARGIN - BAND;
  let laid = 0, ate = {};
  for (let r = r0; r < r0 + BAND; r++)
    for (let c = MARGIN; c < W - MARGIN; c++) {
      const i = r * W + c, v = L.board[i];
      if (v >= 0 && v < 90) { ate[v] = (ate[v] || 0) + 1; }
      L.board[i] = ROCK; laid++;
    }
  out.push({ n, size: `${W}x${W}`, where: top ? "TRÊN" : "DƯỚI", laid, rows: `${r0}-${r0 + BAND - 1}` });
});
fs.writeFileSync("src/levels/designed.json", JSON.stringify(d, null, 2));
console.log("lv    cỡ      vị trí   hàng     ô đá");
out.forEach((o) => console.log(`L${String(o.n).padEnd(4)}${o.size.padEnd(8)}${o.where.padEnd(9)}${o.rows.padEnd(9)}${o.laid}`));
