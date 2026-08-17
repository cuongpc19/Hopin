// BÁO CÁO PHÉP THỬ A/B 15 MÀN ĐẦU — nhánh A (bản launch 2026-08-13) so với nhánh B (bản hiện tại).
//
//   FB_SECRET=<khoá> node scripts/ab-report.mjs               # đọc thẳng Firebase
//   node scripts/ab-report.mjs --runs runs.json --sessions sessions.json   # từ bản Export JSON
//   … --days 7        # khung ngày (mặc định: tất cả)
//   … --all           # tính cả localhost (ván mình tự test)
//   … --skip M-3536   # loại đích danh vài thiết bị (xem chú thích ở level-stats.mjs)
//
// Vì sao có bản CLI dù `site/stats.html` đã có mục A/B: trang ấy cần đăng nhập Google trong
// trình duyệt, còn ở đây thì chạy được trong một vòng lặp, một cron, hay lúc chỉ có cái
// terminal. Hai bên tính CÙNG một công thức — sửa một bên thì sửa cả bên kia.
//
// Khoá đọc: Firebase console → ⚙ Project settings → Service accounts → Database secrets.
// KHÔNG commit khoá.
import fs from "node:fs";

const DB = "https://hop-n-7d1af-default-rtdb.asia-southeast1.firebasedatabase.app";
const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const ALL = argv.includes("--all");
const DAYS = Number(arg("--days")) || 0;
const SKIP = new Set((arg("--skip") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const SECRET = process.env.FB_SECRET;

async function pull(node, file) {
  if (file) {
    let raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && raw[node] && typeof raw[node] === "object") raw = raw[node]; // export từ gốc CSDL
    return Object.values(raw ?? {});
  }
  if (!SECRET) {
    console.error("Thieu du lieu: dua --runs/--sessions <ban export>, hoac dat FB_SECRET.");
    process.exit(1);
  }
  const res = await fetch(`${DB}/${node}.json?auth=${encodeURIComponent(SECRET)}`);
  if (!res.ok) {
    // /sessions chỉ tồn tại từ bản 2026-08-17 và cần luật riêng đã deploy — thiếu nó thì các
    // cột về phiên để trống chứ cả báo cáo không chết theo.
    console.error(`(khong doc duoc /${node}: HTTP ${res.status})`);
    return [];
  }
  return Object.values((await res.json()) ?? {});
}

const runsAll = await pull("runs", arg("--runs"));
const sessAll = await pull("sessions", arg("--sessions"));

const isLocal = (r) => /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(String(r.from ?? ""));
const since = DAYS ? new Date().setHours(0, 0, 0, 0) - (DAYS - 1) * 86400000 : 0;
const keep = (r) =>
  Number.isFinite(r.at) && r.at >= since && r.at < Date.now() + 36e5 && (ALL || !isLocal(r)) && !SKIP.has(r.dev);

// GỘP LƯỢT ĐÃ REVIVE — cùng luật với level-stats.mjs: `lose()` gửi dòng ngay trước khi người
// chơi thấy nút Revive, nên một lượt revive-rồi-thắng để lại hai dòng.
const rowsR = runsAll.filter((r) => keep(r) && r.lvl != null);
const byRun = new Map();
for (const r of rowsR) {
  if (!r.run) continue;
  const k = r.dev + "|" + r.lvl + "|" + r.run;
  const cur = byRun.get(k);
  if (!cur || (r.revives ?? 0) > (cur.revives ?? 0)) byRun.set(k, r);
}
const runs = rowsR.filter((r) => !r.run || byRun.get(r.dev + "|" + r.lvl + "|" + r.run) === r);
const sess = sessAll.filter(keep);

const day = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10); // cắt ngày theo giờ VN
const nextDay = (d) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const lastCal = runs.length || sess.length ? day(Math.max(...[...runs, ...sess].map((r) => r.at))) : null;

function stat(v) {
  const R = runs.filter((r) => r.ab === v);
  const S = sess.filter((r) => r.ab === v);
  const early = R.filter((r) => r.lvl <= 15 && r.daily == null);
  const devs = new Set([...R, ...S].map((r) => r.dev));
  const starts = S.filter((r) => r.ev === "start").length;
  const min1 = S.filter((r) => r.ev === "min1").length;
  const ends = S.filter((r) => r.ev === "end" && r.ms > 0);
  const dayOf = new Map(), first = new Map();
  for (const r of [...R, ...S]) {
    if (!dayOf.has(r.dev)) dayOf.set(r.dev, new Set());
    dayOf.get(r.dev).add(day(r.at));
    if (!first.has(r.dev) || r.at < first.get(r.dev)) first.set(r.dev, r.at);
  }
  let coh = 0, back = 0;
  for (const [dev, t0] of first) {
    if (nextDay(day(t0)) > lastCal) continue; // chưa đủ một ngày sau thì chưa đo được D1
    coh++;
    if (dayOf.get(dev).has(nextDay(day(t0)))) back++;
  }
  const ret = [...devs].filter((d) => (dayOf.get(d)?.size ?? 0) > 1).length;
  return {
    v, devs: devs.size, starts, min1, ends: ends.length,
    sec: ends.length ? Math.round(ends.reduce((s, r) => s + r.ms, 0) / ends.length / 1000) : null,
    runs: early.length, wins: early.filter((r) => r.result === "win").length,
    coh, back, ret,
    passed15: new Set(early.filter((r) => r.lvl === 15 && r.result === "win").map((r) => r.dev)).size,
    perLv: early,
  };
}

