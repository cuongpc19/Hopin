# Quy tắc dựng level (SLAM) — đọc TRƯỚC khi đụng vào level

Tài liệu này viết cho phiên làm việc sau, để không lặp lại những lỗi đã mất hàng giờ ở phiên
2026-08-05/06. Đọc hết phần 0 → 3 trước khi chạy bất cứ script nào. Phần 8 là danh sách lỗi
đã mắc, đọc để khỏi mắc lại. Phần 9 là runbook.

Tài liệu bổ trợ:
- `FEATURES.txt` §13, §20, §35 — nhật ký tính năng (tiếng Việt).
- `Manythings/Design level/level-design-guide.md` — guide của user về *cảm giác* level
  (thư mục `Manythings/` bị gitignore nên chỉ có trên máy user).
- `CLAUDE.md` — luật hình ảnh của board.

---

## 0. Bốn điều bất khả xâm phạm

**0.1 — ART LÀ CỦA USER, KHÔNG ĐƯỢC SỬA.** `board[]` của mọi level là bất khả xâm phạm trừ khi
user nói rõ tên level được đổi. Điều này gồm cả những thứ trông như "dọn dẹp": gộp đốm lẻ, khử
nhiễu, đổi màu nền, xoá ô mồ côi.

**Mốc art hiện tại: `99ae5c9`** (trước đó là `6627197`). Mốc này DI CHUYỂN mỗi khi user duyệt
một đợt art mới, nên đừng hardcode nó vào đầu; lấy commit cuối cùng chạm vào `board[]`:

```bash
git log --oneline -5 -- src/levels/designed.json
```

⚠ **Art có thể đổi GIỮA CHỪNG một đợt tune.** Ngày 2026-08-06 chuyện đó đã xảy ra: một phiên
khác đổi art 12 level, trong đó 9 level **đổi cả cỡ lưới** (39×39 ↔ 25×25), làm toàn bộ hàng xe
dựng dở của tôi thành rác — số ô khác thì bất biến ghế=ô sai ngay. Vì vậy:
- `git fetch` và so với `origin/main` TRƯỚC khi bắt đầu một đợt quét dài;
- nếu remote có commit mới chạm `designed.json`, pull trước rồi mới quét;
- board đổi cỡ lưới thì hàng xe cũ **không cứu được**, phải dựng lại từ đầu.

Kiểm tra sau MỌI lần ghi file (thay `<mốc art>` bằng commit lấy ở lệnh trên):

```bash
node -e "const fs=require('fs'),cp=require('child_process');
const C=JSON.parse(fs.readFileSync('src/levels/designed.json','utf8'));
const O=JSON.parse(cp.execSync('git show <mốc art>:src/levels/designed.json',{encoding:'utf8',maxBuffer:1e9}));
const c=C.levels||C,o=O.levels||O,diff=[];
for(const k of Object.keys(o)) if(c[k]&&JSON.stringify(o[k].board)!==JSON.stringify(c[k].board)) diff.push(k);
console.log('board doi:',diff.length?diff.join(','):'khong co');"
```

Phiên trước tôi chạy `despeckle` lên toàn bộ board để level đầu dễ hơn — 12% số ô bị đổi, có
level tới 37%, con gấu L2 mất mặt, con hổ L23 loang lổ. Tệ hơn: tôi **báo cáo là tranh đẹp
lên**, vì tôi so bản đã sửa với bản đã sửa trên một tấm contact sheet 3px/ô, chứ không so với
nguồn. Bài học: muốn đánh giá tranh thì render đúng cỡ và so với `git show <commit>:file`.

**0.2 — BẤT BIẾN GHẾ = Ô.** Với mỗi màu: tổng sức chứa xe phải **bằng đúng** số ô của màu đó
trên board, tính cả ô lớp 2. Xe chỉ rời bay khi đầy 100%, nên lệch một ô là level không thể
thắng. Chạy sau mỗi lần ghi:

```bash
node scripts/check-seats.mjs
```

L11 và L16 ở bản `6627197` hỏng bất biến (hàng xe thuộc về một board khác: L11 có 102 ghế màu
id9 mà board không có ô nào màu đó) — hai level đó **không thể thắng** và không ai phát hiện
cho tới khi có script này. L51 vẫn đang hỏng, chưa sửa.

