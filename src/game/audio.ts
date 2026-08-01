// Tiny procedural audio engine (Web Audio API) — no asset files needed.
//  • a gentle looping background tune (soft I–vi–IV–V pads + a light pentatonic
//    melody + bass), kept quiet so it sits under the gameplay.
//  • a cheerful "board" blip when a slime hops onto its car.
// All calls are defensive no-ops if Web Audio is unavailable, and everything is
// gated behind unlock() (browsers block audio until a user gesture).

const NOTE: Record<string, number> = {
  C2: 65.41, E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
};

class GameAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  private sfxGain?: GainNode;
  private musicOn = true;
  private sfxOn = true;
  private musicTimer?: ReturnType<typeof setTimeout>;
  private started = false;

  constructor() {
    // Restore saved preferences.
    try {
      this.musicOn = localStorage.getItem("pf_music") !== "0";
      this.sfxOn = localStorage.getItem("pf_sfx") !== "0";
    } catch {
      /* storage unavailable */
    }
  }

  // Create/resume the audio context. Must be called from a user gesture.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.musicOn ? 0.12 : 0;
        this.musicGain.connect(this.master);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxOn ? 0.5 : 0;
        this.sfxGain.connect(this.master);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* audio not available */
    }
  }

  get isMusicOn() {
    return this.musicOn;
  }
  get isSfxOn() {
    return this.sfxOn;
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    try {
      localStorage.setItem("pf_music", on ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.05);
    }
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    try {
      localStorage.setItem("pf_sfx", on ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.value = on ? 0.5 : 0;
    }
  }

  // ---- one synth voice with a soft attack/decay envelope ----
  private voice(
    dest: AudioNode,
    freq: number,
    start: number,
    dur: number,
    peak: number,
    type: OscillatorType,
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const a = Math.min(0.02, dur * 0.2);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // ---- background music: schedule one 8s loop, then reschedule ----
  startMusic() {
    if (this.started || !this.ctx || !this.musicGain) return;
    this.started = true;
    const bar = 2.0; // seconds per chord
    const loopLen = bar * 4; // 4 chords per loop
    // I–vi–IV–V in C: bass + a triad pad per bar.
    const prog: Array<[string, string[]]> = [
      ["C2", ["C4", "E4", "G4"]],
      ["A2", ["A3", "C4", "E4"]],
      ["F2", ["F3", "A4", "C5"]],
      ["G2", ["G3", "B3", "D5"]],
    ];
    // a light pentatonic melody sprinkled over the loop (offset, note)
    const melody: Array<[number, string]> = [
      [0.0, "E5"], [0.5, "G5"], [1.0, "A5"], [1.5, "G5"],
      [2.0, "E5"], [2.75, "D5"], [3.5, "C5"],
      [4.0, "G4"], [4.5, "A4"], [5.0, "C5"], [5.5, "D5"],
      [6.0, "E5"], [6.75, "D5"], [7.5, "C5"],
    ];

    const scheduleLoop = () => {
      if (!this.ctx || !this.musicGain) return;
      const t0 = this.ctx.currentTime + 0.05;
      prog.forEach(([bass, triad], i) => {
        const bt = t0 + i * bar;
        this.voice(this.musicGain!, NOTE[bass], bt, bar * 0.98, 0.5, "sine"); // bass
        for (const n of triad) this.voice(this.musicGain!, NOTE[n], bt, bar * 0.9, 0.14, "triangle"); // pad
      });
      for (const [off, n] of melody) {
        this.voice(this.musicGain!, NOTE[n], t0 + off, 0.42, 0.22, "triangle");
      }
      this.musicTimer = setTimeout(scheduleLoop, loopLen * 1000);
    };
    scheduleLoop();
  }

  stopMusic() {
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = undefined;
    this.started = false;
  }

  // ---- one voice that SLIDES in pitch (for pops/whooshes) ----
  private glide(
    dest: AudioNode,
    f0: number,
    f1: number,
    start: number,
    dur: number,
    peak: number,
    type: OscillatorType,
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur * 0.9);
    const a = Math.min(0.012, dur * 0.2);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // ---- SFX: a slime hops aboard → a cute bubbly "pop" (pitch pops upward),
  // with a tiny random wobble so rapid pickups sound lively rather than identical.
  board() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const base = 480 * (0.92 + Math.random() * 0.2);
    this.glide(this.sfxGain, base, base * 2.0, t, 0.12, 0.5, "sine"); // the pop
    this.voice(this.sfxGain, base * 3, t, 0.03, 0.14, "triangle"); // soft attack click
  }

  // ---- SFX: a slime is eaten → a SOFT, small, quick pop. Much gentler than board()
  // because pickups now stream fast (~12/s) — this reads as a satisfying light munch
  // rather than a wall of loud pops. Tiny random wobble keeps rapid pops lively.
  pop() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const base = 640 * (0.93 + Math.random() * 0.16);
    this.glide(this.sfxGain, base, base * 1.7, t, 0.05, 0.16, "sine"); // short soft pop
  }

  // ---- SFX: xu bay vào ví (màn thắng) — bản HIỆN ĐẠI (user 2026-08-01, thay kiểu 2-nốt
  // chiptune retro): "plink" thuỷ tinh — sine cơ bản decay mượt + partial chuông 2.76×
  // + shimmer cao mảnh; MỖI XU ĐÁP LÊN MỘT NẤC pentatonic → cả tràng thành hợp âm rải
  // đi lên nghe sang, không phải một tiếng lặp 13 lần.
  coin() {
    if (!this.ctx || !this.sfxGain) return;
    // v4 (user 2026-08-01): BỎ nhích cao theo tràng — mọi xu cùng cao độ, chỉ wobble ngẫu
    // nhiên rất nhẹ cho tự nhiên. Chất kim loại giữ nguyên: clink ngắn + ngân + partial
    // lệch hài 1.34× + ánh xu mảnh.
    const t = this.ctx.currentTime;
    const f = 1568 * (0.99 + Math.random() * 0.02); // G6, wobble ±1%
    this.voice(this.sfxGain, f * 1.02, t, 0.03, 0.16, "triangle"); // cú gõ clink
    this.voice(this.sfxGain, f, t + 0.008, 0.22, 0.18, "sine"); // thân ngân
    this.voice(this.sfxGain, f * 1.343, t + 0.008, 0.14, 0.05, "sine"); // partial lệch hài (kim loại)
    this.voice(this.sfxGain, f * 2.1, t + 0.01, 0.07, 0.025, "sine"); // ánh xu mảnh
  }

  // ---- JINGLE thắng ván (màn LEVEL COMPLETE, user 2026-08-01): fanfare game-style ~2s —
  // 4 nốt chạy vút lên → hợp âm C-trưởng ngân + bass → đuôi giai điệu nhí nhảnh E-D-C
  // trên cao + shimmer glissando. To hơn SFX thường một chút cho ra chất ăn mừng.
  // ⚖ BẢN QUYỀN AN TOÀN: soạn nguyên bản 100% bằng synth (không sample/file nhạc); chỉ dùng
  // chất liệu nhạc lý chung (arpeggio + hợp âm trưởng — không bảo hộ được), KHÔNG mô phỏng
  // giai điệu/tiết tấu của fanfare nổi tiếng nào (Mario/FF... có cấu trúc đặc trưng khác hẳn).
  victory() {
    if (!this.ctx || !this.sfxGain) return;
    // v2 "triumphant" (user 2026-08-01 "hoành tráng hơn tẹo"): chạy KÉP có bè quãng 3 →
    // HIT C-trưởng + thump timpani → nâng qua G-trưởng (dominant lift) → HIT CUỐI C-trưởng
    // trải 2 quãng + bass đôi + shimmer kép + chuông đuôi. ~2.6s.
    const t = this.ctx.currentTime;
    // To hơn 1 chút (user 2026-08-01): jingle thắng đi qua 1 gain khuếch đại riêng (~1.4×)
    // nối vào sfxGain, nên chỉ jingle này to lên chứ không đụng SFX khác.
    const g = this.ctx.createGain();
    g.gain.value = 1.4;
    g.connect(this.sfxGain);
    // (v3 "vui tai" 2026-08-01) boing hoạt hình + 2 nốt nhún staccato lấy đà trước khi chạy
    this.glide(g, NOTE.C5 * 0.75, NOTE.C5 * 1.05, t, 0.09, 0.16, "sine"); // boing nhỏ
    this.voice(g, NOTE.C5, t + 0.02, 0.06, 0.2, "triangle");
    this.voice(g, NOTE.E5, t + 0.1, 0.06, 0.2, "triangle");
    const t0 = t + 0.18; // chạy kép bắt đầu sau cú nhún
    // chạy kép vút lên (giai điệu + bè dưới quãng 3)
    const run = [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5];
    const har = [NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5];
    run.forEach((f, i) => this.voice(g, f, t0 + i * 0.085, 0.15, 0.32, "triangle"));
    har.forEach((f, i) => this.voice(g, f, t0 + i * 0.085, 0.15, 0.15, "triangle"));
    // HIT 1: C trưởng + thump trống trầm
    const c1 = t0 + 0.36;
    this.glide(g, 160, 55, c1, 0.24, 0.5, "sine"); // thump timpani
    this.voice(g, NOTE.C3, c1, 0.45, 0.4, "sine");
    for (const f of [NOTE.C5, NOTE.E5, NOTE.G5]) this.voice(g, f, c1, 0.38, 0.15, "triangle");
    // NÂNG: G trưởng (bậc V — lấy đà khải hoàn)
    const c2 = t0 + 0.76;
    this.voice(g, NOTE.G2, c2, 0.38, 0.36, "sine");
    for (const f of [NOTE.G4, NOTE.B3 * 2, NOTE.D5]) this.voice(g, f, c2, 0.32, 0.14, "triangle");
    // HIT CUỐI: C trưởng trải 2 quãng + bass đôi + thump + shimmer kép + chuông đuôi
    const c3 = t0 + 1.1;
    this.glide(g, 180, 50, c3, 0.3, 0.55, "sine");
    this.voice(g, NOTE.C2, c3, 1.5, 0.4, "sine");
    this.voice(g, NOTE.C3, c3, 1.5, 0.28, "sine");
    for (const f of [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C5 * 2, NOTE.E5 * 2]) this.voice(g, f, c3, 1.3, 0.13, "triangle");
    this.glide(g, 900, 3200, c3, 0.7, 0.07, "sine");
    this.glide(g, 1400, 4200, c3 + 0.15, 0.6, 0.05, "sine");
    this.voice(g, NOTE.G5 * 2, c3 + 0.5, 0.6, 0.11, "sine"); // chuông đuôi cao
    // đuôi ECHO NGHỊCH (vui tai): 4 nốt staccato nhảy lóc cóc đáp lại trên cao
    const e0 = c3 + 0.55;
    const echo = [NOTE.E5 * 2, NOTE.G5 * 2, NOTE.E5 * 2, NOTE.C5 * 2];
    echo.forEach((f, i) => this.voice(g, f, e0 + i * 0.11, 0.07, 0.14, "triangle"));
  }

  // ---- SFX: a car fills up and drives off → a bright ascending sparkle-chime,
  // clearly different from the pickup pop.
  finish() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const run = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C5 * 2];
    run.forEach((f, i) => this.voice(this.sfxGain!, f, t + i * 0.075, 0.17, 0.42, "triangle"));
    // a whoosh under it + a shimmering bell on top
    this.glide(this.sfxGain, 300, 900, t, 0.28, 0.22, "sine");
    this.voice(this.sfxGain, NOTE.E5 * 2, t + 0.28, 0.45, 0.2, "sine");
  }
}

export const Audio = new GameAudio();
