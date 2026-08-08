// Nhật ký chơi lưu NGAY TRÊN MÁY — để lấy được dữ liệu cả khi chơi trên GitHub Pages.
//
// Vì sao cần: bản deploy là web tĩnh, không có server nào nhận `/api/hoplog`, nên mọi ván
// chơi trên GitHub trước nay bốc hơi sạch (fetch 404 rồi bị .catch nuốt). Ở đây mỗi ván
// được gói lại và cất vào localStorage, gắn kèm NGÀY và MÃ THIẾT BỊ, rồi Settings cho phép
// chép ra clipboard theo từng ngày / từng máy.
//
// Định dạng xuất = ĐÚNG định dạng playlog.jsonl trên máy dev (mỗi dòng một JSON), nên dán
// thẳng vào file đó là mấy công cụ phát lại (scripts/replay2.mjs, simcore.mjs trips) dùng
// được ngay, không phải chuyển đổi gì.

import { platform } from "../platform";
const KEY_RUNS = "pf_runs";       // các ván đã lưu
const KEY_DEVICE = "pf_device";   // mã thiết bị (sinh một lần cho mỗi máy/trình duyệt)
const MAX_RUNS = 300;             // giữ lại bấy nhiêu ván gần nhất (localStorage ~5MB)

export interface LogEvent { ev: string; [k: string]: unknown }
export interface PlayRun {
  dev: string;      // mã thiết bị
  day: string;      // YYYY-MM-DD theo giờ máy
  ts: number;       // mốc thời gian kết thúc ván
  lvl: number;
  result: "win" | "lose";
  ms: number;
  ev: LogEvent[];   // toàn bộ chuỗi sự kiện: start → launch/bayTap/trip → result
}

// Mã thiết bị ngắn, dễ đọc để phân biệt điện thoại với máy tính: "M-4F7A".
export function deviceId(): string {
  try {
    let d = platform.storage.getItem(KEY_DEVICE);
    if (!d) {
      d = "M-" + Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
      platform.storage.setItem(KEY_DEVICE, d);
    }
    return d;
  } catch {
    return "M-????";
  }
}

function today(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function loadRuns(): PlayRun[] {
  try {
    const raw = platform.storage.getItem(KEY_RUNS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Cất một ván. Cắt bớt ván cũ nhất khi vượt trần, và nếu localStorage đầy thì cắt tiếp
// rồi thử lại — thà mất ván cũ còn hơn mất ván vừa chơi.
export function saveRun(lvl: number, result: "win" | "lose", ms: number, ev: LogEvent[]) {
  const run: PlayRun = { dev: deviceId(), day: today(), ts: Date.now(), lvl, result, ms, ev };
  let runs = loadRuns();
  runs.push(run);
  if (runs.length > MAX_RUNS) runs = runs.slice(runs.length - MAX_RUNS);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      platform.storage.setItem(KEY_RUNS, JSON.stringify(runs));
      return;
    } catch {
      runs = runs.slice(Math.ceil(runs.length / 2)); // hết chỗ → bỏ nửa cũ, thử lại
      if (!runs.length) return;
    }
  }
}

export function clearRuns() {
  try { platform.storage.removeItem(KEY_RUNS); } catch { /* ignore */ }
}

export interface DayGroup { day: string; dev: string; runs: number; wins: number; levels: number[] }

// Gom theo (ngày × thiết bị) — user muốn lấy log "theo ngày, và theo thiết bị".
export function groupRuns(runs = loadRuns()): DayGroup[] {
  const m = new Map<string, DayGroup>();
  for (const r of runs) {
    const k = r.day + "|" + r.dev;
    let g = m.get(k);
    if (!g) { g = { day: r.day, dev: r.dev, runs: 0, wins: 0, levels: [] }; m.set(k, g); }
    g.runs++;
    if (r.result === "win") g.wins++;
    if (!g.levels.includes(r.lvl)) g.levels.push(r.lvl);
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)); // mới nhất trước
}

// Xuất ra JSONL. Không truyền filter = lấy tất cả.
export function exportJsonl(filter?: { day?: string; dev?: string }): string {
  const runs = loadRuns().filter((r) =>
    (!filter?.day || r.day === filter.day) && (!filter?.dev || r.dev === filter.dev));
  const lines: string[] = [];
  for (const r of runs) {
    for (const e of r.ev) lines.push(JSON.stringify({ lvl: r.lvl, dev: r.dev, day: r.day, ...e }));
  }
  return lines.join("\n");
}

// Chép vào clipboard. Trên điện thoại chỉ chạy khi gọi TRONG một cú chạm và trang là https
// (GitHub Pages thoả cả hai). Trả về false để chỗ gọi còn báo cho người chơi biết mà xử lý.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* rơi xuống cách dự phòng */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
