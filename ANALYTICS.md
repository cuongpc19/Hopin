# Xem chỉ số game — Firebase Analytics & bảng riêng

Hướng dẫn cho user (2026-08-14). Có **hai** nguồn số liệu, dùng cho hai việc khác nhau. Nhầm
nguồn là ra kết luận sai, nên đọc mục 0 trước.

---

## 0. Dùng nguồn nào cho câu hỏi nào

| câu hỏi | nguồn | vì sao |
|---|---|---|
| Đang có bao nhiêu người chơi? Ở nước nào? | **Firebase Analytics** | GA tra quốc gia theo IP; ta không có dữ liệu đó |
| Phiên dài bao lâu, bao nhiêu người quay lại theo tuần/tháng | **Firebase Analytics** | GA tự dựng, không phải tính tay |
| **Winrate của level N** | **`hop-n-7d1af.web.app/stats.html`** | xem cảnh báo bên dưới |
| Người chơi rụng ở level nào | **stats.html** | GA không biết level nào là level nào sau khi dựng lại |
| Ai dùng booster / hồi sinh | **stats.html** | GA hiện không nhận hai thứ này (xem §5) |

> ⚠ **ĐỪNG đo winrate bằng GA.** Log chỉ ghi *số* level; khi một level được dựng lại thì ván
> của bản cũ vẫn nằm dưới cùng con số ấy. `stats.html` mang theo **vân tay level** và cảnh báo
> khi một level có nhiều hơn một bản trong khoảng đang xem — GA không có khái niệm đó, nó sẽ
> gộp hai thiết kế khác nhau thành một con số trông rất thuyết phục. Đây đúng là chuyện đã làm
> hỏng một đợt hiệu chuẩn trước đây (`LEVEL-DESIGN.md` §2.5).

---

## 1. Ba màn hình, ba độ trễ — nhớ cái này trước khi hoảng

Firebase console → **Analytics** ở cột trái:

| màn hình | độ trễ | dùng khi |
|---|---|---|
| **Realtime** | ~1 phút | vừa up bản mới, muốn biết có chạy không |
| **DebugView** | tức thì | tự mình test, xem từng sự kiện một (§6) |
| **Dashboard** / mọi báo cáo | **24-48 giờ** | xem xu hướng |

**Bảng Dashboard hiện 0 không có nghĩa là hỏng.** Nó tổng hợp mỗi ngày một lần. Ngày đầu tiên
sau khi bật Analytics thì mọi ô đều 0 dù dữ liệu đang chảy — cứ mở Realtime để kiểm chứng.

Nút **"View more in Google Analytics"** ở góc trên mở giao diện GA4 đầy đủ, nơi có báo cáo mà
Firebase console không hiện: Retention, Funnel, so sánh nhiều đoạn.

---

## 2. Xem nhanh từng chỉ số

**Có bao nhiêu người đang chơi, ở đâu**
`Analytics → Realtime`. Ô "Active users in last 30 minutes", biểu đồ theo phút, bảng "Top
countries". Đây chính là cái card bạn hỏi hôm 14/8.

**Số người chơi theo ngày / tuần / tháng (DAU, WAU, MAU)**
`Analytics → Dashboard`, ô "Active users". Hoặc GA4 → `Reports → Life cycle → Engagement →
Overview`.

**Phiên chơi dài bao lâu**
GA4 → `Reports → Engagement → Overview`: "Average engagement time per active user".
⚠ Con số này chỉ tính lúc tab đang được nhìn. Người chơi mở tab khác thì đồng hồ dừng.

**Người quay lại**
GA4 → `Reports → Retention`. Cần vài ngày dữ liệu mới có hình. Muốn xem ngay thì dùng cột
"% quay lại" ở `stats.html` (nhưng đọc kỹ cảnh báo ghi ngay dưới bảng đó).

**Nguồn người chơi đến từ đâu**
GA4 → `Reports → Acquisition`. Game chạy trong iframe của CrazyGames nên `page_location` sẽ là
`hop-in-yvm.game-files.crazygames.com`, còn referrer là trang CrazyGames.

---

## 3. Xem theo LEVEL — phải khai báo trước, không thì không thấy gì

Game gửi hai sự kiện riêng (xem `src/game/analytics.ts`):

| sự kiện | tham số | bắn khi |
|---|---|---|
| `level_start` | `level` (số), `tier` (`normal`/`hard`/`superhard`) | vào màn |
| `level_end` | `level`, `result` (`win`/`lose`), `seconds` | thắng hoặc thua |

Cộng thêm các sự kiện GA tự thu: `first_visit`, `session_start`, `page_view`, `user_engagement`.

Vào `Analytics → Events` là thấy **số lần** mỗi sự kiện xảy ra. Nhưng muốn tách theo level thì
phải làm thêm một bước, **nếu không GA sẽ không bao giờ hiện tham số**:

