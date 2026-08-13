// LUẬT ĐẶT HỘP SOCOLA — chạy sau mỗi lần thêm/sửa `boxes` trong designed.json:
//   node scripts/check-choco.mjs
//
// Hộp n×n đè lên n² slime; ăn đủ `count` slime HỢP LỆ (đúng màu ruy băng, hoặc màu nào cũng
// được nếu ruy băng cầu vồng) thì hộp vỡ và n² slime nhập vào bàn.
//
// ⚠ Cái chết thầm lặng ở đây là ĐẾM: hộp ruy băng xanh số 50 mà cả bàn chỉ có 44 slime xanh
// NGOÀI hộp thì level không thể thắng, và không có gì trong game báo cho biết — người chơi chỉ
// thấy bàn tắc. Đó là kiểm tra chính của file này; bất biến ghế=ô (check-seats) KHÔNG bắt được
// nó, vì slime dưới hộp vẫn được đếm ghế bình thường.
import fs from "node:fs";
import { readD, isC } from "./genlib.mjs";

const RAINBOW = -1;
// DFILE=<file.json> để chạy thử luật trên một bộ level rời (dùng khi test chính file này).
const d = process.env.DFILE ? JSON.parse(fs.readFileSync(process.env.DFILE, "utf8")) : readD();
let bad = 0, warn = 0, seen = 0;

for (const n of Object.keys(d).map(Number).sort((a, b) => a - b)) {
  const L = d[n];
  if (!L?.boxes?.length) continue;
  const W = L.cols, H = L.rows;
  const err = [], wrn = [];
  const owner = new Map(); // ô → chỉ số hộp, để bắt hai hộp chồng nhau

  L.boxes.forEach((b, bi) => {
    seen++;
    const N = b.n;
    const r0 = Math.floor(b.at / W), c0 = b.at % W;
    const tag = `hop${bi} (${N}x${N} @r${r0}c${c0})`;
    // N LẺ: hai dải ruy băng phải cắt nhau đúng Ô GIỮA, N chẵn thì không có ô giữa.
    if (N !== 3 && N !== 5) err.push(`${tag}: n=${N}, chi cho phep 3 hoac 5`);
    // Bàn phải RỘNG HƠN hộp ít nhất 2 ô mỗi chiều: bàn đúng bằng hộp là không còn slime nào
    // ngoài để mở nó → chết ngay từ lúc thiết kế.
    if (W < N + 2 || H < N + 2) err.push(`${tag}: ban ${W}x${H} qua nho, can it nhat ${N + 2}x${N + 2}`);
    if (r0 + N > H || c0 + N > W) { err.push(`${tag}: tran qua mep ban`); return; }
    if (!(b.count >= 1)) err.push(`${tag}: count=${b.count}, phai >= 1`);
    if (b.ribbon !== RAINBOW && !(b.ribbon >= 0 && b.ribbon <= 18)) err.push(`${tag}: ribbon=${b.ribbon} khong hop le`);
    // count nên tỉ lệ với N² — 1/4..1/3 số slime nó giấu. Mở hộp 5×5 bằng 3 cú là cho không
    // 25 slime; mở bằng 20 cú thì hộp thành bức tường chứ không phải câu đố.
    const lo = Math.round((N * N) / 4), hi = Math.round((N * N) / 3);
    if (b.count < lo || b.count > hi) wrn.push(`${tag}: count=${b.count} ngoai khoang de nghi ${lo}-${hi}`);

    for (let r = r0; r < r0 + N; r++)
      for (let c = c0; c < c0 + N; c++) {
        const i = r * W + c, v = L.board[i];
        // Chỉ đè lên slime thường — không đè đá/gỗ/ô trống, và không chồng hộp khác.
        if (v < 0) err.push(`${tag}: o r${r}c${c} trong`);
        else if (!isC(v)) err.push(`${tag}: o r${r}c${c} la chuong ngai (${v})`);
        if (owner.has(i)) err.push(`${tag}: chong len hop${owner.get(i)} tai r${r}c${c}`);
        else owner.set(i, bi);
      }
  });

  // ---- ĐỦ SLIME NGOÀI HỘP ĐỂ MỞ HỘP ----------------------------------------------------
  // Tính trên slime NẰM NGOÀI MỌI hộp: slime dưới hộp không tự mở được hộp đang giấu nó.
  // Lớp 2 cũng tính — ăn lớp trên rồi ăn lớp dưới là hai con slime.
  const outside = {};
  let outsideAll = 0;
  L.board.forEach((v, i) => { if (isC(v) && !owner.has(i)) { outside[v] = (outside[v] || 0) + 1; outsideAll++; } });
  if (L.layer2) L.layer2.forEach((v, i) => { if (v >= 0 && !owner.has(i)) { outside[v] = (outside[v] || 0) + 1; outsideAll++; } });

  // Nhiều hộp CÙNG luật ăn chung một nguồn: một con slime xanh trừ số cho MỌI hộp ruy băng
  // xanh cùng lúc, nên chỉ cần đủ cho cái đòi nhiều nhất, không phải tổng.
  const need = {};
  L.boxes.forEach((b) => { need[b.ribbon] = Math.max(need[b.ribbon] || 0, b.count); });
  for (const [rib, cnt] of Object.entries(need)) {
    const have = Number(rib) === RAINBOW ? outsideAll : (outside[rib] || 0);
    const what = Number(rib) === RAINBOW ? "slime bat ky" : `slime mau ${rib}`;
    if (have < cnt) err.push(`ruy bang ${rib}: can ${cnt} ${what} ngoai hop, ban chi co ${have}`);
    else if (have < cnt * 1.5) wrn.push(`ruy bang ${rib}: chi du sat nut (${have} ngoai hop / can ${cnt})`);
  }

  if (err.length) { bad++; console.log(`L${n} HONG:`); err.forEach((e) => console.log(`   ${e}`)); }
  if (wrn.length) { warn++; console.log(`L${n} luu y:`); wrn.forEach((e) => console.log(`   ${e}`)); }
}

console.log(`\n${seen} hop tren ${Object.values(d).filter((L) => L?.boxes?.length).length} level`);
console.log(bad ? `${bad} level HONG` : "OK — moi hop dat dung luat");
process.exit(bad ? 1 : 0);
