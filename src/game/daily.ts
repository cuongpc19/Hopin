// DAILY CHALLENGE — mỗi NGÀY NGƯỜI CHƠI VÀO CHƠI thì tiến một bậc trong một danh sách CỐ ĐỊNH.
//
// ⚠ KHÔNG PHẢI theo ngày lịch. Bản đầu tôi làm theo lịch (mọi người cùng ngày thì cùng một bàn),
// user 2026-08-15 chốt lại: "ngày 0 chơi thì user chơi level 511, ngày chơi 1 thì 535... và thứ
// tự cố định với các user". Nghĩa là mỗi người đi cùng một dãy nhưng theo NHỊP CỦA MÌNH — nghỉ
// ba ngày rồi quay lại thì vẫn nhận đúng bàn kế tiếp, không bị nhảy cóc mất ba bàn.
//
// Bộ này là 10 bàn KHÓ NHẤT trong 20 bàn 31×31 đẹp nhất của dải L401-586, chọn 2026-08-15: lọc
// bằng điểm đẹp còn 30, nhìn mắt chốt 20, rồi ĐO winrate thật (mô hình B, n=200) lấy 10 con thấp
// nhất. Chúng đã được TÁCH sang dải riêng 9001-9010, giữ đúng thứ tự khó dần:
//   9001←L511=26 · 9002←L535=27 · 9003←L555=27 · 9004←L508=29 · 9005←L550=31
//   9006←L497=32 · 9007←L435=33 · 9008←L570=38 · 9009←L580=41 · 9010←L567=76
//
// ⚠ MẤY CON SỐ TRÊN LÀ ĐỘ KHÓ HIỆN TẠI, CHƯA PHẢI ĐÍCH. User muốn cả bộ dưới 30%, mới 4 bàn đạt
// sẵn. Phần tune còn treo vì designed.json chỉ có MỘT bản mỗi level: kéo chúng xuống <30 là đổi
// luôn game chính (10 level rải rác L401-586 hoá rất khó, phần lớn là ô thường nên không có nhãn
// HARD). Cách kia là chép sang dải ngoài LEVEL_COUNT rồi tune bản chép. Chưa chốt.
//
// L567=76 lọt vào chỉ vì phải đủ 10: nhóm 20 bàn tách đôi rất rõ — 9 bàn dưới 41 rồi nhảy thẳng
// lên 76, không có bàn nào ở khoảng 42-75.
import { platform } from "../platform";

// ⚠ DẢI 9001-9010 NẰM NGOÀI TIẾN TRÌNH CHÍNH (user 2026-08-15: "daily challenge k liên quan gì
// đến level mà user đang chơi"). LEVEL_COUNT là 586 nên người chơi thường không bao giờ tới đây,
// và mười ô cũ (L511, L535, L555, L508, L550, L497, L435, L570, L580, L567) giờ TRỐNG trong
// designed.json — makeLevel() dựng tạm bản tự sinh cho chúng, user sẽ bổ sung sau.
//
// Vì sao 9001 chứ không phải 587: dải ngay sau LEVEL_COUNT sẽ bị nuốt ngay lần đầu game chính
// dài thêm, và lúc ấy hai bộ chồng số nhau mà chẳng có gì báo.
export const DAILY_LEVELS = [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010];

const K_IDX = "pf_daily_idx";   // đã đi tới bậc nào trong dãy
const K_DAY = "pf_daily_day";   // ngày lịch của lần chơi gần nhất — để biết đã sang ngày mới chưa
const K_RUN = "pf_daily_run";   // ván đang chơi CÓ PHẢI thử thách không (bậc lúc bấm huy hiệu)
const K_DONE = "pf_daily_done"; // bậc đã THẮNG — chip ✓ trên huy hiệu đọc cái này

/** Số ngày kể từ epoch theo giờ ĐỊA PHƯƠNG. Dùng thẳng Date.now()/86400000 là cắt ngày theo UTC,
 *  người chơi ở VN sẽ thấy đổi bàn lúc 7 giờ sáng chứ không phải nửa đêm. */
function today(now = new Date()): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
}

const read = (k: string): number | null => {
  try { const v = platform.storage.getItem(k); return v == null ? null : Number(v); } catch { return null; }
};
const write = (k: string, v: number) => { try { platform.storage.setItem(k, String(v)); } catch { /* ignore */ } };

/** Bậc hiện tại (0-based). Chưa chơi bao giờ → 0. */
export function dailyIndex(): number {
  const i = read(K_IDX);
  return i == null || !Number.isFinite(i) || i < 0 ? 0 : i;
}

/** Level của thử thách hiện tại. Chỉ ĐỌC — không làm tiến bậc. */
export function dailyLevel(): number {
  return DAILY_LEVELS[dailyIndex() % DAILY_LEVELS.length];
}

