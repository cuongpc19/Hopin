# Vẽ pixel-art thành khối kẹo nổi — playbook

Mỗi ô của một bức pixel-art được vẽ thành một **khối nổi**: mặt trên phẳng hơi phồng, mặt trước
tối hơn, cạnh trên-trái sáng, cạnh dưới-phải tối, bóng đổ xuống phải. Nguồn sáng cố định ở trên
bên trái. Tất cả suy ra từ **một màu duy nhất mỗi ô** — không texture, không asset, không sampling.

Code chép thẳng: [`templates/`](templates/) — một file `voxelCube.ts`, không phụ thuộc gì ngoài
canvas 2D. Đọc [`templates/README.md`](templates/README.md) để nối vào project trong 4 bước.

---

## 1. Khi nào KHÔNG dùng

- **Ô nhỏ hơn ~6px.** Đã nhìn tận mắt trong `preview.html`: ở 4px, nắp + 4 cạnh vát + bóng chiếm
  gần hết diện tích, lưới đọc thành nhiễu chứ không ra khối. Ở 6px vẫn còn nhận ra khối nhưng đã
  bắt đầu bết. Dưới ngưỡng đó dùng ô màu phẳng.
- **Pixel-art muốn giữ đúng chất retro.** Đây là look "kẹo 3D" của game casual hiện đại, ngược hẳn
  với thẩm mỹ pixel phẳng. Không có núm nào vặn để nó thành retro — sai công cụ.
- **Cần vẽ hàng chục nghìn ô mỗi frame.** Đây là đường Canvas 2D trên CPU. Vài nghìn ô thì ổn (có
  cache sprite), nhưng nếu bạn cần một triệu ô động thì phải viết shader — dùng tài liệu này làm
  bản tham chiếu màu, đừng dùng code.
- **Cần vẽ ô không phải hình chữ nhật** (lục giác, isometric). Hình học dưới đây giả định lưới
  vuông và nguồn sáng cố định.

## 2. Bắt đầu trong 30 giây

```ts
import { drawVoxelPainting } from './voxelCube';

const palette: [number, number, number][] = [[242,120,32], [255,210,70], [236,220,190]];
const grid = [
  [0, 0, 1, null],       // số = chỉ số palette
  [0, 2, 1, 1],          // null = ô trống
  [null, 2, 2, null],
];
drawVoxelPainting(ctx, grid, palette, 15);   // 15 = cạnh ô, px
```

Hết. Không cấu hình, không khởi tạo, không tài nguyên phải nạp.

## 3. Giải phẫu một viên

Điều **phải nắm trước tiên**: ô danh nghĩa và hình được vẽ **không trùng nhau**.

```
        ┌───────────────┐  ← đỉnh HÌNH VẼ = y − frontOverlap   (trồi lên hàng trên!)
        │               │
        │   mặt trên    │  lidH
        │    (lid)      │
   ┌────┼───────────────┼────┐  ← đỉnh Ô DANH NGHĨA = y
   │    │               │    │
   │    ├───────────────┤    │  ← frontY
   │    │  mặt trước    │    │  frontH = frontOverlap = 0.2·h
   │    └───────────────┘    │  ← đáy cả hai = y + h
   │         ░░░░░░░░░░░░░   │  ← bóng đổ tràn sang phải/dưới
   └─────────────────────────┘
   ô danh nghĩa (x, y, w, h)
```

Từ ô danh nghĩa `(x, y, w, h)` suy ra:

| Biến | Công thức | Ý nghĩa |
|---|---|---|
| `m` | `min(w, h)` | mốc quy chiếu cho khe hở/bóng/nét viền |
| `frontOverlap` | `max(1.4, h · 0.2)` | chiều cao mặt trước = phần nắp trồi lên hàng trên |
| hình vẽ | `(x, y − overlap, w, h + overlap)` | **cao hơn ô** |
| `gap` | `clamp(m · 0.02, 0.2, 0.55)` | thụt vào mỗi bên → khe hở giữa hai viên |
| `bx,by,bw,bh` | hình vẽ thụt vào `gap` | thân viên thật sự |
| `r` | `max(0.3, min(bw,bh) · 0.2)` | bán kính bo góc |
| `lidH` | `bh − frontH` | chiều cao mặt trên |
| `rim` | `max(0.7, min(bw, lidH) · 0.11)` | độ dày gốc của cạnh vát |

