// Bảng "mỗi level có bao nhiêu người chơi, thắng bao nhiêu %" từ ván chơi THẬT trên Firebase.
//
//   node scripts/level-stats.mjs --file runs.json            # từ bản Export JSON của Firebase console
//   FB_SECRET=<khoá> node scripts/level-stats.mjs            # hoặc đọc thẳng, cần khoá
//   … --days 7          # đổi khung ngày (mặc định 2)
//   … --all             # tính cả localhost (ván mình tự test)
//   … --skip M-3536,…   # loại đích danh vài thiết bị
//   … --json            # xuất JSON để dùng tiếp
//
// Vì sao cần `--skip`: bộ lọc nguồn chỉ bắt được ván test chạy trên localhost/mạng LAN. Ván
// ta tự chơi trên CHÍNH trang CrazyGames thì mang đúng tên máy chủ như người chơi thật, và
// `pf_device` lưu trong localStorage theo từng origin nên mã máy ở đó KHÔNG trùng mã máy ở
// localhost — không có cách nào tự nhận ra. Lấy mã bằng tay (DevTools → Local Storage →
// pf_device, ngay trên trang CrazyGames) rồi truyền vào đây.
//
// Có `--file` vì lấy khoá đọc phiền hơn hẳn việc bấm Export JSON trong console, mà hai đường
// cho ra đúng một thứ: RTDB export ra chính cái JSON mà REST trả về.
//
// Khác `pull-runs.mjs` ở hai điểm, và đó là lý do nó tồn tại riêng:
//  1. Đếm NGƯỜI (dev duy nhất) chứ không chỉ đếm ván. Một người chơi lại 20 lần một level khó
//     sẽ kéo winrate xuống thấp hơn thực tế nếu chỉ đếm ván, nên bảng này in cả hai cột và
//     thêm cột "ván/người" để thấy ngay level nào đang bị cày lại nhiều.
//  2. Lọc theo NGÀY và theo NGUỒN. Ván test trên localhost trộn chung với ván người chơi thật
//     chính là thứ đã làm hỏng một đợt hiệu chuẩn (LEVEL-DESIGN.md §2.5).
//
// Khoá đọc: Firebase console → ⚙ Project settings → Service accounts → Database secrets.
// KHÔNG commit khoá.
const DB = "https://hop-n-7d1af-default-rtdb.asia-southeast1.firebasedatabase.app";
const SECRET = process.env.FB_SECRET;
const argv = process.argv.slice(2);
const ALL = argv.includes("--all");
const JSON_OUT = argv.includes("--json");
const DAYS = Number(argv[argv.indexOf("--days") + 1]) || 2;
const FILE = argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : null;

