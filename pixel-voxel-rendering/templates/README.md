# templates/ — chép vào project mới

Bốn file, không phụ thuộc gì ngoài một canvas 2D.

| File | Chép đi? | Việc của nó |
|---|---|---|
| `voxelCube.ts` | **có** | Toàn bộ phần vẽ. Đây là thứ duy nhất bắt buộc. |
| `voxelCube.test.ts` | nên | 11 test thuần, không cần canvas. Lưới an toàn khi vặn hằng số. |
| `preview.html` | tuỳ | Sandbox chỉnh look bằng mắt. Mở thẳng từ ổ đĩa, không cần server. |
| `README.md` | không | Chính là file này. |

## Nối vào project — 4 bước

1. **Chép `voxelCube.ts`** vào đâu cũng được (`src/render/`, `lib/`…). Không sửa gì.

2. **Gọi:**
   ```ts
   import { drawVoxelPainting } from './voxelCube';

   const palette: [number, number, number][] = [[242,120,32], [255,210,70], [236,220,190]];
   const grid = [
     [0, 0, 1, null],
     [0, 2, 1, 1],
     [null, 2, 2, null],
   ];                                  // số = chỉ số trong palette, null = ô trống
   drawVoxelPainting(ctx, grid, palette, 15);   // 15 = cạnh một ô, px
   ```

3. **Chép test** và chạy: `npx vitest run voxelCube.test.ts` → 11/11 xanh. Dùng jest thì đổi
   đúng một dòng `import` sang `@jest/globals`.

4. **Nếu vẽ lại nhiều lần** (mỗi frame, hoặc repaint từng vùng), đổi sang
   `drawVoxelPaintingCached` — cùng hình, nhưng blit sprite đã raster sẵn thay vì vẽ lại từ đầu.

## Ba cái bẫy, đọc trước khi mất buổi chiều

**1. `drawVoxelPaintingCached` đòi canvas tỉ lệ 1:1.** Nó blit bitmap đúng bằng cỡ ô, nên
context đang scale/zoom sẽ resample và mọi cạnh vát mờ đi — mà đó lại chính là thứ tạo nên cái
look. Muốn to hơn thì tăng `cellPx`, hoặc truyền `scale` nguyên. Muốn xem phóng to để soi thì
dùng `drawVoxelPainting` (vẽ vector, sắc ở mọi tỉ lệ). Hàm có `console.warn` một lần nếu phát hiện
context bị scale.

**2. Viên gạch vẽ RA NGOÀI ô của nó** — nắp trồi lên trên, bóng tràn sang phải/dưới. Nếu bạn xoá
hoặc vẽ lại **một ô**, phải phủ cả phần trồi đó, nếu không vệt của viên cũ ở lại vĩnh viễn. Dùng
`voxelHaloPixels(bbox, canvasW, canvasH)` để lấy đúng danh sách pixel + vùng cần vẽ lại. Xem
PLAYBOOK.md §6.

**3. Vẽ TRÊN → DƯỚI.** Hàng dưới phải vẽ sau để che mặt trước của hàng trên. `drawVoxelPainting`
đã đúng; tự viết vòng lặp thì nhớ.

## Môi trường không có DOM

Cache sprite cần tạo canvas ngoài màn hình. Ở Node/worker/engine riêng, cắm factory trước khi vẽ:

```ts
import { setVoxelCanvasFactory } from './voxelCube';
setVoxelCanvasFactory(() => new OffscreenCanvas(1, 1) as any);
```

`drawVoxelCube` và `drawVoxelPainting` không cấp phát gì cả — chỉ đường có cache mới cần factory.

## Đối chiếu với bản gốc

Trích 2026-08-05 từ AntFlow ("Crab Cove"), `src/sim/voxelCube.ts` nhánh `ant-crazygames-native`.
Đã kiểm bằng cách render cùng một hình bằng cả hai module rồi so từng byte:

- `drawVoxelCube`, một viên 24px: **0/6400 byte lệch**
- `drawVoxelPainting`, lưới 4×3 ô 14px: **0/13824 byte lệch**
- `drawVoxelPaintingCached` so với bản trực tiếp: 36.4% byte lệch, lệch trung bình 3/255, cao nhất
  41 ở pixel giáp mối — mắt thường không phân biệt được (đánh đổi có chủ ý, xem PLAYBOOK.md §7).