**0.3 — MỖI THAY ĐỔI PHẢI ĐƯỢC ĐO.** Không có "sửa nhỏ vô hại". Đổi cỡ xe, gộp xe, đổi thứ tự
— tất cả đều có thể biến level thành bất khả thi. Guide §2e đã cảnh báo và thực tế xác nhận
nhiều lần.

**0.4 — KHÔNG BÁO CÁO ĐIỀU CHƯA ĐO.** Con số duy nhất được phép nói ra là con số đo trên
**file đã ghi**, không phải con số từ lúc quét thang (bộ dựng có thể thêm xe đôi / xe `?` sau
khi đo).

---

## 1. Cơ chế thật của game (phải hiểu trước khi chỉnh)

### 1.1 Vòng chạy

Board là lưới ô màu. Một con đường vuông chạy quanh board. Xe rời bay → chạy CCW trên đường →
từ mỗi lane bắn **3 tia** (thẳng + 2 chéo lệch 1 lane) vào board → tia dừng ở ô có tile đầu
tiên. Nếu ô đó đúng màu xe thì ăn. Xe đầy thì rời board.

Thứ tự lane (`simcore.laneSeq`): bottom trái→phải, right dưới→trên, top phải→trái, left
trên→dưới.

### 1.2 SLAM = khoá bay

Bấm vào xe ở ô chờ → xe ra đường VÀ **khoá bay đó** cho tới khi xe đầy hoặc quay về. Hết chỗ
mà không xe nào ăn được gì = thua. Đây là cơ chế chính, mọi level đều `slam: true`.

### 1.3 Ô chờ xếp theo CỘT — chi tiết này quyết định xe đôi

`GameScene.buildInventory`: `invColumns[i % perRow].push(view)` với `perRow = level.lanes ?? 4`.

Nghĩa là mảng `chests` được điền **theo hàng**, mỗi cột là một chồng người chơi rút từ trên
xuống:

```
chests[0] chests[1] chests[2] chests[3]   ← hàng 1 (người chơi nhìn thấy)
chests[4] chests[5] chests[6] chests[7]   ← hàng 2
chests[8] ...                              ← hàng 3
```

Hàng r (đếm từ 1) = `chests[(r-1)*lanes … r*lanes-1]`. User nói "độ khó chủ yếu từ xe hàng
thứ 3 đến hàng thứ 5" nghĩa là `chests[8..19]` với lanes=4.

**Hệ quả cho xe đôi:** cột tiêu thụ độc lập nhau, nên một cặp **dọc cùng cột** (chênh nhau
đúng `lanes` chỉ số) không bao giờ bị giãn dây. Cặp ngang có thể tách ra khi một cột chạy
nhanh hơn cột kia → dây kéo dài → user báo "không nhìn thấy dây". `design-core.twinShape`
chấm điểm hình dạng: 3 = dọc (an toàn nhất), 2 = ngang liền kề, 1 = có xe chen giữa.

### 1.4 Ba loại vật cản

| loại | lưu ở | tia | ăn được |
|---|---|---|---|
| slime thường | `board[i]` = id màu (0-89) | dừng | có |
| đá cứng | `board[i]` ≥ 90 | dừng | không bao giờ |
| ô lớp 2 | `layer2[i]` = màu nằm DƯỚI | — | lộ ra sau khi ô trên bị ăn |
| slime `?` | `hidden[i]` | chặn | chỉ sau khi 1 ô kề bị ăn |

`clearCell` tự đôn `layer2[i]` lên `board[i]`. **Đừng cộng ô lớp 2 vào tổng ghế lần thứ hai** —
xem lỗi 8.6.

Slime `?` (`hidden`) đã bị user bỏ từ 2026-08-05; `build()` xoá nó đi.

Xe `?` (`chest.buried`) thì khác: nó vẫn còn, nhưng **trình mô phỏng bỏ qua nó**, nên thêm bao
nhiêu cũng không đổi winrate đo được. Guide gọi đúng nó là "lever giả" — thuần tuý tâm lý.

---

## 2. Thước đo winrate

### 2.1 Dùng cái nào

Thước chính thức: `scripts/winrate-cal.mjs`, công thức

