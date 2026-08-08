# Kế hoạch đưa "Hop In!" lên CrazyGames

Nguồn: docs.crazygames.com (đọc 2026-08-08). Mọi yêu cầu ghi ở đây đều trích từ tài
liệu chính thức, KHÔNG phải suy đoán. Điều khoản có thể đổi — đọc lại trước khi nộp.

Nguyên tắc xuyên suốt: **một codebase, một cờ build**. Không fork, không thư mục thứ hai.
Xem `ONE version, ONE folder, ONE branch` trong CLAUDE.md — bài học đó vẫn áp dụng.

---

## 0. Hiện trạng: đã đạt sẵn những gì

Kiểm bằng code, không phải phỏng đoán:

| Yêu cầu của họ | Trạng thái |
|---|---|
| Đường dẫn tương đối, cấm đường dẫn tuyệt đối | ✅ `vite.config.ts` `base: "./"` |
| Tải ban đầu ≤ 50MB (≤ 20MB để lên trang chủ mobile) | ✅ **6.2MB** — thừa sức |
| Tổng ≤ 250MB, ≤ 1500 file | ✅ |
| Vào được gameplay trong ≤ 20 giây | ✅ |
| Cấm nút fullscreen tự chế | ✅ không có |
| Cấm mạng quảng cáo ngoài | ✅ chưa có quảng cáo nào |
| Cấm hệ thống đăng nhập ngoài | ✅ không có |
| Game dọc + dải hai bên | ✅ `setPageBackground()` sơn dải theo màu scene |
| Chuột + chạm, không cần bàn phím | ✅ game chỉ có thao tác chạm |
| Vật lý ổn định ở mọi tần số quét | ✅ `main.ts` khoá `fps.limit = 60` |
| Tối đa 1 cú click trước gameplay | ⚠️ cần đo lại — xem §1.3 |

**Lợi thế cần giữ:** ngưỡng 20MB để được lên trang chủ bản mobile. Đa số game trên đó là
Unity WebGL và gần như luôn vượt ngưỡng này. Bản Phaser+Vite 6.2MB lọt thoải mái. Mọi
thay đổi sau này phải giữ `dist` dưới 20MB — đây là lợi thế cạnh tranh, không phải chi tiết vặt.

---

## Giai đoạn 0 — Khung nền tảng (không đụng logic game)

Mục tiêu: mọi thứ riêng của nền tảng nằm sau một cửa duy nhất.

- [ ] `VITE_TARGET=web|crazy|android`, mặc định `web`
- [ ] `src/platform/index.ts` — một interface duy nhất:
      `init()`, `loadingStart/Stop()`, `gameplayStart/Stop()`, `happytime()`,
      `interstitial()`, `rewarded(): Promise<boolean>`, `storage`
- [ ] Ba bản cài: `none.ts` (web tự host, toàn no-op), `crazy.ts`, `android.ts` (để sau)
- [ ] Chọn bản lúc build → Vite cắt chết hai bản còn lại

**Vì sao bắt buộc:** CrazyGames **cấm tuyệt đối quảng cáo bên thứ ba**. Bản nộp cho họ
không được lẫn một mẩu AdMob nào. Tách ở tầng build là cách duy nhất bảo đảm chắc chắn.
Thêm nữa `GameScene.ts` đã hơn 6400 dòng — rải `if (crazygames)` vào đó là không quản nổi.

---

## Giai đoạn 1 — Tuân thủ (đủ để nộp **Basic Launch**)

Họ có hai bậc: **Basic Launch** (không cần SDK, không kiếm tiền) và **Full Launch**
(bắt buộc SDK + kiếm tiền). Làm xong giai đoạn này là nộp Basic Launch được — qua vòng
QA chất lượng trước, chuyện tiền tính sau.

### 1.1 Khung iframe co giãn — **nhỏ hơn tưởng, sau khi khảo sát**

> Yêu cầu: game phải chạy được ở nhiều cỡ iframe, **800×450 đến 1920×1080**.

Khảo sát ngày 2026-08-08 (đếm bằng grep, không phải đoán):

| | |
|---|---|
| Chỗ dùng `GAME_H` | 69 (GameScene 49 · LevelSelect 14 · Splash 6) |
| Chỗ dùng `GAME_W` | 159 — **vô can**, `GAME_W` là hằng 480, không bao giờ đổi |
| Trình xử lý resize | **0** |

