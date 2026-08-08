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
 * MỌI ván đều gửi, kể cả từ localhost (user 2026-08-08: "để test cũng được").
 *
 * Đổi lại, mỗi dòng mang theo TÊN MÁY CHỦ nó được chơi trên đó, để lúc phân tích tách được
 * ván test khỏi ván người chơi thật. Lọc lúc đọc chứ không chặn lúc ghi: chặn thì mất luôn,
 * còn lọc thì lúc nào muốn xem cũng còn. `scripts/pull-runs.mjs` mặc định bỏ máy nhà ra khỏi
 * bảng winrate, thêm `--all` để đếm tất.
 *
 * Vì sao phải tách: lẫn dữ liệu lạc bản chính là thứ đã làm hỏng một đợt hiệu chuẩn
 * (LEVEL-DESIGN.md §2.5) — 67 ván không rõ thuộc bản nào.
 */
function whereFrom(): string {
  try {
    return location.hostname || "?";
  } catch {
    return "?";
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
  try {
    const row = {
      ...summary,
      dev: deviceId(), // mã ngẫu nhiên mỗi máy — KHÔNG phải danh tính, xem trang privacy
      host: platform.name, // web | crazy | android
      from: whereFrom(), // tên máy chủ: localhost vs crazygames.com — xem whereFrom()
      build: __APP_BUILD__, // hash commit: biết dòng này thuộc bản game nào
      at: Date.now(), // lọc theo ngày là đủ để bỏ giai đoạn test trước khi ra mắt
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