```
win = sigmoid(A_CAL + B_CAL · logit((B + D) / 2))     A_CAL = −0.6626, B_CAL = 1.0070
```

`B` và `D` là hai mô hình mô phỏng; hằng số hiệu chuẩn nằm ở `scripts/calib.mjs`, refit bằng
`--fit` từ `playlog.jsonl`.

- **Mô hình E đã bị gác**: rất chậm VÀ chấm 0% trên những level user thắng thật.
- **Đừng thêm A hay C**: chấm bằng log-likelihood (không phải MAE) với leave-one-out, cả hai
  đều **tệ hơn đoán bừa một hằng số**.
- Tôi từng khẳng định "B chuẩn nhất" — sai, phân tích đầy đủ cho thấy B đứng thứ 4/5. Blend
  (B+D)/2 sau hiệu chuẩn mới là cái duy nhất đáng tin.

### 2.2 Hai giới hạn phải nhớ

**Trần 94%.** Hiệu chuẩn bão hoà ở đó. Target ≥95% trong CSV chỉ có nghĩa "dễ hết mức", đừng
đuổi theo con số.

**Sai số ~8 điểm.** Chênh 5 điểm winrate là nhiễu, không phải tín hiệu. Vì vậy dung sai của bộ
chọn để **±12**, và trong dải đó thì *vị trí thua* và *số xe* mới là thứ quyết định.

### 2.3 Đo cái gì

```js
gradeBatch(levels, { n: 120, tag: 'ver' })   // → [{b, d, raw, win}]
lossProfile(L, 40)                            // → { win, lossAt, nLoss }
```

`lossAt` = **% BÀN đã ăn lúc thua** (trung vị). Không phải % số xe — một xe đi nhiều chuyến nên
chia theo xe cho ra số >100%.

### 2.4 `RAWTGT` — đặt mốc trên thang thô khi B và D cãi nhau

`TGT` đặt mốc cho con số **đã hiệu chuẩn**, tức trung bình B/D rồi nắn. Nhược điểm: nó nhận cả
những nấc mà hai mô hình nói ngược nhau. L25 ở bản `3f34889` đọc 58% — nghe hợp lý — nhưng đó là
trung bình của **B=98 và D=48**, không mô hình nào tin con số ấy.

`RAWTGT="15:40,20:40,25:40"` đòi **cả hai** cùng đứng gần mốc: khoảng cách = `max(|B−t|, |D−t|)`,
nên nấc lệch pha giữa hai mô hình bị loại thẳng. `--scan1`/`--scan2` vì vậy ghi cả `b` và `d`
vào bảng quét, không chỉ số đã nắn.

⚠ **Thang thô không phải winrate người thật.** Quy đổi (`calib.mjs`):

| B = D | 30 | 40 | **45** | 50 | 56 | 66 | 70 |
|---|---|---|---|---|---|---|---|
| người thật | 18% | 26% | **30%** | 34% | **40%** | **50%** | 55% |

Muốn level 30% thì đặt `RAWTGT` ~45, 40% thì ~56, 50% thì ~66. Đặt 40 là ra 26%.

**Giá phải trả:** ràng buộc này chặt hơn hẳn, và có board không đáp ứng nổi. Quét 2184 nấc cho
L15 (2026-08-07) chỉ tìm được **đúng một** nấc có cả B lẫn D trong ±12 quanh 40; L20 có 4, L25 có
3. Nếu một level không có nấc nào lọt thì đó là tính chất của board, đừng nới mốc cho có.

---

### 2.5 Vân tay level — vì sao `--fit` từng nắn bằng dữ liệu lạc bản

`playlog.jsonl` chỉ ghi SỐ level. Khi một level được dựng lại, các ván cũ vẫn nằm đó dưới cùng
con số, và `winrate-cal.mjs --fit` ghép chúng với board MỚI.

Chuyện này không hiếm: **L15 đổi nội dung 5 lần trong hai ngày 2026-08-06/07** — 146 xe (39×39)
→ 63 → 19 (25×25) → 15 → 22. User chơi thắng 4/5 ván rồi hỏi "sao winrate 21% mà tôi chơi dễ
thế"; câu trả lời là 21% nói về bản 22 xe mà **chưa ai chơi**, còn bốn ván thắng kia là trên
bản 15 và 19 xe.