/** Còn thử thách mới trong hôm nay không (chưa chơi, hoặc đã sang ngày mới). */
export function dailyReady(now = new Date()): boolean {
  return read(K_DAY) !== today(now);
}

/**
 * Gọi NGAY TRƯỚC khi vào bàn thử thách.
 *
 * LUẬT DUY NHẤT: chỉ tiến bậc khi VÀO Ở MỘT NGÀY MỚI. Thắng hay thua KHÔNG liên quan gì —
 * user 2026-08-15 chốt rõ: "tiến bậc lúc vào lại ngày hôm sau, chứ không phải thắng thua".
 *
 * Hệ quả: trong cùng một ngày, thua rồi vào lại vẫn ĐÚNG BÀN ẤY và chơi lại thoải mái, không
 * mất lượt. Sang ngày mới mới sang bàn kế tiếp, dù hôm qua thắng hay thua.
 * Cũng vì thế, hàm này KHÔNG được gọi ở màn thắng/thua — chỉ gọi ở chỗ bấm vào huy hiệu.
 */
export function dailyEnter(now = new Date()): number {
  const d = today(now);
  if (read(K_DAY) !== d) {
    // Lần đầu tiên thì đứng ở bậc 0, KHÔNG cộng — nếu không người chơi mất luôn bàn đầu tiên.
    if (read(K_DAY) != null) write(K_IDX, dailyIndex() + 1);
    write(K_DAY, d);
  }
  write(K_RUN, dailyIndex()); // đánh dấu: ván sắp tới LÀ thử thách
  return dailyLevel();
}

/** Ván đang chơi có phải thử thách không. Chỉ dựa vào SỐ LEVEL là sai — người chơi hoàn toàn
 *  có thể tới đúng bàn ấy bằng đường chơi thường, và lúc đó không được tính là thử thách. */
export function dailyRunning(): boolean {
  return read(K_RUN) === dailyIndex();
}

/** CHƯA CHƠI THỬ THÁCH LẦN NÀO. Đọc dấu NGÀY chứ không đọc bậc: bậc 0 vừa là "chưa chơi" vừa
 *  là "đang ở bàn đầu tiên", nên nó không phân biệt được hai trạng thái. Dấu ngày chỉ được ghi
 *  ở dailyEnter(), tức chỉ khi thật sự đã vào một lần. */
export function dailyNeverPlayed(): boolean {
  return read(K_DAY) == null;
}

/** Bậc hiện tại ĐÃ THẮNG chưa. */
export function dailyDone(): boolean {
  return read(K_DONE) === dailyIndex();
}

/** Gọi lúc THẮNG. Chỉ đóng dấu nếu ván này thật sự là thử thách (vào từ huy hiệu). */
export function dailyNoteWin() {
  if (dailyRunning()) write(K_DONE, dailyIndex());
}

/**
 * ?daily=reset — xoá sạch trạng thái thử thách để test lại từ bậc 0.
 *
 * ⚠ PHẢI GỌI Ở MỌI MÀN CÓ THỂ LÀ MÀN ĐẦU. Bản đầu tôi chỉ đặt trong GameScene.create(), mà mở
 * game với tiến độ đã lưu thì màn đầu là HOME (LevelSelectScene) — GameScene không chạy, nên
 * tham số im lặng không làm gì (user 2026-08-15: "reset rồi mà k thấy icon highlight").
 *
 * ⚠ VÀ CHỈ CHẠY MỘT LẦN MỖI LẦN TẢI TRANG. Chuyển màn KHÔNG đổi URL, nên tham số vẫn còn đó:
 * Home xoá trạng thái → bấm huy hiệu → dailyEnter() ghi pf_daily_run → GameScene lại chạy reset
 * và XOÁ ĐÚNG CÁI CỜ VỪA GHI, thế là tiêu đề rơi về "LEVEL 511" (user 2026-08-15). Cờ dưới đây
 * là thứ chặn vòng thứ hai.
 */
let resetDone = false;
export function dailyResetFromUrl(): boolean {
  if (resetDone) return false;
  try {
    if (typeof location === "undefined") return false;
    if (new URLSearchParams(location.search).get("daily") !== "reset") return false;
    resetDone = true;
    for (const k of [K_IDX, K_DAY, K_RUN, K_DONE]) platform.storage.removeItem(k);
    return true;
  } catch { return false; }
}

/** Gọi khi rời bàn thử thách (về Home / sang level khác) để ván sau không bị tính nhầm. */
export function dailyClearRun() {
  try { platform.storage.removeItem(K_RUN); } catch { /* ignore */ }
}