## 4. Thứ tự vẽ và mọi hằng số

Thứ tự là **hợp đồng**, không phải tuỳ tiện: bóng vẽ trước để thân viên che phần umbra của chính
nó; mọi mặt nằm trong một `clip()` bo góc; nét viền ngoài vẽ sau cùng để không bị clip cắt.

| # | Bước | Con số | Đổi số này thì thấy gì |
|---|---|---|---|
| 1 | Bóng đổ | penumbra `rgba(35,24,14,.16)` lệch `(0.55·sox, 0.55·soy)`; umbra `rgba(28,18,10,.28)` lệch `(sox, soy)`; `sox = max(0.9, m·0.11)`, `soy = max(1.1, m·0.15)` | viên nổi cao hay dán sát nền. ⚠️ đổi thì **phải** sửa `voxelShadowSpillPx` — xem §6 |
| 2 | Rãnh | `shadeColor(base, −52)`, chỉ trong phạm vi ô | đường tách hai viên **cùng màu**. Bỏ đi thì một mảng cùng màu dính thành tấm liền |
| 3 | Clip | `roundRect(bx,by,bw,bh,r)` | — |
| 4 | Mặt trước | dọc `−34 → −56 (40%) → −78` | độ "dày" của khối. Sâu hơn = khối nặng hơn |
| 5 | Sáng cạnh mặt trước | trái `−6` α.55→0; phải `−85` α.78→0; rộng `min(bw·0.18, max(1.1, rim·1.1))` | hướng sáng có tin được không |
| 6 | Gờ dưới nắp | đen `0 → .38 (20%) → 0` | nếp gãy giữa nắp và mặt trước |
| 7 | Vạch sáng mép trên mặt trước | `+30` α.4, cao `max(0.55, frontH·0.1)` | mép nắp có "bắt sáng" không |
| 8 | Bounce light đáy | `+46` α.6 → `+24` α.28 (60%) → 0, cao `clamp(frontH·0.55, 0.8, 3.2)` | ánh sáng hắt ngược lên gờ dưới; bỏ đi thì đáy viên chết bẹt |
| 9a | Nắp — nền | `+4` | tươi hơn mặt trước một chút |
| 9b | Nắp — gối | radial tại `(0.38·bw, 0.36·lidH)`, R `0.85·max(bw,lidH)`: `+28` α.21 → `+8` α.09 (45%) → 0 (80%) → `−22` α.2 | độ phồng mềm |
| 9c | Nắp — tối dần xuống | đen `0 → 0 (70%) → .2` | chỗ nắp chuyển thành mặt trước |
| 9d | **4 cạnh vát** | trên `+84` α.72 → `+35` α.35 **(62%)** → 0 · trái `+58` α.62 → `+22` α.28 (68%) → 0 · dưới `−78` α.85 → `−35` α.35 (50%) → 0 · phải `−96` α.92 → `−45` α.45 (68%) → 0 | **linh hồn của khối**. Cặp `+84 / −96` là độ tương phản; điểm dừng giữa đặt muộn (0.5–0.68) làm cạnh sắc nét thay vì loang mềm |
| 9e | Sheen lồi | trắng radial tại `(0.5·bw, 0.3·lidH)`, R `0.72·max(bw,lidH)`: α.31 → .11 (50%) → 0 | **chính nó** làm nắp đọc ra mặt cong. Bỏ đi thì nắp phẳng lì |
| 9f | Chấm specular | trắng radial R `0.2·min(bw,lidH)` tại `(0.28·bw, 0.26·lidH)`: α.3 → .08 → 0 | điểm bóng "kẹo". Tăng quá thành mờ đục |
| 10 | Nét viền ngoài | `shadeColor(base, −70)` α.36, dày `max(0.35, m·0.022)` | giữ silhouette khi phóng to |