Từ 2026-08-07 mỗi dòng `result` mang thêm `sig` — vân tay FNV-1a của `cols×rows | board |
chests | layer2`, chốt NGAY LÚC NẠP level (tính sau thì board đã bị ăn mất ô, ra hash khác).

- `src/game/level.ts` → `levelFingerprint()`
- `scripts/genlib.mjs` → **bản song sinh**, phải giữ đúng chuỗi chuẩn hoá và đúng thuật toán.
  Sửa một bên mà quên bên kia thì mọi ván bị coi là lạc bản và `--fit` mất sạch dữ liệu.

`--fit` giờ chỉ nhận ván có `sig` khớp bản đang nằm trong `designed.json`. Ván cũ không có
`sig` cũng bị loại — không biết nó thuộc bản nào thì thà bỏ. Bảng của `winrate-cal.mjs` tách
hai cột: *ván đúng bản* (cột duy nhất được phép so với winrate) và *mọi bản* để tham khảo.
`STALE=1` để đếm tất.

**Hệ quả thực tế:** hiệu chuẩn hiện tại (`A_CAL = −0.6626`, `B_CAL = 1.0070`) khớp trên 67 ván
KHÔNG có vân tay, nên nó chỉ đáng tin ở mức "đã tốt hơn đoán bừa". Muốn hệ số sạch thì phải
chơi lại một đợt trên bản hiện tại rồi mới `--fit`.

## 3. Bộ dựng: 4 bước, theo đúng thứ tự

`gen-design.build(src, n, rung)` làm đúng bốn việc, không hơn:

```js
if (rung.lay) addLayer2Clusters(L, seed, rung.lay, …)          // 1. lớp 2 (chỉ level khó)
L.chests = absorbTiny(                                          // 4. nuốt xe vụn
             shiftEarly(                                        // 3. độ khó
               orderByPeel(L, rung.cap, 0, rung.wave),          // 2. nền dễ
             rung.pressure, seed),
           rung.minCar)
twinsInCrunch(L, twinCount(n, sp), cdep, seed)                  // xe đôi
buriedInCrunch(L, buriedCount(sp.target), seed)                 // xe "?"
```

### 3.1 `orderByPeel` — nền dễ hết mức

Mô phỏng tia bóc board **từng lớp**; mỗi lớp ăn bao nhiêu ô của màu nào thì phát xe đúng thứ
tự và đúng số lượng đó. Kết quả: đầu hàng **luôn** có màu đang ăn được → không thể kẹt bay.
Đây là mốc 94%.

Đo được khi thay cách xếp cũ (xếp theo *thời điểm màu lộ ra lần đầu*) bằng cách này:

| | trước | sau |
|---|---|---|
| L25 | 7% | 94% |
| L16 | 32% | 94% |
| L6 | 41% | 94% |
| L8 | 51% | 94% |
| L20 | 52% | 94% |

Cách cũ hỏng vì nó chỉ biết màu *bắt đầu* ăn được lúc nào, không biết lúc đó có **bao nhiêu ô**
— nên xe to đứng chờ và khoá bay.

### 3.2 `wave` — núm chính, vừa giảm xe vừa tăng khó

`wave` = gộp bao nhiêu **lớp bóc** vào một đợt xe. `wave=1` bám sát nhịp bóc nhất (dễ nhất,
nhưng ~110 xe/level). `wave=k` phát một xe/màu cho cả k lớp → số xe giảm ~k lần, và xe chỉ tới
sớm **nhiều nhất k lớp** so với ô của nó.

Điểm mấu chốt: **sai lệch pha có chặn**. Đây là lý do nó thay được cách gộp cũ.

Đo trên 6 level từng kẹt (cap=90, pressure=0):

| | wave 1 | wave 2 | wave 3 | wave 5 |
|---|---|---|---|---|
| L6 | 94% / 57 xe | 94% / 36 | 94% / 29 | 94% / 23 |
| L14 | 94% / 112 | 94% / 67 | 94% / 50 | 56% / 37 |
| L15 | 94% / 88 | 87% / 57 | 87% / 47 | 79% / 36 |
| L26 | 88% / 112 | 94% / 68 | 85% / 53 | 77% / 38 |
| L30 | 93% / 86 | 33% / 56 | 26% / 44 | 4% / 37 |
| L10 | 19% / 109 | 10% / 67 | 50% / 53 | 2% / 41 |

