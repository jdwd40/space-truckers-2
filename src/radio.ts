/**
 * In-cab trucker radio: three procedurally generated lo-fi stations, a DJ who talks about the zone you are in and the
 * one coming up, and CB chatter from other truckers. Everything is WebAudio synthesis plus on-screen captions (spoken
 * through the browser's speechSynthesis when available). There are no audio files anywhere in the game.
 */
import { sfx } from './audio';
import { G, bus, distTxt } from './state';
import type { WorldScene } from './world';
import type { ZoneDef, ZoneId } from './zones';

export interface Caption { text: string; who: 'dj' | 'cb'; call: string; t: number; dur: number }

const STATIONS = ['Radio off', '88.2 Drift FM', '104.7 Nebula Waves', 'KBELT 66.6 Ore Belt Boogie'];
const SIGN_IN = [
  '',
  "You're locked on to 88.2 Drift FM. Slow jams for slow lanes, all night long.",
  '104.7 Nebula Waves. Lean back, truckers, we have got the sky covered.',
  'KBELT 66.6, the Ore Belt Boogie. Dust on the dash and a groove in the tank.',
];
const BPM = [0, 72, 88, 84];
const SWING = [0, 0.58, 0.5, 0.5];

const N = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// chord progressions as MIDI notes, one bar each
const KEYS_CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]; // Fmaj7 Em7 Dm7 Cmaj7
const PAD_CHORDS = [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]]; // Am F C G
const BASS_ROOTS = [36, 36, 41, 43]; // C C F G
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79];
const F_PENTA = [65, 67, 69, 72, 74, 77, 79];