Nắp chỉ vẽ khi `lidH > 1.5` — thấp hơn thì toàn vát, không còn mặt.

## 5. Mô hình màu

Một hàm duy nhất:

```ts
shadeColor([r,g,b], amt) = [clamp255(r+amt), clamp255(g+amt), clamp255(b+amt)]
```

**Dịch đều ba kênh**, không nhân hệ số. Lý do: dịch đều giữ nguyên hue và tỉ lệ bão hoà, nên mọi
mặt đọc ra "cùng một chất liệu, khác ánh sáng". Nhân (`c × 0.7`) kéo màu bão hoà về phía xám và
khối lập tức trông như hai vật liệu khác nhau dán vào nhau.

Toàn dải dùng trên một viên: **+84** (vát trên) đến **−96** (vát phải). Ngoài ra chỉ có trắng
(sheen, specular, vạch sáng), đen (nếp gãy, tối dần) và hai tông nâu ấm cố định cho bóng đổ.

Hệ quả thực dụng: **bảng màu của bạn không cần biến thể sáng/tối**. Cho mỗi ô đúng một màu phẳng,
phần còn lại tự sinh.

## 6. Hai luật không được phá

### 6.1 Vẽ TRÊN → DƯỚI

Nắp trồi lên hàng trên, nên hàng dưới phải vẽ **sau** để che mặt trước của hàng trên.
`drawVoxelPainting` đã làm đúng. Tự viết vòng lặp mà vẽ ngược thì mặt trước bị nắp hàng dưới xén.

### 6.2 Hợp đồng halo — viên vẽ ra ngoài ô của nó

Đây là thứ đắt nhất của tài liệu này, vì nó **không nhìn ảnh mà đoán ra được**.

Một viên tô pixel ở ngoài ô của nó: **lên trên** một dải `voxelLidStripPx(h)`, **sang phải/xuống
dưới** phần bóng `voxelShadowSpillPx(w, h)`. Nếu bạn xoá / làm mờ / vẽ lại **một ô** mà chỉ phủ
đúng ô đó, phần trồi ra của viên cũ **ở lại vĩnh viễn** — một vệt màu hoặc vệt bóng không bao giờ
biến mất, và chỉ xuất hiện ở vài kích thước ô nên rất khó lần.

Đây là lỗi có thật ở project gốc (2026-07-09), và tái phát ngay trong ngày ở hướng bóng dưới-phải
sau khi đã vá hướng nắp.

Ba hàm thuần là nguồn chân lý duy nhất, dùng chung cho cả người vẽ lẫn người xoá:

```ts
voxelFrontOverlap(cellH)      // = max(1.4, 0.2·cellH) — nắp trồi lên bao nhiêu
voxelLidStripPx(tileH)        // = ceil(frontOverlap) + 1 — dải nguyên-pixel phía trên
voxelShadowSpillPx(w, h)      // = { right, bottom } — bóng tràn
voxelHaloPixels(bbox, cw, ch, ss?)  // danh sách pixel ngoài-ô + rect cần vẽ lại
```

Hai quy tắc kèm theo:

- **Thà phủ dư còn hơn phủ thiếu.** Cả hai hàm cộng thêm `+1` cho viền khử răng cưa. Phủ dư một
  pixel chỉ là vẽ lại một pixel vốn đã đúng; phủ thiếu một pixel để lại vệt bẩn.
- **Đệm đã nhân với hệ số phóng, không tính lại ở kích thước đã phóng.** Nếu buffer pixel của bạn
  siêu lấy mẫu ×N, dùng `voxelHaloPixels(bbox, w, h, N)`. Tính lại đệm ở chiều cao đã nhân N sẽ
  làm tròn xuống và thiếu 1–2 pixel — đúng cái bẫy ở trên. Test
  `ss margins NEVER under-cover` giữ luật này.