Chú ý L10 và L30: **không đơn điệu**. Đừng tìm nhị phân trên thang này, phải quét.

### 3.3 `pressure` — độ khó thuần

Tỉ lệ hàng xe bị lấy từ nửa sau chèn vào hồi thắt (22-62% hàng xe). Chúng tới trước khi màu
của mình lộ → đỗ lì ở ô chờ → khoá bay → người chơi phải chọn gỡ bằng xe nào.

**Phải là TỈ LỆ, không phải số cố định.** Bản đầu tôi đẩy đúng 9 xe; với hàng 130 xe thì 121 xe
còn lại vẫn đúng nhịp nên mọi level đều đọc 94%, và tôi tưởng núm này vô dụng.

### 3.4 `absorbTiny` / `minCar` — bỏ đuôi xe vụn

Tia bóc ăn phần dày ở ngoài trước nên mỗi màu còn lại một mẩu ở cuối. Hàng L2 từng là:

```
65, 7, 64, 47, 37, 36, 28, 24, 18, 11, 10, 9, 7, 4, 1
```

Bảy xe cuối cộng lại chưa bằng một xe đầu — bấm nhiều mà chẳng được gì. User bắt đúng chỗ này.

`absorbTiny(order, minSize)` gộp mọi xe nhỏ hơn `minSize` vào xe **cùng màu**:
- ưu tiên xe **đứng SAU** — dời xe ra sau thì màu của nó đã lộ sẵn, vô hại;
- không có xe sau mới lùi vào xe trước — hướng này mới sinh xe-đứng-chờ;
- màu chỉ có đúng một xe thì phải giữ nguyên (bất biến ghế=ô).

L2 với `minCar=40` → **10 xe**: 76, 10, 47, 71, 18, 36, 28, 11, 33, 38.

⚠ **`minCar` phải nằm TRONG thang quét, không phải hậu xử lý.** Gộp xe làm level *dễ* đi; nếu
gộp sau khi đã chốt nấc thì không còn gì bù lại, và 8/29 level rơi khỏi dung sai nên buộc phải
giữ nguyên đuôi vụn. Đưa `minCar` thành một trục của `LADDER` thì bộ chọn được phép đổi
cap/wave/pressure để bù.

### 3.5 `cap` — sức chứa xe

Ảnh hưởng **yếu** tới độ khó (L20 đọc 94% ở mọi cỡ từ 10 tới 48 ô/xe). Dùng nó để giảm số xe,
đừng dùng để chỉnh khó. L1 vốn dùng xe 83-101 slime nên xe to là hợp lệ về mặt hiển thị.

### 3.6 Xe đôi và xe `?`

```js
twinCount = sp.twins > 0 ? sp.twins : (n >= 8 && n % 2 === 0 ? 1 : 0)
buriedCount = target >= 85 ? 2 : target >= 60 ? 3 : 5
```

Luật đặt xe đôi (user 2026-08-05):
- được khác hàng, nhưng **tối đa 2 xe chen giữa** và phải là **hai hàng sát nhau**;
- ưu tiên hình **dọc cùng cột** (xem 1.3);
- cấm ghép hai xe cùng màu, cấm màu navy id12;
- mỗi xe ≥12 slime (màu quá hiếm thì dễ deadlock);
- chỉ đặt trong hồi thắt (22-62% hàng xe).

---

## 4. Bộ chọn nấc

```js
score = |win − target|
      + positionPenalty(lossAt)
      + 0.25 × số xe
```

- **`positionPenalty`**: 0 nếu `lossAt ∈ [25, 75]`; thua muộn (>75) phạt 1.2/điểm; thua sớm
  (<25) phạt **2.5/điểm**. Thua ở 4% bàn thì user đọc là "level hỏng" chứ không phải "level
  khó" — mà bộ chọn rất dễ vớ phải nấc đó vì winrate của nó trông vừa đẹp.
