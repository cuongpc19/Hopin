// Google Analytics 4 — chỉ để có bảng "người đang chơi / quốc gia / phiên" trong Firebase
// console. KHÔNG dùng để đo winrate: số liệu đó nằm ở Realtime Database (`telemetry.ts`) vì
// GA lấy mẫu, trễ tới 24-48 giờ ở phần báo cáo, và không cho tải về từng ván một.
//
// ⚠ VÌ SAO KHÔNG DÙNG SDK CỦA FIREBASE. `firebase-app` + `firebase-analytics` nặng 31 KB (đã
// nén) NHÉT VÀO BUNDLE, rồi lúc chạy chúng vẫn kéo về `gtag.js` 145 KB — tức trả hai lần.
// Gọi thẳng gtag.js thì bundle không tăng một byte nào, và vẫn đúng property GA4 ấy vì cùng
// một measurement id. Bundle hiện 551 KB nén, mà thời gian vào được game là chỉ số CrazyGames
// chấm điểm, nên 31 KB không phải khoản vặt.
//
// ⚠ NẠP TRỄ, SAU KHI VÀO MÀN CHƠI. Nạp lúc khởi động là đặt một request 145 KB sang máy chủ
// khác đúng vào lúc mạng đang chật nhất — chính thứ SplashScene đã bỏ công cắt xuống.
//
// ⚠ CHẶN QUẢNG CÁO LÀ CHUYỆN BÌNH THƯỜNG. Script có thể không bao giờ tới; mọi thứ ở đây phải
// sống sót qua điều đó, im lặng, không ném lỗi (cùng luật với `crazy.ts`).
const ID = "G-WX6P6FZGHE";

type GtagArgs = [string, ...unknown[]];
declare global {
  interface Window { dataLayer?: GtagArgs[]; gtag?: (...args: GtagArgs) => void }
}

let started = false;

function gtag(...args: GtagArgs) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(args);
  } catch {
    /* không có window / bị chặn — kệ */
  }
}

/**
 * Nạp gtag.js. Gọi bao nhiêu lần cũng được, chỉ lần đầu có tác dụng.
 *
 * Bỏ qua trên localhost: mỗi lần vite nạp lại là một "người chơi" mới, đủ để làm hỏng đúng
 * con số ta muốn xem. Ván test vẫn được ghi vào Realtime Database như cũ (`telemetry.ts` cố ý
 * ghi tất rồi lọc lúc đọc) — chỉ GA là không.
 */
export function startAnalytics() {
  if (started) return;
  started = true;
  try {
    if (/^localhost$|^127\.|^\[::1\]$/.test(location.hostname)) return;
    const el = document.createElement("script");
    el.async = true;
    el.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    document.head.appendChild(el);
    gtag("js", new Date());
    // `transport_type: beacon` để sự kiện cuối cùng vẫn đi được khi người chơi đóng tab —
    // đúng lý do `sendRun` dùng keepalive.
    gtag("config", ID, { transport_type: "beacon" });
  } catch {
    /* không tạo được thẻ script — bỏ qua, game không được phép vỡ vì một trình theo dõi */
  }
}

/** Một sự kiện GA. An toàn khi gọi trước lúc script kịp tới: dataLayer nhận trước, gtag.js xử lý sau. */
export function track(name: string, params: Record<string, unknown> = {}) {
  if (!started) return;
  gtag("event", name, params);
}
