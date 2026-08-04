// calib — THƯỚC WINRATE ĐÃ HIỆU CHUẨN, dùng chung cho tuner và cho winrate-cal.mjs.
//
// p_that = sigmoid(A_CAL + B_CAL · logit((B + D)/2))
//
// Vì sao: chấm trên 67 ván thật / 21 level, không mô hình đơn lẻ nào thắng nổi việc đoán bừa
// một hằng số (LL -46.4): E -48.6 · D -54.3 · A -57.0 · B -74.2 · C -84.9. B và D lệch NGƯỢC
// CHIỀU ở vùng khó, nên trung bình rồi nắn đạt LL -39.4 (kiểm tra chéo leave-one-out).
// Chi tiết + cách khớp lại hệ số: scripts/winrate-cal.mjs --fit.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { measure2 } from "./simcore2.mjs";

// khớp 2026-08-04 trên 67 ván / 21 level (L15-32 + L41-43)
export const A_CAL = Number(process.env.A_CAL ?? -0.6626);
export const B_CAL = Number(process.env.B_CAL ?? 1.0070);

export const logit = (p) => { p = Math.min(0.97, Math.max(0.03, p / 100)); return Math.log(p / (1 - p)); };
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const cal = (raw) => Math.round(100 * sigmoid(A_CAL + B_CAL * logit(raw)));
export const blend = (b, d) => cal((b + (d ?? b)) / 2);

// ---- chấm D cho CẢ LÔ level trong một lần spawn ------------------------------------------
// levels: mảng object level. Trả về mảng winrate D cùng thứ tự (null nếu lỗi).
export function measureDBatch(levels, opts = {}) {
  if (!levels.length) return [];
  const { skill = 0.75, trials = 60, tag = "d" } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hopin-" + tag + "-"));
  const file = path.join(dir, "cand.json");
  const map = {};
  levels.forEach((L, i) => { map[i + 1] = L; });
  fs.writeFileSync(file, JSON.stringify(map));
  try {
    const txt = execFileSync(process.execPath, ["scripts/build-levels.mjs", "--mech-json"], {
      env: { ...process.env, MECH_IN: file, LEVELS: levels.map((_, i) => i + 1).join(","), SKILL: String(skill), TRIALS: String(trials) },
      encoding: "utf8", maxBuffer: 1e9,
    });
    const m = txt.match(/MECH_JSON (\{.*\})/);
    if (!m) throw new Error("khong doc duoc MECH_JSON");
    const j = JSON.parse(m[1]);
    return levels.map((_, i) => (j[i + 1] && j[i + 1].win != null ? j[i + 1].win : null));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* kệ */ }
  }
}

// ---- chấm cả lô bằng thước hiệu chuẩn ------------------------------------------------------
// Trả về [{b, d, raw, win}] — win là con số ĐÃ NẮN, tức winrate người thật dự đoán.
export function gradeBatch(levels, opts = {}) {
  const { n = 120 } = opts;
  const b = levels.map((L) => measure2(L, n));
  const d = measureDBatch(levels, opts);
  return levels.map((_, i) => {
    const raw = (b[i] + (d[i] ?? b[i])) / 2;
    return { b: b[i], d: d[i], raw: Math.round(raw), win: cal(raw) };
  });
}