⚠️ **Đổi bất cứ hằng số bóng nào ở §4 bước 1 thì phải sửa `voxelShadowSpillPx` trong cùng lần
sửa.** Đây không phải lời khuyên, đây là chỗ đã cháy hai lần.

## 7. Hiệu năng

Một viên tốn ~8 gradient + hơn chục lệnh fill. Nhưng kết quả **chỉ phụ thuộc `(rộng, cao, màu)`**,
mà một bức pixel-art thường chỉ có một hai cỡ ô × vài màu trong bảng. Nên: raster mỗi tổ hợp **một
lần** vào canvas riêng, từ đó về sau chỉ blit.

- `drawVoxelPainting` — vẽ trực tiếp. Đúng cho **bake một lần**, và cho mọi khung nhìn phóng to
  (vector, sắc ở mọi tỉ lệ).
- `drawVoxelPaintingCached` — blit từ cache. Đúng khi **vẽ lại nhiều lần**.

Số đo ở project gốc: dựng lại một vùng từ ~1–2.5 ms xuống **~0.1 ms**.

Ba chi tiết trong cache đáng giữ khi port:

1. **Raster ở ×2 rồi thu nhỏ một lần.** Cạnh vát và nét viền là chi tiết dưới-pixel; raster ở ×2
   trước khi thu nhỏ giữ chúng sắc. Làm một lần lúc bake, nên mọi lần vẽ sau chỉ là blit.
2. **`willReadFrequently: true`** khi tạo context của sprite. Khử răng cưa của GPU và của CPU khác
   nhau thấy được ở mép viên (đo được α210 so với α179 trên cùng một pixel nắp), nên sprite raster
   bằng GPU blit vào buffer CPU sẽ lệch nhiều hơn nhiễu làm tròn gradient. Chỉ bỏ cờ này nếu bạn
   không bao giờ đọc pixel ra.
3. **Bản cache không byte-identical với bản trực tiếp.** Ghép các sprite đã thu nhỏ khác với thu
   nhỏ cả bức đã ghép, ở đúng 1–2 pixel giáp mối. Đo trên lưới 4×3 ô 14px: 36.4% byte lệch, lệch
   trung bình **3/255**, cao nhất **41** tại pixel giáp mối. Mắt thường không thấy. Nhưng nếu bạn
   cần **hai lần render cùng một vùng trùng khít nhau** (ví dụ blend giữa chúng), hãy dùng **cùng
   một đường** cho cả hai, đừng mỗi bên một đường.

⚠️ `drawVoxelPaintingCached` **đòi canvas ở tỉ lệ 1:1**. Nó blit bitmap đúng cỡ ô; context đang
scale sẽ resample và làm mờ hết cạnh vát — tức là mất đúng thứ mình đang cố tạo ra. Muốn to hơn:
tăng `cellPx`, hoặc truyền `scale` nguyên. Muốn soi phóng to: dùng `drawVoxelPainting`. Hàm có
`console.warn` một lần nếu bắt được context bị scale.

## 8. Vặn núm

Mở `templates/preview.html` (mở thẳng từ ổ đĩa, không cần server). Có slider cho tất cả các núm
dưới đây, cộng một dãy ô 4px để thấy ngưỡng "quá nhỏ", và một ô readout in ra đúng các dòng cần
chép ngược vào `voxelCube.ts`.

| Muốn | Sửa | Ghi chú |
|---|---|---|
| Khối dày / mỏng hơn | `0.2` trong `voxelFrontOverlap` | ⚠️ đổi luôn dải halo phía trên — test sẽ báo |
| Tròn / vuông hơn | `0.2` bán kính bo góc | 0.07 cho khối voxel cạnh sắc |
| Khe hở giữa các viên | `0.02` trong `gap` | 0 = dính liền, cao = lưới thưa |
| Tương phản khối | cặp `+84 / −96` ở 4 cạnh vát | giảm cùng lúc cho look phẳng nhẹ |
| Bóng bẩy / lì | α sheen `.31` và specular `.3` | về 0 = nhựa mờ |
| Nổi cao / dán sát | `sox`/`soy` và α bóng đổ | ⚠️ **phải** sửa `voxelShadowSpillPx` |

