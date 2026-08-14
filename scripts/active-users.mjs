// Người chơi hoạt động theo NGÀY, tính từ /runs.
//
//   node scripts/active-users.mjs --file <export.json>     (hoặc FB_SECRET để tải trực tiếp)
//   --all      đếm cả localhost / máy nhà (mặc định bỏ)
//   --hours    thêm bảng theo GIỜ của ngày gần nhất
//
// ⚠ ĐÂY LÀ CẬN DƯỚI, KHÔNG PHẢI SỐ NGƯỜI VÀO GAME. Một dòng chỉ được ghi khi một ván KẾT THÚC
// (thắng hoặc thua). Ai mở game rồi thoát giữa màn đầu thì không có dòng nào — họ vô hình ở
// đây nhưng vẫn được CrazyGames đếm. Muốn số "đã vào game" thì phải xem bảng của họ.
//
// `dev` là mã ngẫu nhiên 16-bit sinh mỗi máy, nên hai người lạ có thể trùng mã: với ~600 mã
// đang hoạt động, xác suất có ít nhất một cặp trùng là gần như chắc chắn (nghịch lý ngày sinh)
// — ước lượng số cặp trùng in kèm bên dưới, số người thật cao hơn con số đếm được chừng ấy.
import fs from "node:fs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ALL = args.includes("--all");

let runs;
const file = arg("--file");
if (file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  runs = Object.values(j.runs || j);
} else {
  const secret = process.env.FB_SECRET;
  if (!secret) { console.error("can --file <export.json> hoac FB_SECRET"); process.exit(1); }
  const url = `https://hop-n-7d1af-default-rtdb.asia-southeast1.firebasedatabase.app/runs.json?auth=${secret}`;
  runs = Object.values(await (await fetch(url)).json());
}

const real = runs.filter((r) => r && r.dev && r.at && (ALL || (r.from && !/^localhost|^127\./.test(r.from))));
const day = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10); // giờ VN

const byDay = new Map();
const firstSeen = new Map();
for (const r of real) {
  const d = day(r.at);
  if (!byDay.has(d)) byDay.set(d, { devs: new Set(), runs: 0, wins: 0 });
  const o = byDay.get(d);
  o.devs.add(r.dev); o.runs++; if (r.result === "win") o.wins++;
  if (!firstSeen.has(r.dev) || r.at < firstSeen.get(r.dev)) firstSeen.set(r.dev, r.at);
}

const days = [...byDay.keys()].sort();
console.log(`${real.length} van, ${firstSeen.size} may, ${days.length} ngay${ALL ? "  (KE CA localhost)" : ""}\n`);
console.log("| Ngay       | Nguoi choi | Moi | Quay lai | Van | Van/nguoi | Winrate |");
console.log("|------------|-----------:|----:|---------:|----:|----------:|--------:|");
for (const d of days) {
  const o = byDay.get(d);
  const isNew = [...o.devs].filter((x) => day(firstSeen.get(x)) === d).length;
  console.log(`| ${d} | ${String(o.devs.size).padStart(10)} | ${String(isNew).padStart(3)} |` +
    ` ${String(o.devs.size - isNew).padStart(8)} | ${String(o.runs).padStart(3)} |` +
    ` ${String((o.runs / o.devs.size).toFixed(1)).padStart(9)} | ${String(Math.round((100 * o.wins) / o.runs) + "%").padStart(7)} |`);
}

// người chơi hoạt động trong 7 ngày gần nhất (MAU thu nhỏ — dữ liệu chưa đủ một tháng)
const last = Math.max(...real.map((r) => r.at));
const win7 = new Set(real.filter((r) => r.at > last - 7 * 864e5).map((r) => r.dev));
console.log(`\n7 ngay gan nhat: ${win7.size} may hoat dong`);
const n = firstSeen.size;
console.log(`ma may 16-bit: uoc tinh ~${Math.round((n * (n - 1)) / 2 / 65536)} cap bi dem trung -> so nguoi that cao hon chut it`);

if (args.includes("--hours")) {
  const d0 = days[days.length - 1];
  const h = new Map();
  for (const r of real) if (day(r.at) === d0) {
    const k = new Date(r.at + 7 * 3600e3).toISOString().slice(11, 13);
    if (!h.has(k)) h.set(k, new Set());
    h.get(k).add(r.dev);
  }
  console.log(`\nTheo gio (${d0}, gio VN):`);
  for (const k of [...h.keys()].sort()) console.log(`  ${k}:00  ${String(h.get(k).size).padStart(3)} nguoi  ${"#".repeat(h.get(k).size)}`);
}
