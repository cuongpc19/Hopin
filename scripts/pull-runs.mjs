// Kéo ván chơi THẬT từ Firebase về playlog.jsonl.
//
//   node scripts/pull-runs.mjs            # xem thống kê, KHÔNG ghi
//   node scripts/pull-runs.mjs --write    # gộp vào playlog.jsonl (bỏ trùng)
//
// Vì sao script này tồn tại: hiệu chuẩn thước (A_CAL/B_CAL) hiện khớp trên 67 ván KHÔNG có
// vân tay, nên LEVEL-DESIGN.md §2.5 ghi rõ nó chỉ đáng tin ở mức "hơn đoán bừa". Dữ liệu ở
// đây có `sig` cho mọi dòng, nên `winrate-cal.mjs --fit` lọc được ván lạc bản và lần đầu
// tiên cho ra hệ số sạch.
//
// ⚠ Luật RTDB khoá phần ĐỌC (".read": false) — cố ý, vì URL nằm lộ trong bundle game. Nên
// script này cần một khoá bí mật để đọc:
//     Firebase console → ⚙ Project settings → Service accounts → Database secrets
//   rồi:  FB_SECRET=<khoá> node scripts/pull-runs.mjs
// KHÔNG commit khoá đó.
import fs from "node:fs";

const DB = "https://hop-n-7d1af-default-rtdb.asia-southeast1.firebasedatabase.app";
const OUT = "playlog.jsonl";
const WRITE = process.argv.includes("--write");
const SECRET = process.env.FB_SECRET;

if (!SECRET) {
  console.error("Thieu FB_SECRET. Xem chu thich dau file.");
  process.exit(1);
}

const url = `${DB}/runs.json?auth=${encodeURIComponent(SECRET)}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`Doc that bai: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const raw = await res.json();
if (!raw) {
  console.log("Chua co van nao.");
  process.exit(0);
}

// RTDB tra ve { "<push-id>": {…} } — chi lay phan gia tri, giu push-id lam khoa chong trung.
const rows = Object.entries(raw).map(([id, v]) => ({ id, ...v }));
console.log(`Tai ve ${rows.length} van.`);

// ---- thong ke nhanh, de biet du lieu co dung duoc chua -----------------------
const byHost = {};
const byLevel = {};
for (const r of rows) {
  // `from` = ten may chu (localhost / crazygames.com …). In ra de biet dong nao la van test:
  // sau khi game ra mat thi loc theo ngay khong tach duoc nua, vi ta van test song song.
  const src = `${r.host ?? "?"}@${r.from ?? "?"}`;
  byHost[src] = (byHost[src] ?? 0) + 1;
  const k = r.lvl ?? "?";
  const b = (byLevel[k] = byLevel[k] ?? { n: 0, win: 0 });
  b.n++;
  if (r.result === "win") b.win++;
}
console.log("Theo nguon:", Object.entries(byHost).map(([k, v]) => `${k}=${v}`).join("  "));

const levels = Object.keys(byLevel).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
console.log("\nlv  | van | thang | winrate THAT");
for (const lv of levels) {
  const b = byLevel[lv];
  // Duoi 5 van thi ty le chi la nhieu — in ra nhung danh dau, dung dem no la tin hieu.
  const note = b.n < 5 ? "  (qua it van)" : "";
  console.log(
    `L${String(lv).padEnd(3)}| ${String(b.n).padStart(3)} | ${String(b.win).padStart(5)} | ` +
      `${String(Math.round((100 * b.win) / b.n)).padStart(3)}%${note}`,
  );
}

if (!WRITE) {
  console.log("\n(xem thoi — them --write de gop vao playlog.jsonl)");
  process.exit(0);
}

// ---- gop vao playlog.jsonl, bo trung theo push-id ---------------------------
const seen = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o._fb) seen.add(o._fb);
    } catch {
      /* dong hong — ke */
    }
  }
}
let added = 0;
const out = [];
for (const r of rows) {
  if (seen.has(r.id)) continue;
  const { id, ...rest } = r;
  out.push(JSON.stringify({ ev: "result", ...rest, _fb: id })); // _fb = khoa chong trung
  added++;
}
if (added) fs.appendFileSync(OUT, out.join("\n") + "\n");
console.log(`\nDa them ${added} van moi vao ${OUT} (bo qua ${rows.length - added} van da co).`);
console.log("Buoc tiep: node scripts/winrate-cal.mjs --fit");
