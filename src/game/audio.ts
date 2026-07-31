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

  // ---- SFX: xu bay vào ví (màn thắng) → "ding" đồng xu cổ điển: 2 nốt vút B5→E6 + lớp
  // ánh kim mỏng phía trên; wobble nhẹ để đàn xu nghe leng keng lấp lánh, không lặp y hệt.
  coin() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const w = 0.97 + Math.random() * 0.06;
    this.voice(this.sfxGain, 987.77 * w, t, 0.07, 0.3, "triangle");
    this.voice(this.sfxGain, 1318.51 * w, t + 0.07, 0.3, 0.32, "triangle");
    this.voice(this.sfxGain, 2637.02 * w, t + 0.07, 0.16, 0.09, "sine"); // ánh kim
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
