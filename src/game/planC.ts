// PHƯƠNG ÁN C — bộ level mở đầu thay thế, bật bằng `?planc=1` để chơi thử CẢ MẠCH L1→L35.
//
// ⚠ KHÔNG ĐỤNG VÀO LEVEL CHÍNH. Bàn của phương án C nằm ở dải riêng 9101-9148 trong
// designed.json; ở đây chỉ là bảng tra "level thật → bàn nào của bộ C". Tắt cờ đi là game trở
// lại y như cũ, nên có thể so hai bản cạnh nhau mà không phải build lại.
//
// Level nào KHÔNG có trong bảng thì giữ nguyên bàn hiện tại — đúng quy ước user đặt ở cột cuối
// file Manythings/phuong an C - Sheet1.csv (ô trống = giữ nguyên).
import planC from "../levels/planC.json";

const MAP = planC as Record<string, number>;

/**
 * BẬT MẶC ĐỊNH từ 2026-08-18 (user: "để phương án default là phương án C"). `?planc=0` tắt đi
 * để đối chiếu với bộ level cũ mà không phải build lại.
 */
let on: boolean | null = null;
export function planCActive(): boolean {
  if (on !== null) return on;
  try {
    on = typeof location === "undefined" || new URLSearchParams(location.search).get("planc") !== "0";
  } catch { on = true; }
  return on;
}

/** Số bàn của bộ C thay cho level này, hoặc null nếu level đó giữ nguyên. */
export function planCLevel(levelNum: number): number | null {
  if (!planCActive()) return null;
  return MAP[String(levelNum)] ?? null;
}

/**
 * Level ĐEO NHÃN KHÓ riêng trong phương án C (user 2026-08-18: "để level 5 và level 10, cảnh
 * báo user là level khó").
 *
 * Vì sao cần ngoại lệ thay vì sửa `levelDifficulty`: luật chung CỐ Ý bỏ L5 và L10 ra —
 * "chúng nằm trong khúc mở đầu, dán nhãn HARD lên đó là doạ người chơi ở đúng chỗ họ hay bỏ
 * nhất" (user 2026-08-13). Ở bản thường lý do đó vẫn đúng và luật giữ nguyên; chỉ phương án C
 * mới đặt bàn khó thật vào hai ô ấy — L5 nhận bàn của L10 cũ, L10 nhận bàn của L15 cũ (22 xe,
 * 40 ô lớp-2) — nên ở đó nhãn là nói thật chứ không phải doạ.
 */
const HARD_C = new Set([5, 10]);
export function planCHard(levelNum: number): boolean {
  return planCActive() && HARD_C.has(levelNum);
}

/** Bàn của level này lấy từ đâu — dùng cho nhãn kiểm tra ở bản dev. */
export function planCSource(levelNum: number): string {
  const to = planCLevel(levelNum);
  return to != null ? `C:${to}` : "goc";
}