- **Level target ≥90% bỏ phạt vị trí**: nó gần như không thua nên mẫu thua vừa bé vừa nhiễu.
- **0.25đ/xe**: chênh 20 xe ăn đứt chênh 5 điểm winrate — mà 5 điểm nằm gọn trong nhiễu.
- **Dung sai ±12** (rồi ±20 nếu rỗng), không phải ±8: siết về 8 từng loại mất nấc L15 thua ở
  giữa bàn để lấy nấc thua ở mét cuối.

---

## 5. Luật thiết kế do user đặt

| luật | ngày | chi tiết |
|---|---|---|
| Art khoá | 2026-08-05 | "chốt art rồi", "Giờ giữ nguyên art nhé" |
| Ít xe | 2026-08-05 | "giảm thiểu số xe để chơi đỡ mệt"; xe ít thì để 1 xe nhiều slime |
| Không xe vụn | 2026-08-06 | "sao có nhiều xe có số slime nhỏ thế" |
| Lớp 2 | 2026-08-05 | chỉ ở level hard / super hard, và vừa phải |
| Độ khó ở giữa | 2026-08-05 | "chủ yếu từ xe hàng thứ 3 đến hàng thứ 5" |
| Trần winrate | 2026-08-05 | "không 100% thì 90% cũng được" |
| Thua ở đâu | 2026-08-05 | level >90% thì thua ở đâu cũng được |
| Slime `?` | 2026-08-05 | bỏ |
| Xe đôi / xe `?` | 2026-08-05 | giữ; level khó thì mật độ nhiều hơn |
| Được đổi ảnh | 2026-08-05 | chỉ L15, L20, L25, L30 |

Target từng level lấy ở `Manythings/Design winrate/winratedesign1.csv` (cột `lvl`, `target`,
`max màu`, `minxe`, `xedoi`), cắt trần 90.

---

## 6. Những hướng ĐÃ THỬ VÀ BỎ — đừng làm lại

| hướng | vì sao bỏ |
|---|---|
| Gộp xe cùng màu theo **cửa sổ hàng xe** (`MERGE_WIN`) | Kéo xe đi xa tuỳ ý, không kiểm soát nổi: L6 rơi 94%→27%, L26 94%→3%. `wave` thay thế. |
| Xếp xe theo **thứ tự xe đi vòng CCW gặp màu** (`TRAVEL=1`) | Không hơn cách xếp theo số ô: L10 33-46% so với 47-50%, L15 kém hơn. Code vẫn còn sau cờ env. |
| Xếp theo **thời điểm màu lộ ra lần đầu** | Xấp xỉ quá thô — xem 3.1. |
| **Khử đốm trên tranh** (`despeckle`) | Sửa tranh của user. Cấm. |
| **Cấm hai xe cùng màu đứng liền nhau** | Guide §0a nói hồi mở CẦN xe màu nền liên tiếp. Bỏ luật này: L14 14%→86%, L16 32%→94%, L26 53%→88%. |
| **Sàn 30 slime/xe** | Xem lỗi 8.1. |
| Mô hình winrate **A, C, E** | Xem 2.1. |

---

## 7. Board nào không ép dễ được

Một màu bị vỡ thành nhiều đốm 1-2 ô sẽ sinh ra xe phải chờ rải khắp hành trình — nó giữ bay và
không cách nào ép dễ.

L10 là ví dụ: 3 màu vỡ vụn (id4: 56 ô trong 52 đốm, 52 đốm ≤2 ô; id6: 42 ô / 36 đốm; id11:
37 ô / 28 đốm). Quét 65 nấc + thử cả cách xếp theo hướng xe chạy, trần vẫn **57%** so với target
65%. Muốn dễ hơn thì **phải đổi ảnh**, không phải đổi hàng xe.

Chẩn đoán nhanh một board:

```bash
node -e "import('./scripts/genlib.mjs').then(({readD,isC})=>{const d=readD(),L=d[10];
const W=L.cols,H=L.rows,seen=Array(L.board.length).fill(false),blobs={};
for(let i=0;i<L.board.length;i++){if(seen[i]||!isC(L.board[i]))continue;const c=L.board[i];let st=[i],sz=0;seen[i]=true;
 while(st.length){const p=st.pop();sz++;const x=p%W,y=(p/W)|0;
  for(const[a,b]of[[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){if(a<0||b<0||a>=W||b>=H)continue;const q=b*W+a;
   if(!seen[q]&&L.board[q]===c){seen[q]=true;st.push(q);}}}
 (blobs[c]=blobs[c]||[]).push(sz);}
for(const c in blobs){const b=blobs[c].sort((x,y)=>y-x);
 console.log('id'+c,'o='+b.reduce((a,z)=>a+z,0),'dom='+b.length,'dom<=2: '+b.filter(x=>x<=2).length);}});"
```

Màu nào có `đốm <=2` chiếm phần lớn số đốm → level đó có trần.

---

## 8. Lỗi đã mắc — triệu chứng → nguyên nhân → cách phát hiện

### 8.1 Sàn 30 slime giết nửa trên của thang
**Triệu chứng:** 8 level "bất khả thi", mọi nấc đều 2-13%. Tôi đuổi theo **năm giả thuyết** về
board (độ vỡ vụn màu, số màu ở frontier, số màu ăn được lúc đầu, tỉ lệ màu chủ đạo, rải màu) —
tất cả đều sai (r ≈ 0).
**Nguyên nhân:** tôi biến câu "vẫn có thể 30-50 slime" của user thành `cap = max(30, ô/xe)`.
Board 1369 ô → cap luôn kẹt 30 → tối đa 46 xe. Nửa trên của thang **không tồn tại**.
**Bỏ chặn:** L26 5%→94%, L30 4%→66%, L20 9%→58%, L10 13%→55%.
**Bài học:** khi kết luận "không làm được", hãy in ra **biên thực tế của thang** trước. User
nói đúng: "vô lý, làm level dễ thì dễ mà".

### 8.2 Tự đặt luật cứng mà guide không có
`spreadSameColour` cấm hai xe cùng màu đứng cạnh nhau. Guide §0a nói ngược lại. Xem bảng ở §6.

### 8.3 Đo sai vị trí thua
Chia số chuyến cho số xe → ra >100%. Một xe đi nhiều chuyến. Phải chia theo **% ô của board**.

### 8.4 `lossAt` là object, `score` thành NaN
`lossProfile` trả `{win, lossAt, nLoss}` nhưng tôi truyền cả object vào `positionPenalty`. NaN
làm comparator của `sort` trả NaN → thứ tự giữ nguyên → tiêu chí số xe **im lặng biến mất**
(L20 chọn nấc 123 xe). Không có lỗi nào ném ra.
**Phát hiện:** cột `thua@` in ra `[object Object]`. Nhìn bảng, đừng chỉ nhìn kết luận.

### 8.5 Bộ chọn vớ phải nấc thua ở 4% bàn
Phạt thua sớm 0.8/điểm quá nhẹ so với thưởng ít xe 0.25/xe. Nâng lên 2.5/điểm.

### 8.6 Ô lớp 2 bị đếm ghế hai lần
`clearCell` đã đôn ô lớp 2 lên board nên vòng lặp bóc đã đếm chúng; tôi còn cộng thêm một lần
nữa ở cuối `orderByPeel`. L15/L25/L30 dư **đúng 40 ghế** = đúng số ô lớp 2.
**Phát hiện:** `check-seats.mjs`. Nếu không có script này thì ba level đó ship ra mà không ai
biết. Chạy nó **mỗi lần**.

### 8.7 Chạy lại vô ích 4 lần
Mỗi lần user thêm luật mới là tôi sửa `build()` rồi quét lại từ đầu, mất hàng giờ. User:
"sao chạy lâu thế?", "có đúng hướng k đấy? k lại chạy mất công. Nghĩ trước khi làm đi".
**Cách làm đúng:** quét thăm dò 4-6 level đại diện trước (vài phút), xác nhận núm có tác dụng,
rồi mới quét cả bộ.

### 8.8 Lưới đều tay cho mọi level
32 phương án × 45 level = 1440 phép đo, trong khi level target 90% chỉ cần thử **một** phương
án dễ nhất, còn 31 phương án kia đều nhằm làm khó hơn — đi ngược hướng cần tìm.
Dùng `--scan1` (một nấc dễ nhất mỗi level) rồi `--scan2` chỉ cho level trượt.