Điểm mấu chốt: **800×450 và 1920×1080 đều là 16:9** — cùng tỉ lệ, chỉ khác cỡ. Mà
`Phaser.Scale.FIT` vốn co giãn canvas theo cỡ khung và giữ nguyên tỉ lệ, nên toàn dải
này FIT đã lo sẵn. `GAME_H` chỉ phụ thuộc *tỉ lệ*, và tỉ lệ không đổi trong dải đó.

Nên hạng mục này là **kiểm chứng**, không phải viết lại.

- [x] Khung kiểm: `tools/iframe-test.html` — nhúng game ở 800×450, 1280×720,
      1920×1080 và 390×844. Chạy `npx vite preview` rồi mở file đó.
- [ ] **User nhìn bằng mắt** 4 khung đó (tôi không nhìn được màn hình)
- [ ] Khai orientation = portrait lúc nộp → họ tự xử lý việc xoay máy

Hạn chế còn lại, đã biết và chấp nhận: `_aspect` đọc một lần lúc nạp trang, nên kéo co
cửa sổ *giữa phiên* không tính lại bố cục — FIT vẫn co giãn đúng, chỉ là thừa viền.
Chỉ xử lý nếu QA của họ bắt lỗi.

### 1.2 Tiếng Anh là bắt buộc

> Yêu cầu: **bắt buộc có bản tiếng Anh**. Dò ngôn ngữ người dùng qua SDK, không dò được
> thì rơi về tiếng Anh.

`i18n.ts:7` đang là `let lang: Lang = "vi"`.

- [ ] Bản `crazy`: mặc định `en`, ưu tiên ngôn ngữ SDK trả về, rồi tới `pf_lang` đã lưu
- [ ] Bản `web`/`android`: giữ nguyên mặc định `vi` (đây là lựa chọn có chủ đích của user)
- [ ] Rà toàn bộ chuỗi còn cứng tiếng Việt — bản dịch sai/thiếu là lỗi QA

### 1.3 Vào thẳng gameplay

> Yêu cầu: đưa người chơi mới vào gameplay **ngay**; nếu không tránh được thì **tối đa
> một cú click**.

Luồng hiện tại: Splash (tự chuyển sau `MIN_MS`) → Home chọn màn → chạm màn → chơi.
Tức là đúng 1 click. **Có vẻ đạt**, nhưng phải tự kiểm bằng công cụ QA của họ trước khi nộp.

- [ ] Đo lại thật; nếu bị vặn thì cho người chơi mới vào thẳng màn 1, bỏ qua Home

### 1.4 CSS còn thiếu

> Yêu cầu: tắt `user-select` để không hiện kính lúp và menu chuột phải trên mobile.

`index.html:40` mới có `touch-action: none`.

- [ ] Thêm `user-select: none` + `-webkit-touch-callout: none`

### 1.5 Tự kiểm bằng công cụ của họ

- [ ] Chạy **Quality Assurance Tool** trong Developer Portal trước khi nộp

---