// ---------------------------------------------------------------- lines
const DJ_ZONE: Record<ZoneId, string[]> = {
  open: [
    'This is {station}, keeping it slow on {road}. Nothing out here but you, the stars and the next sign.',
    'Open lanes tonight, truckers. Cruise control on, coffee in the holder, {dest} somewhere up ahead.',
    'Long stretch on {road}. Let the engine hum do the talking for a while.',
    'If you are hauling {cargo} down {road} right now, this one is for you.',
    'Clear skies, clear roads. Enjoy the quiet before the next station lights come up.',
  ],
  belt: [
    'Out in the belt, keep the windows up, it is gravel season.',
    'Vesta belt crew, mind the rocks and mind each other. Plenty of ore to go round.',
    'That rumble on the hull is just the belt saying hello. Ease off and let it pass.',
    'Vesta miners, we see you. Nobody hauls heavier than you folks.',
    'Rocks to the left, rocks to the right. Stay in your lane and you will be fine.',
  ],
  nebula: [
    'Folks in the Violet Nebula, enjoy that glow. Purple is a good colour on everybody.',
    'Visibility in the nebula: gorgeous. Keep one eye on the road all the same.',
    'Nebula drivers, dim the dash lights and take it in. This is the best view on the network.',
    'If you are rolling through the violet right now, you are exactly where you should be.',
  ],
  giant: [
    'Big planet, little truck. Jove fills the whole sky tonight, do not let it fill your windscreen.',
    'Jove approach, truckers. That gas giant is not getting any smaller, so slow down and enjoy it.',
    'Helium haulers on the Jove run, your loads are the reason the lights stay on. Thank you.',
    'Look up. No, really, look up. You will not see a planet like that anywhere else on the route.',
  ],
  ice: [
    'Frosty out there on the ice field. Keep the cab warm and the coffee warmer.',
    'Glacier crews, ice on the road and ice in the cargo. Steady does it.',
    'Ice field tonight, sparkling like a thousand headlights. Take it slow around the frost.',
    'If your coolant drums are singing, that is the cold talking. Nearly there.',
  ],
  shipyard: [
    'Busy skies over the shipyards. Slow down, let the little ships buzz about, and enjoy the show.',
    'Kestrel shipyard crews, every rig on this road started life in your hangars. Respect.',
    'Shipyard traffic is thick tonight, truckers. Patience is cheaper than a bumper.',
    'Welcome to the shipyards, where the sparks never stop. Keep left and keep smiling.',
  ],
};
const DJ_GENERIC = [
  'Heads up, about {dist} out you will be rolling into the {next}. Grab a coffee.',
  'This is {station}, keeping you company all the way to {dest}.',
  'Reminder from the station: lay-bys have hitch-hikers, and hitch-hikers have fares. Be kind out there.',
  'Fuel gauge looking thin? Blue signs, truckers. Follow the blue signs.',
  'Somebody out there is hauling {cargo} right now. We salute you.',
  'Police are patrolling the motorways tonight. Keep it under the limit and keep your credits.',
  'Slow music for slow drivers. That is the whole idea.',
];
const DJ_NEXT = [
  'Heads up, about {dist} out you will be rolling into the {next}. Grab a coffee.',
  'Coming up in {dist}: the {next}. Nice change of scenery.',
  '{next} is just {dist} down the road. Enjoy the last of this stretch.',
];
const CB_CALLS = ['Big Dipper', 'Rusty Comet', 'Moon Pie', 'Halo Hauler', 'Space Cowgirl', 'Nickel Nick', 'Slag Daddy', 'Little Nova'];
const CB_INC = [
  'Breaker breaker, wreck on {incRoad}, cops have it coned off. Keep left.',
  'Scene on {incRoad}, good buddies. Police directing, one lane open. Take it easy.',
  'Somebody is broke down on {incRoad}. Rescue truck is on the way, give them room.',
];
const CB_COP = [
  'Smokey is parked on {road}, keep it under the limit, good buddies.',
  'Bear with ears on {road}. Ease off the throttle for a bit.',
  'Patrol car sitting pretty on {road}. Nothing to see if you are at the limit.',
];
const CB_ZONE: Partial<Record<ZoneId, string[]>> = {
  belt: ['Took a rock to the mirror out here in the belt. Again.', 'Belt is loud tonight, anybody else hearing that ping?'],
  nebula: ['Anybody else see that whale back there? Big as a hangar.', 'Purple sky, purple cab, purple cargo. I am done with purple.'],
  giant: ['That planet is making me feel small, over.', 'Jove run again. Fourth time this week. Not complaining.'],
  ice: ['Heater is on full and I still cannot feel my toes.', 'Pretty out here on the ice. Slippery too, mind.'],
  shipyard: ['Shipyard is buzzing. Little ships everywhere, watch your mirrors.', 'Just saw a brand new rig roll out the hangar. Shiny.'],
  open: ['Quiet night on {road}. Just the way I like it.', 'Anybody got a good lay-by near {dest}? Need a nap.'],
};
const CB_GENERIC = [
  'How about you, {call}? Got your ears on?',
  'Hauling {cargo} to {dest}. Long night, good buddies.',
  'Coffee stop at the next services. Anybody joining?',
  'Picked up two hitch-hikers at the lay-by. They tip well, over.',
  'This road train is three trailers of trouble. Give me room on the merges.',
  'Keep the shiny side up, truckers.',
  'That {station} DJ never sleeps, does he?',
  'Ten-four, {call}. See you at the docks.',
];