---

## 9. Runbook

### 9.1 Quét và ghi

```bash
# thăm dò trước — 4-6 level đại diện, xác nhận núm có tác dụng
N_B=60 TRIALS=40 node scripts/_probe.mjs      # tự viết theo nhu cầu, nhớ xoá sau

# quét thang, chia shard theo số core
for i in 0 1 2 3 4 5; do (
  N_B=60 TRIALS=40 \
  CAPS=65,130 WAVES=1,2,3,4,6 PRESS=0,0.15,0.3 LAY2=0,40 MINCAR_LADDER=12,22,40 \
  LEVELS=2,3,4,…  SHARD=$i NSHARD=6 \
  node scripts/gen-design.mjs --scan2 > q-$i.json 2>q-$i.err ) & done; wait

# chọn nấc + ghi src/levels/designed.json  (DRY=1 để xem trước, không ghi)
node scripts/gen-design.mjs --pick q-*.json
```

Lớp 2 tự động bị bỏ qua với level target >60 (xem `--scan2`).

### 9.2 Nghiệm thu — chạy ĐỦ 4 bước, không bỏ bước nào

```bash
node scripts/check-seats.mjs        # 1. bất biến ghế = ô
# 2. board không đổi  (đoạn script ở §0.1)
npx tsc --noEmit                    # 3. typecheck
# 4. ĐO LẠI TRÊN FILE ĐÃ GHI, n=120 — đây mới là con số được phép báo cáo
```

### 9.3 Cho user test

```bash
npm run dev                         # localhost:5173
cloudflared tunnel --url http://localhost:5173    # link công khai tạm, trỏ vào máy đang chạy
npm run deploy                      # GitHub Pages: https://cuongpc19.github.io/Hopin/
```

`vite.config.ts` đã có `allowedHosts: ['.trycloudflare.com']`. Nhảy level bằng `?level=N`.

GitHub Pages có độ trễ CDN ~1 phút; kiểm bằng cách so tên bundle:

```bash
curl -s https://cuongpc19.github.io/Hopin/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
ls dist/assets/*.js
```

### 9.4 Thêm trường mới vào level

⚠ `src/game/level.ts` `getLevel()` **copy từng trường bằng tay**. Trường mới không thêm vào đó
sẽ bị rơi im lặng.

---

## 10. Trạng thái hiện tại (2026-08-06)

**Art:** mốc `916846d`. L4/L6 vẽ bằng code, L8 lấy tranh của L50, L10 là bóng bay, L15/20/25/30
đã hoán đổi trọn gói với L17/24/28/29; L187-196 là 10 level hoa văn đối xứng vẽ bằng code.

**Hàng xe:** dựng lại xong cho L2-30 và L187-196.

| | trước | sau |
|---|---|---|
| L2-30 | 1092 xe, 522 xe <10 slime | **504 xe, 60 xe <10 slime** |
| L187-196 | ~540 xe | **83 xe**, xe nhỏ nhất 40 slime |

Cách làm: 17 level board không đổi thì lắp thẳng hàng xe đã tune (0 phép đo); chỉ 12 level đổi
board mới phải quét. Nhịp ÷5 đã trả về đúng chỗ (L15 50%, L20 69%, L25 55%, L30 51%) và
L17/24/28/29 quay lại dễ (84/92/71/76). L3-9 đều ≥90% theo yêu cầu "bấm sướng tay".
L190/192/193 dùng hàng xe phát đúng nhịp bóc, áp lực 0 — dễ nhất dựng được.

**Lệch duy nhất: L10 = 51% so với target 65%.** Board bóng bay nhảy thẳng 94% → 35% không có
bậc trung gian; quét cả chiều lớp-2 (60/100/150 ô) cũng chỉ tới đó. Phiên khác cũng chỉ đưa
được tới 58%. Muốn đúng target thì phải đổi tranh.

**Bất biến:** L2-30 và L187-196 sạch. **L51 vẫn hỏng** (id5: 103 ô / 811 ghế) — không thể
thắng, hỏng từ lâu, chưa ai sửa.

**Việc tiếp theo:** L31-46 vẫn là bản cũ; L51 cần sửa hoặc bỏ.
