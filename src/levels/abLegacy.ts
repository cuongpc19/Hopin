import type { Level } from "../game/level";
import data from "./ab-legacy.json";

// 15 MÀN ĐẦU CỦA BẢN LAUNCH — nhánh A của phép thử A/B (xem `src/game/ab.ts`).
//
// Chụp từ commit `bc74c85` (2026-08-13 18:21), bản đã đóng gói gửi CrazyGames. Cả 15 bàn
// được chép vào đây, KHÔNG PHẢI chỉ 5 bàn khác nhau, dù lúc chụp chỉ L2/L7/L9/L11/L15 lệch
// với `designed.json`: nhánh A phải ĐỨNG YÊN. Chép mỗi phần khác nhau thì đợt tune sau chạm
// vào L3 (chẳng hạn) sẽ lặng lẽ đổi luôn nhánh A, và phép thử mất đối chứng giữa chừng mà
// không có gì báo. `node scripts/check-ab.mjs` in ra bàn nào đang thật sự khác nhau.
//
// Giá: 43,7 KB thô ≈ 4,2 KB sau gzip — đo bằng zlib trên đúng chuỗi này. Bundle hiện ~551 KB
// nén và thời gian vào được game là chỉ số CrazyGames chấm điểm, nên con số ấy có đáng kể hay
// không là chuyện phải cân; 4 KB thì không.
export const AB_LEGACY_LEVELS: Record<number, Level> = data as unknown as Record<number, Level>;