function fill(t: string, c: Record<string, string>): string { return t.replace(/\{(\w+)\}/g, (_, k) => c[k] ?? ''); }
/** tiny seeded PRNG so a 4-bar loop varies but repeats deterministically for its seed */
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Radio {
  world: WorldScene | null = null;
  station = 1; volume = 5; voiceOn = true;
  caption: Caption | null = null;
  /** true while a station's music should be scheduled */
  private playing = false;
  private ctx: AudioContext | null = null;
  private musicBus!: GainNode; private duck!: GainNode; private radioGain!: GainNode;
  private keysF!: BiquadFilterNode; private padF!: BiquadFilterNode; private arpIn!: GainNode;
  private wow!: GainNode; private noiseBuf!: AudioBuffer;
  // sequencer
  private nextNoteTime = 0; private step = 0; private loopSeed = 0; private rng = mulberry(1);
  private arpPattern: number[] = []; private melody: (number | null)[] = []; private keysExtra: number[] = [];
  private switchT = 0; private pendingStation = -1;
  // chatter timers (seconds); only run while driving, unpaused and not OFF
  private djT = 40; private cbT = 70; private gapT = 0; private signInT = -1;
  private welcome: { z: ZoneDef; t: number } | null = null; private welcomedAt: Record<string, number> = {};
  private announcedNext: ZoneId | null = null; private lastZone: ZoneId = 'open';
  private clock = 0; private lastCall = '';
  private utter: SpeechSynthesisUtterance | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem('spacetrucker-radio');
      if (raw) { const d = JSON.parse(raw); if (typeof d.station === 'number') this.station = Math.max(0, Math.min(3, d.station | 0)); if (typeof d.volume === 'number') this.volume = Math.max(0, Math.min(10, d.volume | 0)); if (typeof d.voiceOn === 'boolean') this.voiceOn = d.voiceOn; }
    } catch { /* ignore */ }
    bus.on('zone', (z: ZoneDef) => { this.welcome = { z, t: 3 + Math.random() * 2 }; });
  }
  private persist() { try { localStorage.setItem('spacetrucker-radio', JSON.stringify({ station: this.station, volume: this.volume, voiceOn: this.voiceOn })); } catch { /* ignore */ } }
  stationName(): string { return STATIONS[this.station]; }

  // ---------------------------------------------------------------- audio graph
  /** build the radio chain into sfx.master; call once after sfx.init(), on the first user gesture */
  start() {
    if (this.ctx || !sfx.ctx) return;
    const ctx = this.ctx = sfx.ctx;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0;
    const lofi = ctx.createBiquadFilter(); lofi.type = 'lowpass'; lofi.frequency.value = 3200; lofi.Q.value = 0.7;
    this.duck = ctx.createGain(); this.duck.gain.value = 1;
    this.radioGain = ctx.createGain(); this.radioGain.gain.value = (this.volume / 10) * 0.55;
    this.musicBus.connect(lofi); lofi.connect(this.duck); this.duck.connect(this.radioGain); this.radioGain.connect(sfx.master);
    // tape wow: one slow LFO feeding every pitched oscillator's detune
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3; this.wow = ctx.createGain(); this.wow.gain.value = 6; lfo.connect(this.wow); lfo.start();
    // shared white noise
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // vinyl crackle: sparse clicks on a faint hiss, looped
    const cb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * 0.08;
    for (let k = 0; k < 70; k++) { const i = Math.floor(Math.random() * (cd.length - 40)); const a = 0.4 + Math.random() * 0.6; for (let j = 0; j < 30; j++) cd[i + j] += (Math.random() * 2 - 1) * a * (1 - j / 30); }
    const crackle = ctx.createBufferSource(); crackle.buffer = cb; crackle.loop = true;
    const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 1500;
    const cg = ctx.createGain(); cg.gain.value = 0.012;
    crackle.connect(chp); chp.connect(cg); cg.connect(this.musicBus); crackle.start();
    // station-specific shared filters
    this.keysF = ctx.createBiquadFilter(); this.keysF.type = 'lowpass'; this.keysF.frequency.value = 1800; this.keysF.connect(this.musicBus);
    this.padF = ctx.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.frequency.value = 900; this.padF.connect(this.musicBus);
    const padLfo = ctx.createOscillator(); padLfo.frequency.value = 0.05; const plg = ctx.createGain(); plg.gain.value = 300; padLfo.connect(plg); plg.connect(this.padF.frequency); padLfo.start();
    this.arpIn = ctx.createGain(); this.arpIn.gain.value = 1;
    const delay = ctx.createDelay(1); delay.delayTime.value = (60 / BPM[2] / 4) * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    this.arpIn.connect(this.musicBus); this.arpIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(this.musicBus);
    sfx.padDuck = this.station ? 0.5 : 1;
    if (this.station) this.beginStation();
  }
  private beginStation() {
    if (!this.ctx) return;
    this.playing = true;
    this.step = 0; this.loopSeed = -1;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.musicBus.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1);
    sfx.padDuck = 0.5;
    this.signInT = 1;
  }
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(10, Math.round(v)));
    if (this.ctx) this.radioGain.gain.setTargetAtTime((this.volume / 10) * 0.55, this.ctx.currentTime, 0.05);
    if (this.utter) this.utter.volume = (this.volume / 10) * 0.9;
    this.persist();
  }
  next() { this.tune((this.station + 1) % 4); }
  prev() { this.tune((this.station + 3) % 4); }
  private tune(to: number) {
    if (to === this.station) return;
    this.cancelSpeech();
    this.caption = null;
    this.station = to; this.persist();
    if (!this.ctx) { sfx.padDuck = to ? 0.5 : 1; return; }
    const t = this.ctx.currentTime;
    this.playing = false;
    if (to === 0) { this.musicBus.gain.setTargetAtTime(0, t, 0.15); sfx.padDuck = 1; this.pendingStation = -1; this.switchT = 0; return; }
    // old station fades over 0.3 s under a tuning sweep, the new one starts on a fresh bar half a second later
    this.musicBus.gain.setTargetAtTime(0, t, 0.08);
    this.sweep(t);
    this.pendingStation = to; this.switchT = 0.5;
  }
  toggleVoice() { this.voiceOn = !this.voiceOn; if (!this.voiceOn) this.cancelSpeech(); this.persist(); }

  // ---------------------------------------------------------------- synth voices
  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number, dest: AudioNode, slideTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + dur + 0.05);
  }
  private osc(type: OscillatorType, freq: number, detune: number, t: number, stopAt: number, dest: AudioNode): [OscillatorNode, GainNode] {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    this.wow.connect(o.detune);
    // a connection into an AudioParam counts as a reference per the spec: unhook it so Safari and Firefox can free the
    // finished oscillator (Chrome collects it either way)
    o.onended = () => { try { this.wow.disconnect(o.detune); } catch { /* already gone */ } };
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    o.connect(g); g.connect(dest); o.start(t); o.stop(stopAt);
    return [o, g];
  }
  private kick(t: number, vol = 0.14) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.35);
  }
  private snare(t: number) { this.noise(t, 0.18, 'bandpass', 1800, 1, 0.05, this.musicBus); }
  private hat(t: number) { this.noise(t, 0.04, 'highpass', 6000, 0.7, 0.015, this.musicBus); }
  private rim(t: number) {
    const [o, g] = this.osc('square', 2200, 0, t, t + 0.05, this.musicBus);
    g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); void o;
    this.noise(t, 0.03, 'highpass', 3000, 1, 0.03, this.musicBus);
  }
  /** soft electric-piano chord note: two detuned triangles, decaying to ~40% over the bar */
  private key(midi: number, t: number, bar: number, vol = 0.045) {
    for (const d of [-5, 5]) {
      const [, g] = this.osc('triangle', N(midi), d, t, t + bar + 0.4, this.keysF);
      g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(vol * 0.4, t + bar); g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 0.3);
    }
  }
  private pad(midi: number, t: number, bar: number, vol = 0.03) {
    for (const d of [-7, 7]) {
      const [, g] = this.osc('sawtooth', N(midi), d, t, t + bar + 1.2, this.padF);
      g.gain.linearRampToValueAtTime(vol, t + 0.8); g.gain.setValueAtTime(vol, t + bar - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 1);
    }
  }
  private arp(midi: number, t: number) {
    const [, g] = this.osc('square', N(midi), 0, t, t + 0.2, this.arpIn);
    g.gain.linearRampToValueAtTime(0.02, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  }
  private bass(midi: number, t: number) {
    const [, g] = this.osc('triangle', N(midi), 0, t, t + 0.45, this.musicBus);
    g.gain.linearRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  }
  /** plucked lead: a sawtooth through a lowpass that sweeps down fast */
  private pluck(midi: number, t: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.15); f.connect(this.musicBus);
    const [, g] = this.osc('sawtooth', N(midi), 0, t, t + 0.4, f);
    g.gain.linearRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  }
  private sweep(t: number) { this.noise(t, 0.5, 'bandpass', 400, 3, 0.08, this.duck, 2500); }
  private squelch(t: number) { this.noise(t, 0.12, 'bandpass', 1200, 2, 0.07, this.duck); }

  // ---------------------------------------------------------------- sequencer
  /** reseed the per-loop variations every 4 bars so nothing repeats exactly */
  private newLoop(loop: number) {
    this.loopSeed = loop;
    this.rng = mulberry(loop * 7919 + this.station * 1000 + 17);
    const r = this.rng;
    this.arpPattern = Array.from({ length: 16 }, () => Math.floor(r() * 6));
    this.melody = Array.from({ length: 32 }, () => (r() < 0.45 ? null : 0));
    let idx = 3 + Math.floor(r() * 3);
    for (let i = 0; i < 32; i++) if (this.melody[i] !== null) { idx = Math.max(0, Math.min(PENTA.length - 1, idx + Math.floor(r() * 3) - 1)); this.melody[i] = PENTA[idx]; }
    this.keysExtra = Array.from({ length: 32 }, () => (r() < 0.18 ? F_PENTA[Math.floor(r() * F_PENTA.length)] : -1));
  }
  private scheduleStep(step: number, t0: number) {
    const st = this.station, bpm = BPM[st], q = 60 / bpm, bar = q * 4;
    const inBar = step % 16, barN = Math.floor(step / 16), loop = Math.floor(barN / 4), chordI = barN % 4;
    if (loop !== this.loopSeed) this.newLoop(loop);
    // swing: the off-8ths sit late
    const t = t0 + (inBar % 4 === 2 ? (SWING[st] - 0.5) * q : 0);
    if (st === 1) {
      if (inBar === 0) for (const m of KEYS_CHORDS[chordI]) this.key(m, t, bar);
      if (inBar === 0 || inBar === 8) this.kick(t);
      if (inBar === 4 || inBar === 12) this.snare(t);
      if (inBar % 2 === 0 && this.rng() > 0.1) this.hat(t);
      if (inBar % 2 === 0) { const m = this.keysExtra[(barN % 2) * 16 + inBar]; if (m > 0) this.key(m + 12, t, q, 0.03); }
    } else if (st === 2) {
      if (inBar === 0) for (const m of PAD_CHORDS[chordI]) this.pad(m, t, bar);
      if (inBar === 0 || inBar === 8) this.kick(t, 0.07);
      const ch = PAD_CHORDS[chordI], k = this.arpPattern[inBar];
      if (k < 5 || this.rng() < 0.5) this.arp(ch[k % 3] + 12 * (1 + Math.floor(k / 3)), t);
    } else if (st === 3) {
      const root = BASS_ROOTS[chordI];
      if (inBar === 0 || inBar === 8) this.bass(root, t);
      if (inBar === 4 || inBar === 12) this.bass(root + 7, t);
      if (inBar === 0 || inBar === 6) this.kick(t, 0.12);
      if (inBar === 12) this.rim(t);
      if (inBar % 2 === 0) { const m = this.melody[(barN % 2) * 16 + inBar]; if (m) this.pluck(m, t); }
    }
  }
  private sequence() {
    const ctx = this.ctx!;
    if (ctx.currentTime - this.nextNoteTime > 0.2) this.nextNoteTime = ctx.currentTime + 0.05; // tab was hidden: resync, don't burst
    const sixteenth = 60 / BPM[this.station] / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.3) { this.scheduleStep(this.step, this.nextNoteTime); this.nextNoteTime += sixteenth; this.step++; }
  }

  // ---------------------------------------------------------------- chatter
  private context(): Record<string, string> {
    const w = this.world;
    const c: Record<string, string> = { station: STATIONS[this.station] || 'the radio', zone: 'open lanes', next: '', dist: '', road: 'the motorway', dest: 'wherever the road takes you', cargo: 'empty trailers', incRoad: '', call: '' };
    if (!w) return c;
    c.zone = w.zone.name;
    const up = w.upcomingZone(); if (up) { c.next = up.zone.name; c.dist = distTxt(up.dist); }
    c.road = w.player.seg.road || c.road;
    if (G.job) { c.dest = w.net.byId[G.job.to].name; c.cargo = G.job.cargo; }
    const inc = w.inc.list.find((i) => i.phase !== 'stopping'); if (inc) c.incRoad = inc.seg.road || 'the motorway';
    const others = CB_CALLS.filter((x) => x !== this.lastCall); c.call = others[Math.floor(Math.random() * others.length)];
    return c;
  }
  private copNear(): boolean {
    const w = this.world; if (!w) return false;
    const p = w.player;
    return w.traffic.vs.some((v) => v.type === 'police' && Math.abs(v.x - p.x) < 3000 && Math.abs(v.y - p.y) < 3000 && Math.hypot(v.x - p.x, v.y - p.y) < 3000);
  }
  private pickLine(list: string[], c: Record<string, string>): string {
    const ok = list.filter((l) => !/\{next\}|\{dist\}/.test(l) || c.next);
    return fill((ok.length ? ok : list)[Math.floor(Math.random() * (ok.length ? ok : list).length)], c);
  }
  /** show (and maybe speak) a caption; CB lines get a squelch first */
  say(text: string, who: 'dj' | 'cb') {
    const call = who === 'cb' ? CB_CALLS.filter((x) => x !== this.lastCall)[Math.floor(Math.random() * (CB_CALLS.length - 1))] : '';
    if (who === 'cb') { this.lastCall = call; if (this.ctx) this.squelch(this.ctx.currentTime); }
    const words = text.split(/\s+/).length;
    this.caption = { text, who, call, t: 0, dur: Math.max(5, words * 0.35) };
    this.gapT = 12;
    this.speak(text, who);
  }
  private speak(text: string, who: 'dj' | 'cb') {
    if (!this.voiceOn || G.muted || !('speechSynthesis' in window)) return;
    try {
      const ss = window.speechSynthesis;
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = who === 'dj' ? 0.95 : 1.1; u.pitch = who === 'dj' ? 0.8 : 1.15; u.volume = (this.volume / 10) * 0.9;
      const voices = ss.getVoices(); const en = voices.find((v) => /^en/i.test(v.lang)); if (en) u.voice = en;
      u.onstart = () => { if (this.ctx) this.duck.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.07); };
      u.onend = u.onerror = () => { if (this.ctx) this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1); if (this.utter === u) this.utter = null; };
      this.utter = u; ss.speak(u);
    } catch { /* no speech on this browser */ }
  }
  cancelSpeech() {
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* ignore */ }
    this.utter = null;
    if (this.ctx) this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1);
  }

  // ---------------------------------------------------------------- per frame (runs while paused too, so the music keeps playing)
  update(dt: number) {
    this.clock += dt;
    if (this.caption) { this.caption.t += dt; if (this.caption.t > this.caption.dur + 0.5) this.caption = null; }
    if (this.ctx) {
      if (this.switchT > 0) { this.switchT -= dt; if (this.switchT <= 0 && this.pendingStation > 0) { this.station = this.pendingStation; this.pendingStation = -1; this.beginStation(); } }
      if (this.playing) this.sequence();
    }
    const w = this.world;
    const live = this.station > 0 && G.mode === 'drive' && !G.paused && !!w;
    if (this.signInT >= 0) { this.signInT -= dt; if (this.signInT < 0 && this.station > 0 && G.mode !== 'title') { this.signInT = -1; this.say(SIGN_IN[this.station], 'dj'); } }
    if (!live || !w) return;
    this.gapT -= dt; this.djT -= dt; this.cbT -= dt;
    if (w.zone.id !== this.lastZone) { this.lastZone = w.zone.id; this.announcedNext = null; }
    if (this.welcome) this.welcome.t -= dt;
    if (this.gapT > 0 || this.caption) return;
    // zone welcome a few seconds after the card, once per 90 s per zone
    if (this.welcome) {
      if (this.welcome.t > 0) return; // nothing else talks over a welcome that is about to go out
      const z = this.welcome.z; this.welcome = null;
      if (z === w.zone && this.clock - (this.welcomedAt[z.id] ?? -1e9) > 90) { this.welcomedAt[z.id] = this.clock; this.say(this.pickLine(DJ_ZONE[z.id], this.context()), 'dj'); return; }
    }
    // the next zone, once, when it is close
    const up = w.upcomingZone();
    if (up && up.dist < 3000 && up.zone.id !== this.announcedNext) { this.announcedNext = up.zone.id; this.say(this.pickLine(DJ_NEXT, this.context()), 'dj'); return; }
    if (this.djT <= 0) {
      this.djT = 70 + Math.random() * 60;
      const c = this.context();
      const pool = Math.random() < 0.55 ? DJ_ZONE[w.zone.id] : DJ_GENERIC;
      this.say(this.pickLine(pool, c), 'dj'); return;
    }
    if (this.cbT <= 0) {
      this.cbT = 60 + Math.random() * 60;
      const c = this.context();
      let pool: string[];
      if (c.incRoad) pool = CB_INC; else if (this.copNear()) pool = CB_COP; else pool = Math.random() < 0.5 ? (CB_ZONE[w.zone.id] ?? CB_GENERIC) : CB_GENERIC;
      this.say(this.pickLine(pool, c), 'cb');
    }
  }
}
export const radio = new Radio();