## Giai đoạn 2 — SDK, phần lõi (game module)

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```
```js
await window.CrazyGames.SDK.init();   // bất đồng bộ, phải await trước khi dùng
```

- [ ] Nạp SDK + `init()` trong lúc hiện màn splash
- [ ] `loadingStart()` / `loadingStop()` quanh phần nạp tài nguyên (SplashScene)
- [ ] `gameplayStart()` khi vào màn và khi bỏ tạm dừng
- [ ] `gameplayStop()` khi mở modal, tạm dừng, về Home, thắng/thua
- [ ] `happytime()` khi qua màn — dùng dè, chỉ cho khoảnh khắc đáng ăn mừng

`gameplayStart/Stop` không phải trang trí: đó là cách họ biết lúc nào **được phép chèn
quảng cáo**. Gọi sai chỗ là quảng cáo nhảy vào giữa lượt chơi.

---

## Giai đoạn 3 — Quảng cáo (Full Launch)

```js
window.CrazyGames.SDK.ad.requestAd("rewarded", { adStarted, adFinished, adError });
window.CrazyGames.SDK.ad.requestAd("midgame",  { adStarted, adFinished, adError });
```

### Luật cứng, sai là trượt QA

> "Phải **tắt tiếng và tạm dừng game** khi quảng cáo bắt đầu (`adStarted`), và **bật tiếng
> và chạy tiếp** khi quảng cáo kết thúc hoặc lỗi (`adFinished`, `adError`)."

- [ ] `adStarted` → dừng scene + tắt tiếng (đã có sẵn `pf_music` / `pf_sfx`)
- [ ] `adFinished` **và** `adError` → chạy tiếp + bật lại tiếng. **Cả hai nhánh**, nếu
      quên `adError` thì người chặn quảng cáo sẽ bị treo game vĩnh viễn.

### Mã lỗi phải xử lý

`adsDisabledBasicLaunch` · `unfilled` · `adblock` · `adCooldown` (giãn cách ~3 phút) · `other`

> "Game **bắt buộc phải chạy được** kể cả khi người dùng bật chặn quảng cáo."

- [ ] Rewarded thất bại ⇒ **vẫn cho phần thưởng hoặc vẫn chơi tiếp** — không bao giờ chặn đường
- [ ] Tôn trọng `adCooldown` ~3 phút: không mời xem quảng cáo khi biết chắc sẽ bị từ chối
- [ ] `hasAdblock()` chỉ dùng để chặn thứ *trang trí*, không được chặn lối chơi lõi

### Chỗ cắm — đều đã có sẵn UI, chỉ đổi nguồn trả giá

| Chỗ | Hiện tại | Thêm |
|---|---|---|
| Hồi sinh khi thua (`GameScene.ts:6348`) | trả bằng vàng | nút "xem quảng cáo để hồi sinh" |
| Hết tim (`src/game/lives.ts`) | chờ hồi theo giờ | xem quảng cáo lấy 1 tim |
| Booster trước màn | mua bằng vàng | xem quảng cáo lấy 1 lượt |
| Giữa các màn | — | `midgame` sau khi thắng/thua, **không bao giờ cắt giữa lượt** |

### Hệ thống tim — đã chốt và đã làm

User chốt 2026-08-08: **lần đầu hết tim thì mở 1 giờ chơi tự do**, sau giờ đó mới áp
cửa chặn bình thường. Cài ở `lives.ts` (`GRACE_MS`, `canEnterLevel()`, `graceMsLeft()`),
bật bằng `platform.graceOnEmpty` nên chỉ áp cho bản `crazy` — bản web tự host và Android
giữ nguyên luật cũ. Khoá lưu: `pf_grace_until` (0 = chưa từng mở).

Lý do: người ghé web game một lần rồi đi, gặp tường "hết tim, chờ 30 phút" là đóng tab
chứ không quay lại — và cái tường đó chống lại đúng thứ host yêu cầu, là cho người chơi
vào gameplay ngay.

### Không làm ở giai đoạn này

- **Mua trong game**: chỉ mở theo lời mời và bắt buộc dùng Xsolla. Bỏ qua.
- **Banner**: để sau, không bắt buộc.

---

## Giai đoạn 4 — Lưu tiến trình xuyên thiết bị (không bắt buộc, nhưng đáng làm)

Module `data` là **bản thay thế cắm-thẳng cho localStorage** — cùng dạng API.
Người chưa đăng nhập thì tự lưu máy, đăng nhập vào là dữ liệu khách tự chuyển sang tài khoản.
Giới hạn 1MB mỗi người.

- [ ] Bọc toàn bộ khoá `pf_*` qua `platform.storage` thay vì gọi thẳng `localStorage`
- [ ] Bật công tắc **"Progress Save"** lúc nộp — không bật thì module bị vô hiệu

Tiện thể xử luôn một món nợ: đổi tiền tố `pf_*` thành `hopin:*`. Nếu sau này có game thứ
hai chung tên miền, `pf_progress` sẽ đụng nhau. Sửa bây giờ rẻ, sửa sau khi có người chơi
là mất sạch tiến trình của họ.

---

## Giai đoạn 5 — Nộp

- [ ] Chạy Quality Assurance Tool, sửa hết cảnh báo
- [ ] Khai orientation = portrait, có hỗ trợ mobile
- [ ] Bật "Progress Save" nếu đã làm giai đoạn 4
- [ ] Xác nhận `dist` vẫn **dưới 20MB**
- [ ] Nộp Basic Launch → qua QA → xin Full Launch

---

## Ghi chú khác

**Bản quyền tranh — đã khép.** User xác nhận 2026-08-08: toàn bộ tranh là ảnh sinh bằng AI,
không phải clip-art tải về. Không còn là hạng mục rủi ro.

**Hỗ trợ kỹ thuật** từ CrazyGames chỉ mở khi tổng lượt chơi của bạn đạt 50.000.

---

## Thứ tự đề xuất

Giai đoạn 0 → 1 → nộp **Basic Launch** → lấy phản hồi QA → 2 → 3 → xin **Full Launch** → 4.

Lý do nộp Basic sớm: vòng QA của họ đánh giá chất lượng game, không đánh giá phần kiếm
tiền. Biết game có qua cửa hay không **trước khi** bỏ công làm SDK và quảng cáo.