> **Khai báo custom dimension**
> GA4 → `Admin` (bánh răng góc dưới trái) → `Custom definitions` → `Create custom dimension`
> - Dimension name: `level` · Scope: **Event** · Event parameter: `level`
> - Làm tương tự cho `tier` và `result`.
>
> ⚠ **Chỉ có tác dụng từ lúc khai báo trở đi.** GA không hồi tố dữ liệu cũ, nên khai càng sớm
> càng tốt. Và phải chờ 24-48 giờ mới thấy trong báo cáo.

Khai xong thì GA4 → `Explore → Free form`, kéo `level` vào Rows, `Event count` vào Values, lọc
`Event name = level_start` → ra bảng số lượt chơi từng level.

---

## 4. Sự kiện tự thêm — một dòng code

Trong `src/scenes/GameScene.ts`:

```ts
track("ten_su_kien", { tham_so: giá_trị });
```

Luật của GA4 phải theo, không thì sự kiện bị bỏ im lặng:
- tên sự kiện và tên tham số: **≤ 40 ký tự**, chỉ chữ/số/gạch dưới, không bắt đầu bằng số;
- giá trị chuỗi **≤ 100 ký tự**;
- tối đa **25 tham số** cho một sự kiện;
- tên bắt đầu bằng `firebase_`, `google_`, `ga_` là **cấm**.

Thêm xong nhớ quay lại §3 khai báo custom dimension cho tham số mới.

---

## 5. GA hiện KHÔNG nhận những thứ này

Cố ý, để bản gửi đi gọn nhẹ. Muốn có thì phải thêm `track(...)` rồi build lại và up lên
CrazyGames:

- dùng booster nào (`add` / `hand` / `refresh` / `magnet`)
- có hồi sinh hay không, hồi sinh mấy lần
- số xu, số lượt bấm, số ô chờ dùng tới đỉnh điểm
- vân tay bản level

Tất cả những thứ này **đã có sẵn** ở Realtime Database, xem được ngay tại `stats.html`, nên
chỉ thêm vào GA nếu bạn thật sự muốn cắt lát chúng theo quốc gia hay theo phiên.

---

## 6. Tự kiểm khi nghi có gì đó hỏng

**Bước 1 — script có tới nơi không.** Mỗi ván gửi về Realtime Database kèm trường `ga`:
`1` = `gtag.js` tải được, `0` = bị chặn (adblock hoặc CSP của trang chủ). Xem nhanh:

```bash
MSYS_NO_PATHCONV=1 npx firebase-tools database:get /runs --order-by-key --limit-to-last 10
```

`ga` toàn `0` → không phải lỗi code, mà là script bị chặn; lúc đó GA không cứu được, phải dùng
`stats.html`. Không có trường `ga` → người chơi đang ở bản build cũ.

**Bước 2 — DebugView, xem từng sự kiện tức thì.**
Mở game với `?debug_mode=1` hoặc bật `gtag('set', {debug_mode: true})`, rồi vào
`Analytics → DebugView`. Sự kiện hiện trong vài giây, kèm đủ tham số — đây là cách nhanh nhất
để biết một `track(...)` mới có đi hay không mà không phải chờ 24 giờ.

**Bước 3 — hai lỗi đã từng mắc, đừng mắc lại:**

1. **Đẩy mảng vào `dataLayer` thay vì `arguments`.** gtag.js chỉ xử lý phần tử là đối tượng
   `arguments`; mảng thật bị nó coi là push kiểu GTM và **bỏ qua trong im lặng** — không lỗi,
   không cảnh báo. Hàm `gtag` trong `analytics.ts` bắt buộc là `function` thường.
2. **Bật Analytics ở console rồi tưởng là xong.** Bật chỉ tạo ra property GA4 rỗng; không có
   sự kiện nào gửi lên thì mọi ô vẫn là 0.

---

## 7. Chi phí và quyền riêng tư — đừng phá vỡ hai thứ này

- `gtag.js` **không nằm trong bundle**, nó được nạp lúc người chơi **vào tới màn chơi** chứ
  không phải lúc mở game. Đây là chủ ý: thời gian vào được game là chỉ số CrazyGames chấm
  điểm, và một request 145 KB lúc khởi động là đúng thứ `SplashScene` đã bỏ công cắt đi. Đừng
  chuyển lời gọi `startAnalytics()` lên sớm hơn.
- **Bỏ qua trên localhost**, không thì mỗi lần vite nạp lại là một "người chơi" mới.
- Trang `site/privacy.html` **phải khớp** với những gì thật sự được thu. Nó đang nêu đích danh
  Google Analytics, ghi rõ thu gì và việc Google suy ra quốc gia từ IP. Thêm dữ liệu mới vào
  GA thì phải sửa trang đó cùng lúc — CrazyGames bắt buộc khai báo đúng.

---

## 8. Số liệu nào KHÔNG có ở đâu cả

Log chỉ được ghi khi một ván **kết thúc**. Ai mở game rồi thoát giữa màn đầu không xuất hiện
trong Realtime Database. GA thì có (`first_visit` / `session_start` bắn ngay khi vào màn), nên
với câu hỏi "bao nhiêu người mở game rồi bỏ ngay" thì GA là nguồn duy nhất — cộng với bảng của
chính CrazyGames.
