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

## Giai đoạn 2 — SDK, phần lõi (game module) ✅

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```
```js
await window.CrazyGames.SDK.init();   // bất đồng bộ, phải await trước khi dùng
```

- [x] Nạp SDK + `init()` trong lúc hiện màn splash (`SplashScene`), có **timeout 5 giây**:
      adblock chặn script thì không bao giờ bắn `onerror`, để mặc là treo màn chờ
- [x] `loadingStart()` / `loadingStop()`
- [x] `gameplayStart()` cuối `startLevel()` + khi hồi sinh
- [x] `gameplayStop()` khi thắng, thua, và khi rời scene (móc vào `shutdown` một lần,
      thay vì đuổi theo 6 chỗ gọi `scene.start("select")` rồi sót một chỗ)
- [x] `happytime()` khi qua màn
- [x] Ngôn ngữ lấy từ `SDK.user.systemInfo.locale`, ghi đè bằng `applyHostLang()` sau khi
      init xong (init bất đồng bộ nên chạy SAU lúc `i18n.ts` được nạp lần đầu)

**Thủ thuật đáng nhớ:** `tutPaused` đã đổi thành cặp getter/setter, và chính setter phát
`gameplayStop/Start`. Có 9 chỗ trong `GameScene` bật cờ này; làm ở tầng cờ nghĩa là chỗ
thứ 10 không thể quên. `gameplayStart/Stop` không phải trang trí — đó là cách host biết
lúc nào **được phép chèn quảng cáo**, gọi sai chỗ là quảng cáo nhảy vào giữa lượt chơi.

**Bất biến phải giữ:** mọi thứ trong `crazy.ts` phải sống sót khi SDK không bao giờ tới.
Kiểm bằng cách build `VITE_TARGET=web` rồi `grep crazygames` trong bundle — phải ra 0.

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

## Giai đoạn 4 — Lưu tiến trình: **APS lo hộ, không phải viết gì**

Lưu tiến trình là **bắt buộc**, không phải tuỳ chọn: *"Unless progress is not applicable for
your game, we require you to implement one of these methods."* Game này có tiến trình (level,
vàng, booster) nên không được miễn.

Nhưng có ba cách đáp ứng, và cách rẻ nhất **không cần một dòng code nào**:

| cách | công |
|---|---|
| **APS (Automatic Progress Save)** | **0** — họ tự sao lưu & khôi phục `localStorage` giữa các máy |
| Module `data` | bọc lại toàn bộ chỗ gọi `localStorage` |
| Backend riêng + module `user` | nhiều nhất |

Game đã lưu mọi thứ trong `localStorage` (`pf_*`), nên **APS bao trọn**. Tài liệu của họ nói
thẳng: *"there is no implementation required from your side"*.

**Đã chọn: module `data`** (user 2026-08-08). APS đủ cho Basic Launch nhưng phụ thuộc suy đoán
— tài liệu không nói rõ câu hỏi trong biểu mẫu ảnh hưởng thế nào tới APS — và **APS bị cấm với
game có mua trong game**, nên chọn `data` là đi thẳng tới đích.

- [x] `Platform.storage` (`src/platform/base.ts`) — cùng hình dạng `localStorage`
- [x] `crazy.ts` định tuyến sang `window.CrazyGames.SDK.data`; **ghi vào CẢ HAI** kho, để
      phiên nào SDK hỏng vẫn còn bản cục bộ mới, thay vì bản đóng băng từ lần SDK còn chạy
- [x] 51 chỗ gọi `localStorage` trong `src/` đã chuyển hết
- [x] `SplashScene` giữ Home cho tới khi `init()` xong — SDK **nạp sẵn dữ liệu người chơi
      lúc init**, đọc sớm hơn là ra bản cục bộ
- [ ] **Bật công tắc "Progress Save" lúc nộp** — không bật thì module `data` bị vô hiệu.
      Trong biểu mẫu chọn **"Yes, using the Data Module from the CrazyGames SDK"**.

⚠ **Ràng buộc thứ tự phải giữ:** `crazy.ts` `LOAD_TIMEOUT_MS` (2500) phải **nhỏ hơn**
`SplashScene` `CAP_MS` (3000). Trần của splash thả người chơi vào Home bất kể init xong chưa;
nếu trần bắn trước thì Home mở bằng bản **cục bộ**, và lần ghi kế tiếp sẽ nhân bản dữ liệu cũ
đè lên bản lưu thật trên máy chủ của người chơi.

⚠ **Nếu định đổi tiền tố `pf_*` → `hopin:*` thì phải làm TRƯỚC khi có người chơi.** APS sao lưu
nguyên si `localStorage`; đổi tên khoá sau khi ra mắt thì APS khôi phục khoá cũ mà game đọc
khoá mới → người chơi mất sạch tiến trình. Trước ngày ra mắt thì đổi thoải mái vì chưa ai có gì.

## Giai đoạn 4b — Ba chỉ số Basic Launch thật sự bị chấm

Basic Launch kết thúc khi game **sống ≥ 7 ngày VÀ đạt ≥ 500 lượt chơi**; không đủ 500 lượt thì
tự kết thúc sau **21 ngày**. Ba KPI:

| chỉ số | mức game tốt | trạng thái của ta |
|---|---|---|
| Thời lượng chơi trung bình / phiên | **10+ phút** | giờ chơi tự do (§3) phục vụ đúng cái này |
| Giữ chân ngày 1 | **10-15%** | localStorage + APS giữ tiến trình |
| Chuyển đổi (chơi ≥ 1 phút) | **80%+** | vào gameplay 1 chạm |
| Thời gian tải | **< 10 giây** | tải lần đầu 2.57 MB |
| Cỡ build | **< 20 MB** | **5.93 MB** ✓ |

Họ đo "thời gian tới lúc chơi" **tính đến lời gọi `gameplayStart`**, tức lúc chơi thật, không
phải lúc màn chờ hiện ra. Nghĩa là `MIN_MS = 3000` ở `SplashScene` — ba giây poster cố định,
kể cả khi tài nguyên đã nằm sẵn trong cache — bị tính thẳng vào chỉ số này.

---

## Giai đoạn 5 — Nộp Basic Launch

⚠ **Basic Launch KHÔNG chỉ là vòng duyệt chất lượng.** Đó là bản chạy thử **hai tuần với
lượng người chơi giới hạn**, và trong thời gian đó đội QA của họ theo dõi **số liệu gắn kết**:
thời lượng chơi trung bình, tỉ lệ vào được gameplay, tỉ lệ quay lại. Số liệu quyết định có
được lên Full Launch hay không. Đây là lý do giờ chơi tự do (§3) và việc vào thẳng gameplay
(§1.3) đáng giá hơn vẻ ngoài của chúng — chúng tác động thẳng vào đúng ba chỉ số đó.

### 5.1 Làm TRƯỚC khi nộp

- [ ] **Thiết lập phương thức nhận tiền** — phải xong TRƯỚC khi nộp, không phải sau
- [ ] Tạo tài khoản ở Developer Portal
- [ ] Chạy **Quality Assurance Tool** trong portal, sửa hết cảnh báo

### 5.2 Gói build

```bash
rm -f dist/iframe-test.html          # khung test cục bộ, KHÔNG được lẫn vào gói nộp
VITE_TARGET=crazy npm run build
```
⚠ **KHÔNG nén.** Ô tải lên của họ từ chối file nén — báo đúng chữ *"Archive files are not
supported, please drag and drop the files directly in the upload zone"*. Kéo thẳng thư mục
`dist/` vào ô đó; trình duyệt giữ nguyên cây thư mục con.

Mục này trước đây hướng dẫn nén và đã làm mất công hai lần (2026-08-10 và 2026-08-13).
`npm run zip` vẫn giữ lại vì bản Android/tự host còn dùng, chỉ là không dùng cho CrazyGames.

Kiểm lại bốn giới hạn cứng trước khi tải lên:

```bash
find dist -type f | wc -l                  # ≤ 1500
du -sb dist                                # ≤ 250MB
du -cb dist/index.html dist/assets dist/fonts | tail -1   # ≤ 20MB → đủ điều kiện trang chủ mobile
grep -oE '(src|href)="/[^"]*"' dist/index.html            # phải RỖNG: cấm đường dẫn tuyệt đối
```

Đo 2026-08-08: 98 file · 5.93 MB · tải lần đầu 2.57 MB · không có đường dẫn tuyệt đối.

### 5.3 Khai trong hồ sơ

- [x] **Game engine = HTML5** (không phải "Externally hosted (iframe)" — cái đó dành cho
      game tự host rồi cho họ nhúng)
- [ ] Orientation = **portrait**, tick **"The game supports mobile"**
- [ ] Tick **"The game supports CrazyGames muting audio through SDK"** — đã cài, xem §2
- [ ] KHÔNG tick "The game is an online game" (không có multiplayer)
- [ ] "Does your game save progress?" → **"Yes, using the Data Module"**, và bật công tắc
      **Progress Save** (không bật thì module `data` bị vô hiệu)
- [ ] Mô tả game + phần điều khiển (**bắt buộc tiếng Anh** — bản nháp ở §5.4)
- [x] Ba ảnh bìa: `store/crazygames/` (1920×1080 · 800×1200 · 800×800)
- [ ] **Video preview — CHƯA CÓ, đây là thứ duy nhất còn chặn việc nộp**
- [ ] URL Chính sách bảo mật (bắt buộc vì đã có telemetry — xem §6)

⚠ **Đừng đặt link chính sách bảo mật TRONG game.** CrazyGames cấm link ra ngoài. URL đó chỉ
điền vào biểu mẫu nộp, không nhúng vào giao diện game.

## Giai đoạn 6 — Telemetry + Chính sách bảo mật

**Telemetry** (`src/game/telemetry.ts`, xong 2026-08-08): mỗi ván kết thúc gửi một dòng về
Firebase Realtime Database. Trước đó mọi ván đều mất trắng — `/api/hoplog` chỉ tồn tại trên
máy dev nên bản deploy nào cũng 404 rồi bị `.catch` nuốt.

- Chọn RTDB chứ không Firestore: RTDB nhận JSON thô qua REST → một `fetch`, **0 byte** thêm
  vào bundle. Firestore REST buộc bọc kiểu từng trường, phải viết lớp chuyển đổi hai đầu.
- Luật đã kiểm bằng thật: ghi `/runs` được · đọc `/runs` bị chặn · ghi chỗ khác bị chặn.
  URL nằm lộ trong bundle (không tránh được với telemetry trình duyệt) nên phải khoá đọc.
- Mỗi dòng mang **vân tay level** → `--fit` biết ván đó chơi trên bản game nào (§2.5).
- Gửi từ MỌI nguồn kể cả localhost (user 2026-08-08). Tách ván test bằng trường `from`
  (tên máy chủ) — lọc theo ngày không đủ vì sau khi ra mắt vẫn test song song.

```bash
FB_SECRET=<khoá> node scripts/pull-runs.mjs           # xem winrate thật
FB_SECRET=<khoá> node scripts/pull-runs.mjs --write   # gộp vào playlog.jsonl
node scripts/winrate-cal.mjs --fit                     # hiệu chuẩn lại thước
```

Khoá lấy ở Firebase console → ⚙ Project settings → Service accounts → Database secrets.
**Đừng commit khoá đó.**

**Chính sách bảo mật** (`site/privacy.html`, song ngữ): bắt buộc vì quy định của họ yêu cầu
game thu thập dữ liệu ngoài sự kiện SDK phải có. Đặt trên **Firebase Hosting**, không phải
GitHub Pages — Pages cần gói trả phí khi repo private.

```bash
npx firebase-tools login
npx firebase-tools deploy --only hosting
# → https://hop-n-7d1af.web.app/privacy.html
```

⚠ Còn chỗ trống `[your contact email here]` trong cả hai bản ngôn ngữ — **điền trước khi đăng**.

### 5.4 Bản nháp chữ cho hồ sơ

**Tên:** Hop In!

**Mô tả ngắn:**
> Tap a car, send it around the track, and watch it scoop up every slime of its colour.

**Mô tả dài:**
> Cute cars circle a board of coloured slimes, peeling a hidden picture from the outside in.
> Tap a car to send it out — but careful, launching a car locks its bay until it comes back
> full. Every tap is a commitment. Read the queue, pick your moment, and clear the picture
> before you run out of room.
>
> · 190+ hand-designed levels, each one a different picture
> · Boosters to dig you out of trouble: Add a bay, Grab any car, Shuffle the queue, Magnet
> · Rock walls, stacked slimes and linked twin cars keep the later levels honest
> · One-thumb play — no timers on your first hour

**Điều khiển:**
> Tap or click a car to send it onto the track. That's it — no keyboard needed.

### 5.5 Sau khi nộp

Đội QA chơi thử và phản hồi thường trong **1-2 ngày**, kèm ảnh chụp chỉ đúng chỗ cần sửa.
Sửa xong thì mất thêm khoảng **hai ngày** để họ chuẩn bị phát hành.

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
