// Chạy _tuneAll --scan trên NHIỀU TIẾN TRÌNH song song rồi gộp kết quả.
//
//   RANGE=501-530 N_B=200 node scripts/scan-shards.mjs
//   RANGE=41-586 FIVESONLY=1 N_B=200 NSHARD=12 OUT=scripts/_ch node scripts/scan-shards.mjs
//
// Env: RANGE · ONLY · FIVESONLY · N_B · NSHARD (mặc định = số CPU trừ 4, tối đa 12) · OUT (tiền
// tố file, mặc định scripts/_scan) · KEEP_OLD (bỏ qua các level này).
//
// VÌ SAO LÀ MỘT FILE chứ không phải một dòng shell. Trước đây bước này là
//     for i in $(seq 0 11); do ( SHARD=$i ... node scripts/_tuneAll.mjs --scan ) & done; wait
// Một dòng ghép `cd && rm && for … & done; wait` thì KHÔNG THỂ đưa vào allowlist quyền của
// Claude Code — mẫu cho phép là theo tiền tố lệnh, mà dòng đó có vòng lặp, nền, và ba lệnh nối
// nhau. Hệ quả: mỗi lượt quét lại phải bấm duyệt tay (user 2026-08-14 hỏi hai lần "sao vẫn
// hỏi?"). Gói thành một file thì chỉ cần một dòng allowlist, và bonus là lượt quét thành thứ
// chạy lại được y hệt thay vì một dòng lịch sử terminal.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const NSHARD = Number(process.env.NSHARD || Math.max(1, Math.min(12, os.cpus().length - 4)));
const OUT = process.env.OUT || "scripts/_scan";
const PASS = ["RANGE", "ONLY", "FIVESONLY", "N_B", "HITS", "CAPS", "WAVES", "MINCAR_LADDER",
  "FIVE_FROM", "FIVE_BAND", "CHOCO_RANGE", "CHOCO_BAND"];

for (const f of fs.readdirSync("scripts"))
  if (f.startsWith(OUT.split("/").pop()) && (f.endsWith(".json") || f.endsWith(".err")))
    fs.unlinkSync("scripts/" + f);

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("SHARD")) delete env[k];

let done = 0;
const t0 = Date.now();
const kids = [];
for (let i = 0; i < NSHARD; i++) {
  const e = { ...env, SHARD: String(i), NSHARD: String(NSHARD), OUT: `${OUT}-${i}.json` };
  const err = fs.openSync(`${OUT}-${i}.err`, "w");
  const k = spawn(process.execPath, ["scripts/_tuneAll.mjs", "--scan"], { env: e, stdio: ["ignore", "ignore", err] });
  k.on("exit", (code) => {
    done++;
    if (code !== 0) console.error(`shard ${i} loi, ma ${code} — xem ${OUT}-${i}.err`);
    if (done === NSHARD) finish();
  });
  kids.push(k);
}
console.error(`${NSHARD} shard | ${PASS.filter((k) => env[k]).map((k) => k + "=" + env[k]).join(" ")}`);

function finish() {
  const rows = [];
  for (let i = 0; i < NSHARD; i++) {
    const f = `${OUT}-${i}.json`;
    if (fs.existsSync(f)) { try { rows.push(...JSON.parse(fs.readFileSync(f, "utf8"))); } catch { /* shard chet giua chung */ } }
  }
  rows.sort((a, b) => a.n - b.n);
  fs.writeFileSync(`${OUT}-all.json`, JSON.stringify(rows));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`quet xong ${rows.length} level trong ${secs}s → ${OUT}-all.json`);
  const bad = rows.filter((r) => r.off > 0);
  console.log(bad.length ? `  ngoai dai: ${bad.map((r) => "L" + r.n + "=" + r.b).join("  ")}` : "  tat ca trong dai");
}