let raw;
if (FILE) {
  const fs = await import("node:fs");
  raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  // Console export bọc thêm một lớp {"runs": {...}} nếu xuất từ gốc CSDL; xuất từ nút /runs
  // thì không. Nhận cả hai để khỏi phải dặn bạn bấm đúng chỗ nào.
  if (raw && raw.runs && typeof raw.runs === "object") raw = raw.runs;
} else {
  if (!SECRET) {
    console.error("Thieu du lieu: dua --file <ban export JSON>, hoac dat FB_SECRET. Xem chu thich dau file.");
    process.exit(1);
  }
  const res = await fetch(`${DB}/runs.json?auth=${encodeURIComponent(SECRET)}`);
  if (!res.ok) {
    console.error(`Doc that bai: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  raw = await res.json();
}
if (!raw) {
  console.log("Chua co van nao.");
  process.exit(0);
}
const all = Object.values(raw);

// Mốc thời gian: NGÀY LỊCH ở máy đang chạy, không phải "24h × N giờ trước". `--days 2` =
// hôm nay + hôm qua, đúng như cách người ta nói "dữ liệu 2 ngày nay".
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
const since = midnight.getTime() - (DAYS - 1) * 86400000;

// Máy nhà = ván tự test. Nhận diện qua tên máy chủ chứ không qua `host`, vì bản `web` chạy
// trên máy dev và bản `web` deploy thật đều mang host = "web".
const isLocal = (r) => /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(String(r.from ?? ""));

const SKIP = new Set(
  (argv.includes("--skip") ? argv[argv.indexOf("--skip") + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean),
);

const rows = all.filter(
  (r) => Number.isFinite(r.at) && r.at >= since && (ALL || !isLocal(r)) && !SKIP.has(r.dev),
);

if (!rows.length) {
  console.log(`Khong co van nao trong ${DAYS} ngay gan nhat${ALL ? "" : " (tu nguoi choi that)"}.`);
  console.log(`Tong so van trong CSDL: ${all.length}.`);
  const src = {};
  for (const r of all) src[`${r.host ?? "?"}@${r.from ?? "?"}`] = (src[`${r.host ?? "?"}@${r.from ?? "?"}`] ?? 0) + 1;
  console.log("Theo nguon:", Object.entries(src).map(([k, v]) => `${k}=${v}`).join("  "));
  process.exit(0);
}

const byLevel = new Map();
for (const r of rows) {
  const lv = Number(r.lvl);
  if (!Number.isFinite(lv)) continue;
  let b = byLevel.get(lv);
  if (!b) byLevel.set(lv, (b = { n: 0, win: 0, devs: new Set(), winDevs: new Set() }));
  b.n++;
  b.devs.add(r.dev ?? "?");
  if (r.result === "win") { b.win++; b.winDevs.add(r.dev ?? "?"); }
}

const levels = [...byLevel.keys()].sort((a, b) => a - b);
const out = levels.map((lv) => {
  const b = byLevel.get(lv);
  return {
    lvl: lv,
    users: b.devs.size,
    runs: b.n,
    wins: b.win,
    winrateRuns: Math.round((100 * b.win) / b.n),          // theo ván — thước để so với bản mô phỏng
    winrateUsers: Math.round((100 * b.winDevs.size) / b.devs.size), // theo người — "bao nhiêu % người qua được"
    runsPerUser: +(b.n / b.devs.size).toFixed(1),
  };
});

if (JSON_OUT) {
  console.log(JSON.stringify({ days: DAYS, since, includeLocal: ALL, levels: out }, null, 2));
  process.exit(0);
}

const players = new Set(rows.map((r) => r.dev ?? "?")).size;
const from = new Date(since).toLocaleDateString("vi-VN");
console.log(`${DAYS} ngay gan nhat (tu ${from}) — ${rows.length} van, ${players} nguoi choi${ALL ? " (KE CA localhost)" : ""}`);
// `pf_device` chi co 16 bit (65536 ma) nen hai may co the trung ma. So ma trung ky vong la
// N²/(2·65536) — voi vai tram nguoi thi khoang 1-2 nguoi bi dem thieu, khong dang ke, nhung
// neu co ngay chuc nghin nguoi thi con so "nguoi choi" bat dau lech that.
const dup = (players * players) / 131072;
if (dup >= 1) console.log(`(ma may 16-bit: uoc tinh ~${dup.toFixed(0)} nguoi bi dem trung, so "nguoi choi" hoi thap hon that)`);
const srcs = {};
for (const r of rows) srcs[`${r.host ?? "?"}@${r.from ?? "?"}`] = (srcs[`${r.host ?? "?"}@${r.from ?? "?"}`] ?? 0) + 1;
console.log("Nguon:", Object.entries(srcs).map(([k, v]) => `${k}=${v}`).join("  "));

console.log("\n| Level | Nguoi choi | Van | Thang | Winrate/van | Winrate/nguoi | Van/nguoi |");
console.log("|------:|-----------:|----:|------:|------------:|--------------:|----------:|");
for (const r of out) {
  // Dưới 5 ván thì con số chỉ là nhiễu — đánh dấu để không ai đem nó đi chỉnh level.
  const note = r.runs < 5 ? " *" : "";
  console.log(
    `| L${r.lvl} | ${r.users} | ${r.runs} | ${r.wins} | ${r.winrateRuns}%${note} | ${r.winrateUsers}% | ${r.runsPerUser} |`,
  );
}
if (out.some((r) => r.runs < 5)) console.log("\n* = duoi 5 van, con so chi la nhieu, dung dung de chinh level.");