Quy trình: chỉnh trong preview → chép các số ở readout vào `voxelCube.ts` → chạy
`voxelCube.test.ts`. Nếu đã đụng chiều cao mặt trước hoặc bóng, test halo sẽ đỏ và nói đúng chỗ
phải sửa tiếp.

## 9. Port sang engine khác

- **Canvas 2D** — bản gốc, chép là chạy.
- **Phaser / Pixi / bất kỳ engine 2D nào** — đừng vẽ mỗi frame. Bake cả bức (hoặc từng sprite ô)
  vào một canvas ngoài màn hình rồi dùng làm texture; cập nhật lại chỉ khi nội dung đổi. Đó đúng
  là cách project gốc làm.
- **Node / worker (bake ngoại tuyến)** — cắm `setVoxelCanvasFactory()` rồi dùng như thường.
- **WebGL / shader** — hình học ở §3 và các delta ở §4 dịch thẳng sang fragment shader (mọi thứ
  đều là gradient tuyến tính hoặc radial trên một màu gốc). Giữ bản Canvas 2D làm **ảnh tham
  chiếu** để so màu, vì rất dễ lệch mà không nhận ra.

## 10. Cố ý KHÔNG có trong này

Tài liệu này chỉ là **phần vẽ**. Ba mảng liền kề nằm ở project gốc (AntFlow, repo
`webgame_antflow`, nhánh `ant-crazygames-native`) — cần thì sang đó lấy:

| Mảng | Ở đâu |
|---|---|
| Ảnh bất kỳ → lưới màu sạch (tách nền, quantize k-means++, snap lưới, viền) | `src/engine/imageToGrid.ts`, `gridSnap.ts`, `outline.ts` |
| Nén và lưu level (RLE bản đồ nhãn, dựng lại mảng dẫn xuất lúc load, validate) | `src/engine/levelData.ts` |
| Hiệu ứng tan từng mảng + upload GPU chỉ vùng bẩn (`texSubImage2D`) | `src/sim/AntSim.ts` (`beginVoxelFade`, `markPaintRect`), `src/native/GameplayScene.ts` (`uploadPaintRects`) |

Phần thứ ba chính là lý do §6.2 tồn tại: nó là ứng dụng thực tế của hợp đồng halo.

## Provenance

- Trích **2026-08-05** từ AntFlow ("Crab Cove"), `src/sim/voxelCube.ts`, nhánh
  `ant-crazygames-native`. Các hằng số là kết quả nhiều vòng duyệt bằng mắt (bản "Puffy dày"
  2026-07-21 + đợt làm sắc cạnh + bounce light).
- **Đã kiểm chứng, không phải chép mù:** render cùng một hình bằng module gốc và bằng template rồi
  so từng byte — một viên 24px: **0/6400 byte lệch**; lưới 4×3 ô 14px: **0/13824 byte lệch**.
- **Đối chiếu lại khi nghi tài liệu trôi** — so đúng thứ quan trọng là **các con số**, bỏ qua chú
  thích và cách xuống dòng (template viết chú thích cho người zero-context nên khác bản gốc là
  đương nhiên; khác ở con số mới là trôi thật):

  ```bash
  nums() { sed -n '/export function drawVoxelCube/,/^}/p' "$1" \
    | sed -e 's://.*::' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
    | grep -oE '[-+]?[0-9]+\.?[0-9]*'; }
  A=~/Working/WebGame/AntFlow-ant-crazygames-native/src/sim/voxelCube.ts
  B=~/.claude/docs/pixel-voxel-rendering/templates/voxelCube.ts
  diff <(nums "$A") <(nums "$B") && echo "✅ mọi hằng số trùng khớp"
  ```

  Kỳ vọng: **214 số, không dòng nào lệch** (đo 2026-08-05). Thấy lệch → xem số nào, rồi quyết định
  bên nào là bản đúng; đừng mặc định bản repo luôn mới hơn, có thể chính template đã được vặn.
