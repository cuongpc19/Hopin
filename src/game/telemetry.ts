// Ván chơi THẬT gửi về Firebase Realtime Database — nguồn dữ liệu duy nhất để hiệu chuẩn
// thước winrate bằng người chơi thật thay vì bot.
//
// Vì sao cần: `emitPlayLog` xưa nay POST vào `/api/hoplog`, mà endpoint đó CHỈ tồn tại trên
// máy dev (vite.config.ts). Mọi ván chơi trên bản deploy đều bốc hơi — fetch 404 rồi bị
// .catch nuốt im. Bản lưu trong localStorage thì nằm trên máy người chơi, không có cách nào
// lấy về từ người lạ.
//
// Chọn Realtime Database chứ không phải Firestore vì RTDB nhận JSON THÔ qua REST: một lời
// `fetch`, không SDK, không thêm một byte nào vào bundle. Firestore REST buộc phải bọc kiểu
// cho từng trường ({"integerValue":"30"}…) nên phải viết thêm lớp chuyển đổi ở cả hai đầu.
//
// Luật bảo mật trên RTDB: ghi được vào /runs và CHỈ chỗ đó, không đọc được gì. URL nằm lộ
// trong bundle — không tránh được với telemetry từ trình duyệt — nên phần đọc phải khoá.
//
// Lấy dữ liệu về: `node scripts/pull-runs.mjs` (xem file đó).
import { deviceId } from "./playlog";
import { platform } from "../platform";

const ENDPOINT =
  "https://hop-n-7d1af-default-rtdb.asia-southeast1.firebasedatabase.app/runs.json";

/**
 * Máy dev có làm bẩn dữ liệu không? Mặc định BỎ QUA localhost: mỗi lần tôi test một level
 * là một dòng rác lẫn vào số liệu người chơi thật, và chính chuyện lẫn dữ liệu lạc bản đã
 * từng làm hỏng một đợt hiệu chuẩn (LEVEL-DESIGN.md §2.5).
 * Thêm `?tele=1` vào URL để ép gửi khi cần thử chính đường ống này.
 */
function shouldSend(): boolean {
  try {
    if (new URLSearchParams(location.search).get("tele") === "1") return true;
    const h = location.hostname;
    return h !== "localhost" && h !== "127.0.0.1" && !h.endsWith(".local");
  } catch {
    return false; // không có location thì không đoán mò
  }
}

/**
 * Bắn một ván đã kết thúc. BẮN-RỒI-QUÊN: không await, không báo lỗi, không bao giờ chặn
 * game. Telemetry hỏng thì người chơi không được phép biết.
 *
 * `keepalive` để request vẫn đi tiếp khi người chơi đóng tab ngay sau màn thắng/thua —
 * đúng lúc dễ mất dữ liệu nhất.
 */
export function sendRun(summary: Record<string, unknown>) {
  if (!shouldSend()) return;
  try {
    const row = {
      ...summary,
      dev: deviceId(), // mã ngẫu nhiên mỗi máy — KHÔNG phải danh tính, xem trang privacy
      host: platform.name, // web | crazy | android — để tách nguồn lúc phân tích
      build: __APP_BUILD__, // hash commit: biết dòng này thuộc bản game nào
      at: Date.now(),
    };
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      keepalive: true,
    }).catch(() => {
      /* mạng hỏng / bị chặn — mất một dòng, không sao */
    });
  } catch {
    /* fetch không tồn tại — bỏ qua */
  }
}
