/** Small procedural sound engine: engine hum, ambient pad and UI/event cues. */
export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  engOsc: OscillatorNode[] = [];
  engGain!: GainNode;
  engFilter!: BiquadFilterNode;
  muted = false;
  private tickT = 0;
  private sirenOn = 0;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    // engine
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 260;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    for (const [type, f] of [['sawtooth', 42], ['triangle', 84]] as [OscillatorType, number][]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(this.engFilter); o.start(); this.engOsc.push(o);
    }
    // ambient pad
    const pad = ctx.createGain(); pad.gain.value = 0.022; pad.connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.012; lfo.connect(lfoG); lfoG.connect(pad.gain); lfo.start();
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 900; padF.connect(pad);
    for (const f of [110, 164.8, 220, 277.2, 329.6]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = Math.random() * 8 - 4;
      const g = ctx.createGain(); g.gain.value = f > 250 ? 0.35 : 0.6; o.connect(g); g.connect(padF); o.start();
    }
  }
  setMuted(m: boolean) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }

  engine(speed: number, braking: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = speed / 345;
    this.engOsc[0].frequency.setTargetAtTime(38 + k * 46, t, 0.2);
    this.engOsc[1].frequency.setTargetAtTime(76 + k * 92, t, 0.2);
    this.engFilter.frequency.setTargetAtTime(200 + k * 380 + (braking ? -60 : 0), t, 0.2);
    this.engGain.gain.setTargetAtTime(0.035 + k * 0.035, t, 0.3);
  }
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, when = 0, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, freq: number, vol = 0.1, q = 1, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }
  click() { this.tone(880, 0.06, 'triangle', 0.08); }
  tick(dt: number, on: boolean) {
    if (!on) { this.tickT = 0; return; }
    this.tickT -= dt;
    if (this.tickT <= 0) { this.tickT = 0.38; this.noise(0.03, 2800, 0.12, 4); }
  }
  whoosh() { this.noise(0.35, 700, 0.07, 0.8); }
  chime() { [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.1, i * 0.09)); }
  coin() { this.tone(1318, 0.12, 'square', 0.04); this.tone(1760, 0.25, 'square', 0.04, 0.08); }
  fuel() { this.noise(0.25, 300, 0.05, 2); }
  warn() { this.tone(440, 0.18, 'triangle', 0.08); this.tone(330, 0.25, 'triangle', 0.08, 0.2); }
  siren() {
    if (!this.ctx || this.sirenOn > this.ctx.currentTime) return;
    this.sirenOn = this.ctx.currentTime + 2.4;
    for (let i = 0; i < 4; i++) { this.tone(740, 0.28, 'triangle', 0.05, i * 0.6); this.tone(988, 0.28, 'triangle', 0.05, i * 0.6 + 0.3); }
  }
  bump() { this.noise(0.18, 220, 0.2, 1.2); this.tone(120, 0.18, 'square', 0.08, 0, 0.6); }
  crash() { this.noise(0.7, 180, 0.35, 0.8); this.noise(0.4, 1200, 0.15, 2, 0.05); this.tone(90, 0.5, 'sawtooth', 0.12, 0, 0.4); }
  dock() { this.tone(196, 0.4, 'sine', 0.12, 0, 0.7); this.noise(0.5, 400, 0.05, 1); }
}
export const sfx = new Sfx();
