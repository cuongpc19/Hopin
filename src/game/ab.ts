// PHÉP THỬ A/B — 15 MÀN ĐẦU: bản LAUNCH (nhánh A) so với bản HIỆN TẠI (nhánh B).
//
// Câu hỏi cần trả lời: bộ 15 bàn mở đầu đã sửa từ hôm ra mắt có thật sự giữ người chơi tốt
// hơn không. Trước nay mọi lần đổi level đều thay thẳng bản cũ, nên không có gì để so — số
// liệu sau đó vừa mang ảnh hưởng của thiết kế mới vừa mang ảnh hưởng của việc lượng người
// chơi thay đổi theo ngày, và hai thứ đó không tách được.
//
// ⚠ CHỈ ĐỔI DỮ LIỆU LEVEL, KHÔNG ĐỔI LUẬT CHƠI (user 2026-08-17). Nhánh A dùng board + hàng
// xe của bản launch, còn mọi luật code thì cả hai nhánh dùng bản mới như nhau — kể cả
// `BURIED_FROM_LEVEL` (xe "?" chỉ từ L10, trong khi bản launch có xe "?" ngay từ L2). Nhờ vậy
// đúng MỘT biến thay đổi, và nếu A thua thì kết luận quy thẳng về thiết kế bàn được.
//
// Chia đôi CHỈ CHO NGƯỜI CHƠI MỚI. Người đã có tiến độ thì đã đi qua 15 bàn ấy rồi, đưa họ
// vào phép thử là thêm nhiễu chứ không thêm thông tin — họ mang nhãn "-" (ngoài thử nghiệm).
import { platform } from "../platform";

export type Variant = "A" | "B" | "-";

/** Phép thử chỉ phủ tới đây. Từ L16 trở đi hai nhánh chơi đúng một bộ level. */
export const AB_LAST_LEVEL = 15;

const KEY = "pf_ab";
let cached: Variant | null = null;

const isVariant = (v: unknown): v is Variant => v === "A" || v === "B" || v === "-";

/** Đọc THÔ: `null` = CHƯA GÁN, khác hẳn "-" = đã gán và đứng ngoài phép thử. */
function stored(): Variant | null {
  try {
    const v = platform.storage.getItem(KEY);
    return isVariant(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Nhánh của máy này. Chưa gán thì trả "-" và KHÔNG nhớ lại — gán là việc của `abAssign()`,
 * chạy sau khi kho dữ liệu đọc được; nhớ "-" ở đây là khoá cứng mọi người chơi ra ngoài
 * phép thử ngay từ lần đọc đầu tiên.
 */
export function abVariant(): Variant {
  if (cached) return cached;
  const v = stored();
  return v ? (cached = v) : "-";
}

/**
 * `?ab=A` / `?ab=B` — ép nhánh để tự kiểm, ghi lại nên máy đó ở luôn nhánh ấy tới khi
 * `?reset=all` xoá đi. Trả về nhánh đã ép, hoặc `null` nếu URL không nói gì.
 *
 * ⚠ TÁCH RIÊNG KHỎI `abAssign` và gọi SỚM. `?level=N` bỏ qua cả màn splash lẫn `abAssign`,
 * nên `?ab=A&level=2` mà chỉ có `abAssign` thì cờ không bao giờ được ghi và người kiểm nhìn
 * thấy bàn của nhánh B — im lặng, không có gì báo là đã bỏ qua.
 */
export function abApplyUrlOverride(): Variant | null {
  try {
    const forced = new URLSearchParams(location.search).get("ab");
    if (!isVariant(forced)) return null;
    platform.storage.setItem(KEY, forced);
    return (cached = forced);
  } catch {
    return null; // không có location / kho hỏng — coi như URL không nói gì
  }
}

/**
 * Gán nhánh MỘT LẦN cho mỗi máy, rồi giữ mãi.
 *
 * ⚠ GỌI SAU `platform.init()`. Trên CrazyGames kho dữ liệu của họ chỉ nạp xong lúc đó; gọi
 * sớm hơn là đọc bản cục bộ, thấy trống, và gán nhánh mới cho một người đã chơi từ lâu.
 *
 * `?ab=A` / `?ab=B` trên URL để tự kiểm — ghi đè và lưu lại, nên mở một lần là máy đó ở luôn
 * nhánh ấy cho tới khi `?reset=all` xoá đi.
 */
export function abAssign(isNewPlayer: boolean): Variant {
  const forced = abApplyUrlOverride();
  if (forced) return forced;
  const cur = stored();
  if (cur) return (cached = cur); // đã gán rồi thì giữ nguyên, kể cả "-"
  const v: Variant = !isNewPlayer ? "-" : Math.random() < 0.5 ? "A" : "B";
  try {
    platform.storage.setItem(KEY, v);
  } catch {
    /* ghi hỏng thì lần sau gán lại — thà thế còn hơn ném lỗi lúc khởi động */
  }
  return (cached = v);
}

/** Level này có phải lấy bản launch không. */
export function abUseLegacy(levelNum: number): boolean {
  return levelNum <= AB_LAST_LEVEL && abVariant() === "A";
}
