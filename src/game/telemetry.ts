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
import { abVariant } from "./ab";

const DB = "https://hop-n-7d1af-default-rtdb.asia-southeast1.firebasedatabase.app";
const ENDPOINT = `${DB}/runs.json`;
/**
 * PHIÊN CHƠI — node RIÊNG, không trộn vào /runs.
 *
 * Vì sao phải có: /runs chỉ nhận một dòng khi một ván KẾT THÚC, nên người mở game rồi bỏ đi
 * giữa màn đầu không để lại dấu vết nào. Đó lại đúng là nhóm mà "tỉ lệ chơi quá 1 phút" và
 * phễu đầu game nói về — đo bằng /runs là đo trên tập đã sống sót.
 *
 * Node riêng chứ không thêm `ev` vào /runs: `stats.html`, `level-stats.mjs` và `pull-runs.mjs`
 * đều coi mọi dòng trong /runs là một ván có `lvl`, nên nhét dòng khác kiểu vào đó là làm sai
 * mọi con số đang chạy.
 */
const SESSION_ENDPOINT = `${DB}/sessions.json`;

/**
 * Trang chính sách bảo mật (Firebase Hosting).
 *
 * Nằm CẠNH endpoint telemetry một cách có chủ ý: hễ đổi thứ game gửi đi thì trang này phải
 * đổi theo, và để hai thứ cạnh nhau thì khó quên hơn.
 */
export const PRIVACY_URL = "https://hop-n-7d1af.web.app/privacy.html";

/**
 * Mở trang chính sách ở TAB MỚI. CrazyGames bắt buộc game nào thu thập dữ liệu ngoài sự kiện
 * SDK của họ thì phải hiện thông báo ngay trong game — khai ở biểu mẫu nộp là chưa đủ.
 *
 * Tab mới chứ không điều hướng: game đang chạy trong iframe của họ, chuyển trang tại chỗ là
 * đá người chơi ra khỏi ván đang chơi.
 */
export function openPrivacyPolicy() {
  try {
    window.open(PRIVACY_URL, "_blank", "noopener,noreferrer");
  } catch {
    /* trình duyệt chặn popup — không làm gì, đừng để game vỡ vì một cái link */
  }
}

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
      ab: abVariant(), // A = 15 màn đầu bản launch · B = bản hiện tại · "-" = ngoài phép thử
      at: Date.now(), // lọc theo ngày là đủ để bỏ giai đoạn test trước khi ra mắt
    };
    post(ENDPOINT, row);
  } catch {
    /* fetch không tồn tại — bỏ qua */
  }
}

/** BẮN-RỒI-QUÊN dùng chung cho cả hai node. `keepalive` để dòng cuối vẫn đi khi tab đóng. */
function post(url: string, row: Record<string, unknown>) {
  try {
    void fetch(url, {
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

// ---- PHIÊN CHƠI -----------------------------------------------------------------------------
// Ba dòng cho mỗi lần mở game, không hơn:
//   start — vào tới Home / màn chơi (splash không tính: ở đó chưa chơi gì)
//   min1  — vẫn còn ở đó sau 60 giây. Đây CHÍNH LÀ "tỉ lệ chơi quá 1 phút": đếm số dòng này
//           chia cho số dòng `start`, không phải suy ra từ thời lượng của ván.
//   end   — rời trang, mang theo tổng thời gian và đã vào những level nào
//
// Vì sao `min1` là một dòng riêng chứ không đọc `ms` của `end`: dòng `end` là dòng dễ mất nhất
// (đóng tab, khoá máy, iOS đình chỉ tab) và mất đúng ở nhóm rời sớm. Mốc 60 giây thì tự nó gửi
// khi tới hạn, nên tỉ lệ trên vẫn đúng kể cả khi mọi dòng `end` biến mất.
let sessionOn = false;
let sessionT0 = 0;
let sessionEnded = false;
const sessionLevels = new Set<number>();

function sessionRow(ev: string, extra: Record<string, unknown> = {}) {
  post(SESSION_ENDPOINT, {
    ev,
    dev: deviceId(),
    ab: abVariant(),
    host: platform.name,
    from: whereFrom(),
    build: __APP_BUILD__,
    at: Date.now(),
    ...extra,
  });
}

/**
 * Mở một phiên. Gọi bao nhiêu lần cũng được, chỉ lần đầu có tác dụng.
 *
 * ⚠ GỌI SAU `abAssign()`. Gọi trước thì dòng `start` mang nhãn "-" còn dòng `end` mang nhãn
 * thật, và mọi tỉ lệ tính theo nhánh đều lệch mẫu số.
 */
export function startSession() {
  if (sessionOn) return;
  sessionOn = true;
  sessionT0 = Date.now();
  sessionRow("start");
  try {
    setTimeout(() => { if (!sessionEnded) sessionRow("min1", { ms: Date.now() - sessionT0 }); }, 60_000);
    const end = () => {
      if (sessionEnded) return;
      sessionEnded = true;
      sessionRow("end", {
        ms: Date.now() - sessionT0,
        lvls: sessionLevels.size,
        maxLvl: sessionLevels.size ? Math.max(...sessionLevels) : 0,
      });
    };
    // `pagehide` bắt được cả lúc trang bị đưa vào bộ nhớ đệm quay-lui, thứ `unload` bỏ sót và
    // là cách iOS Safari kết thúc phần lớn phiên. `visibilitychange` là lưới thứ hai cho
    // Android, nơi chuyển ứng dụng KHÔNG kích hoạt pagehide.
    window.addEventListener("pagehide", end);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") end(); });
  } catch {
    /* không có window/document — bỏ qua, dòng `start` đã đi rồi */
  }
}

/** Ghi nhận người chơi đã VÀO một level (thắng thua không liên quan) — cho dòng `end`. */
export function noteSessionLevel(lvl: number) {
  sessionLevels.add(lvl);
}