// Kiểm định hai tỉ lệ. In p ra CẠNH mọi chênh lệch, vì đây đúng là chỗ dễ đọc nhầm nhất:
// với vài chục người mỗi nhánh, lệch 5-10 điểm là chuyện thường của may rủi.
function zTest(a, na, b, nb) {
  if (!na || !nb) return null;
  const p = (a + b) / (na + nb), se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  if (!se) return null;
  const z = (a / na - b / nb) / se, x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 1 - erf;
}
const pStr = (p) => (p == null ? "     -" : (p < 0.05 ? "*" : " ") + "p=" + p.toFixed(3));

const A = stat("A"), B = stat("B");
const out = new Set([...runs, ...sess].filter((r) => r.ab === "-" || r.ab == null).map((r) => r.dev)).size;

console.log(`A/B 15 man dau — ${DAYS ? DAYS + " ngay gan nhat" : "tat ca"}${ALL ? " (KE CA localhost)" : ""}`);
console.log(`Trong phep thu: A=${A.devs} nguoi · B=${B.devs} nguoi · ngoai phep thu (nguoi cu / ban truoc do): ${out}`);
if (!sess.length) console.log('(chua co dong /sessions nao — cot "phien" va ">1 phut" de trong)');

const line = (k, a, b, p) => console.log(`${k.padEnd(22)}| ${String(a).padStart(11)} | ${String(b).padStart(13)} | ${pStr(p)}`);
console.log("\n" + "".padEnd(22) + "|  A (launch) |  B (hien tai) | y nghia");
console.log("".padEnd(22, "-") + "|-------------|---------------|--------");
line("Nguoi choi", A.devs, B.devs, null);
line("Phien mo", A.starts, B.starts, null);
line(">1 phut", A.starts ? `${pct(A.min1, A.starts)}%` : "-", B.starts ? `${pct(B.min1, B.starts)}%` : "-",
  zTest(A.min1, A.starts, B.min1, B.starts));
line("Thoi gian/phien", A.sec == null ? "-" : A.sec + "s", B.sec == null ? "-" : B.sec + "s", null);
line("Van L1-15", A.runs, B.runs, null);
line("Winrate/van", A.runs ? `${pct(A.wins, A.runs)}%` : "-", B.runs ? `${pct(B.wins, B.runs)}%` : "-",
  zTest(A.wins, A.runs, B.wins, B.runs));
line("D1", A.coh ? `${pct(A.back, A.coh)}%` : "-", B.coh ? `${pct(B.back, B.coh)}%` : "-",
  zTest(A.back, A.coh, B.back, B.coh));
line("Quay lai (>=2 ngay)", A.devs ? `${pct(A.ret, A.devs)}%` : "-", B.devs ? `${pct(B.ret, B.devs)}%` : "-",
  zTest(A.ret, A.devs, B.ret, B.devs));
line("Qua duoc L15", A.passed15, B.passed15, null);
console.log("* = p < 0.05. Khong co dau sao thi chenh lech nam trong khoang may rui — DUNG ket luan.");

// ---- phễu từng bàn ---------------------------------------------------------------------------
// Chỉ 5 bàn (L2, L7, L9, L11, L15) thật sự khác nhau; đánh dấu để khỏi đọc nhiễu ở 10 bàn còn lại.
const DIFF = new Set([2, 7, 9, 11, 15]);
const per = (list) => {
  const m = new Map();
  for (const r of list) {
    if (!m.has(r.lvl)) m.set(r.lvl, { devs: new Set(), pass: new Set(), n: 0, w: 0 });
    const o = m.get(r.lvl);
    o.devs.add(r.dev); o.n++;
    if (r.result === "win") { o.w++; o.pass.add(r.dev); }
  }
  return m;
};
const mA = per(A.perLv), mB = per(B.perLv);
if (mA.size || mB.size) {
  console.log("\nlv   |  A nguoi  A qua   |  B nguoi  B qua   |");
  for (let n = 1; n <= 15; n++) {
    const a = mA.get(n), b = mB.get(n);
    const f = (o) => (o ? `${String(o.devs.size).padStart(7)}  ${String(pct(o.pass.size, o.devs.size) + "%").padStart(5)}` : "      -      -");
    console.log(`L${String(n).padEnd(3)}${DIFF.has(n) ? "*" : " "}| ${f(a)}   | ${f(b)}   |`);
  }
  console.log("* = bàn hai nhánh KHÁC nhau. Mười bàn còn lại giống hệt — chênh lệch ở chúng là nhiễu.");
}
