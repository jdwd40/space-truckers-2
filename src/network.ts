import { Path, Pt, Pose, bezier, catmull } from './geom';

export const LW = 26;
export const MEDIAN = 80;

export type SegKind = 'motorway' | 'ramp' | 'services' | 'avenue';

export interface Station { id: string; name: string; kind: string; x: number; y: number; color: number; arr: Seg[]; dep: Seg[] }
export interface Slot { s: number; occ: unknown }
export interface Aux { side: 1 | -1; s0: number; s1: number; type: 'exit' | 'merge' | 'layby'; trans?: Trans; slots?: Slot[] }
export interface Trans {
  id: number; type: 'exit' | 'merge' | 'end'; from: Seg; fromS: number; to: Seg; toS: number; side: 1 | -1;
  latShift: number; label: string; kind: 'jct' | 'uturn' | 'services' | 'link' | 'dock'; dir: 'L' | 'R' | 'S' | 'U'; aux?: Aux; svc?: Services; pen?: number;
}
export interface Stop { s: number; kind: 'signal'; sig: Signal; group: number }
export interface Services { name: string; size: number; host: Seg; seg: Seg; pumps: { lane: number; occ: unknown }[]; waitS: number; pumpS: number; exit: Trans; x: number; y: number; h: number }
export interface Layby { seg: Seg; aux: Aux; x: number; y: number; h: number; name: string; waiting: number; refillT: number }
export interface SignPanel { side: 'L' | 'C' | 'R'; color: number; title: string; sub?: string; arrow: number | 'U' | null; icon?: string }
export interface Sign { seg: Seg; s: number; kind: 'gantry' | 'side'; panels: SignPanel[]; side: 1 | -1 }
export interface LimitSign { seg: Seg; s: number; limit: number }
export interface Crossing { x: number; y: number; h: number; sig: Signal; corners: Pt[]; lights: { seg: Seg; s: number; group: number }[] }
export interface Goal { seg: Seg; s: number }
export interface Route { trans: Trans[]; goal: Goal; cost: number }
export interface Camera { seg: Seg; s: number; x: number; y: number }

export const GREEN = 0x1d7a4c, BLUE = 0x1f5fb8, POLICE = 0x283a8f;

export class Signal {
  t: number;
  phases = [
    { g: 0, st: 'G', d: 15 }, { g: 0, st: 'A', d: 3 }, { g: -1, st: 'R', d: 2.5 },
    { g: 1, st: 'G', d: 9 }, { g: 1, st: 'A', d: 3 }, { g: -1, st: 'R', d: 2.5 },
  ];
  total: number;
  constructor(public id: number, public x: number, public y: number) {
    this.total = this.phases.reduce((a, p) => a + p.d, 0);
    this.t = Math.random() * this.total;
  }
  state(group: number): 'G' | 'A' | 'R' {
    let tt = this.t % this.total;
    for (const p of this.phases) {
      if (tt < p.d) return p.g === group ? (p.st as 'G' | 'A') : 'R';
      tt -= p.d;
    }
    return 'R';
  }
}

let SEG_ID = 0;
export class Seg {
  id = SEG_ID++;
  aux: Aux[] = [];
  stops: Stop[] = [];
  outs: Trans[] = [];
  endT: Trans | null = null;
  shoulder = false;
  veh: any[] = [];
  arrStation: Station | null = null;
  depStation: Station | null = null;
  despawn = false;
  freeLat = false;
  laneW = LW;
  svc: Services | null = null;
  limits: Int8Array = new Int8Array(1);
  road = '';
  blocks: { lane: number; s0: number; s1: number; inc: unknown }[] = [];
  localOK = false;
  density = 1;
  trucky = false;
  constructor(public name: string, public path: Path, public lanes: number, public kind: SegKind, public level = 0, public limit = 5) {}
  get len(): number { return this.path.len; }
  laneLat(i: number): number { return (i - (this.lanes - 1) / 2) * this.laneW; }
  auxAt(s: number, side: number): Aux | null {
    for (const a of this.aux) if (a.side === side && s >= a.s0 - 1 && s <= a.s1 + 1) return a;
    return null;
  }
  limitAt(s: number): number {
    const i = Math.max(0, Math.min(this.limits.length - 1, Math.floor(s / 100)));
    return this.limits[i] || this.limit;
  }
}

const dirv = (h: number) => ({ x: Math.cos(h), y: Math.sin(h) });

export class Network {
  segs: Seg[] = [];
  trans: Trans[] = [];
  stations: Station[] = [];
  signals: Signal[] = [];
  services: Services[] = [];
  laybys: Layby[] = [];
  signs: Sign[] = [];
  limitSigns: LimitSign[] = [];
  crossings: Crossing[] = [];
  cameras: Camera[] = [];
  roads: { name: string; c: Path; f: Seg; r: Seg }[] = [];
  spawnSegs: { seg: Seg; rate: number; mitesOnly: boolean }[] = [];
  byId: Record<string, Station> = {};

  constructor() { this.build(); }

  private seg(name: string, path: Path, lanes: number, kind: SegKind, level = 0, limit = 5): Seg {
    const s = new Seg(name, path, lanes, kind, level, limit);
    this.segs.push(s);
    return s;
  }
  private addT(t: Omit<Trans, 'id'>): Trans {
    const tr = { ...t, id: this.trans.length } as Trans;
    this.trans.push(tr);
    t.from.outs.push(tr);
    return tr;
  }
  private road(name: string, ctrl: Pt[], nF: number, nR: number, kind: SegKind = 'motorway', median = MEDIAN) {
    const c = new Path(catmull(ctrl, 24));
    const offF = median / 2 + (nF * LW) / 2, offR = median / 2 + (nR * LW) / 2;
    const f = this.seg(name + ' F', new Path(c.pts(0, c.len, offF, 12)), nF, kind);
    const r = this.seg(name + ' R', new Path(c.pts(0, c.len, -offR, 12).reverse()), nR, kind);
    f.road = r.road = name;
    if (kind === 'motorway') { f.shoulder = r.shoulder = true; }
    this.roads.push({ name, c, f, r });
    return { c, f, r };
  }
  auxPt(seg: Seg, s: number, side: number): Pose {
    return seg.path.at(s, seg.laneLat(side > 0 ? seg.lanes : -1));
  }
  private ramp(from: Seg, sExit: number, sideFrom: 1 | -1, to: Seg, sMerge: number, sideTo: 1 | -1, k: number,
    o: { level: number; limit: number; label: string; kind: Trans['kind']; dir: Trans['dir']; uturn?: number; decel?: number; accel?: number }): Seg {
    const p0 = this.auxPt(from, sExit, sideFrom), p3 = this.auxPt(to, sMerge, sideTo);
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const c = o.uturn ?? chord * k;
    const d0 = dirv(p0.h), d3 = dirv(p3.h);
    const pts = bezier(p0, { x: p0.x + d0.x * c, y: p0.y + d0.y * c }, { x: p3.x - d3.x * c, y: p3.y - d3.y * c }, p3, 140);
    const r = this.seg(`${from.road} ramp ${o.label}`, new Path(pts), 1, 'ramp', o.level, o.limit);
    const ax: Aux = { side: sideFrom, s0: sExit - (o.decel ?? 900), s1: sExit, type: 'exit' };
    from.aux.push(ax);
    const te = this.addT({ type: 'exit', from, fromS: sExit, to: r, toS: 0, side: sideFrom, latShift: 0, label: o.label, kind: o.kind, dir: o.dir, aux: ax });
    ax.trans = te;
    const am: Aux = { side: sideTo, s0: sMerge, s1: sMerge + (o.accel ?? 560), type: 'merge' };
    to.aux.push(am);
    const tm = this.addT({ type: 'merge', from: r, fromS: r.len, to, toS: sMerge, side: sideTo, latShift: 0, label: to.road, kind: 'link', dir: 'S', aux: am });
    am.trans = tm;
    r.endT = tm;
    return r;
  }
  private station(id: string, name: string, kind: string, x: number, y: number, color: number): Station {
    const st: Station = { id, name, kind, x, y, color, arr: [], dep: [] };
    this.stations.push(st);
    this.byId[id] = st;
    return st;
  }
  private gates(r: { f: Seg; r: Seg }, start: Station, end: Station, rate: number) {
    r.f.depStation = start; start.dep.push(r.f);
    r.r.arrStation = start; start.arr.push(r.r);
    r.r.depStation = end; end.dep.push(r.r);
    r.f.arrStation = end; end.arr.push(r.f);
    this.spawnSegs.push({ seg: r.f, rate, mitesOnly: false }, { seg: r.r, rate, mitesOnly: false });
  }
  private uturn(a: Seg, sA: number, b: Seg, label: string) {
    const p = a.path.at(sA);
    const sB = b.path.nearest(p.x, p.y).s;
    const r = this.ramp(a, sA, 1, b, sB, 1, 0, { level: 2, limit: 2, label, kind: 'uturn', dir: 'U', uturn: 430, decel: 650 });
    const t = a.outs[a.outs.length - 1];
    this.signs.push({ seg: a, s: sA - 1300, kind: 'gantry', side: 1, panels: [{ side: 'R', color: GREEN, title: 'Turn back', sub: `to ${label}  1.3 km`, arrow: 'U' }] });
    this.signs.push({ seg: a, s: sA + 60, kind: 'side', side: 1, panels: [{ side: 'R', color: GREEN, title: 'Turn back', sub: label, arrow: 'U' }] });
    return { r, t };
  }
  private servicesAt(host: Seg, s0: number, pumps: number, name: string) {
    const laneW = 30, W = pumps * laneW;
    const latC = host.laneLat(host.lanes) + LW / 2 + 80 + W / 2;
    const a = s0 + 330, b = a + 340;
    const pa = host.path.at(a, latC), pb = host.path.at(b, latC);
    const ps = this.seg(name + ' pumps', new Path([pa, pb]), pumps, 'services', 0, 2);
    ps.laneW = laneW; ps.freeLat = true; ps.road = name;
    const hP = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const p0 = this.auxPt(host, s0, 1);
    const d1 = Math.hypot(pa.x - p0.x, pa.y - p0.y) * 0.42;
    const entry = this.seg(name + ' in', new Path(bezier(p0, { x: p0.x + Math.cos(p0.h) * d1, y: p0.y + Math.sin(p0.h) * d1 }, { x: pa.x - Math.cos(hP) * d1, y: pa.y - Math.sin(hP) * d1 }, pa, 60)), 1, 'ramp', 0, 3);
    entry.road = name;
    const ax: Aux = { side: 1, s0: s0 - 650, s1: s0, type: 'exit' };
    host.aux.push(ax);
    const te = this.addT({ type: 'exit', from: host, fromS: s0, to: entry, toS: 0, side: 1, latShift: 0, label: name, kind: 'services', dir: 'R', aux: ax });
    ax.trans = te;
    entry.endT = this.addT({ type: 'end', from: entry, fromS: entry.len, to: ps, toS: 0, side: 1, latShift: 0, label: name, kind: 'link', dir: 'S' });
    const m = b + 330;
    const p3 = this.auxPt(host, m, 1);
    const d2 = Math.hypot(p3.x - pb.x, p3.y - pb.y) * 0.42;
    const exitR = this.seg(name + ' out', new Path(bezier(pb, { x: pb.x + Math.cos(hP) * d2, y: pb.y + Math.sin(hP) * d2 }, { x: p3.x - Math.cos(p3.h) * d2, y: p3.y - Math.sin(p3.h) * d2 }, p3, 60)), 1, 'ramp', 0, 3);
    exitR.road = name;
    ps.endT = this.addT({ type: 'end', from: ps, fromS: ps.len, to: exitR, toS: 0, side: 1, latShift: 0, label: name, kind: 'link', dir: 'S' });
    const am: Aux = { side: 1, s0: m, s1: m + 560, type: 'merge' };
    host.aux.push(am);
    exitR.endT = this.addT({ type: 'merge', from: exitR, fromS: exitR.len, to: host, toS: m, side: 1, latShift: 0, label: host.road, kind: 'link', dir: 'S', aux: am });
    am.trans = exitR.endT;
    const mid = host.path.at((a + b) / 2, latC);
    const svc: Services = { name, size: pumps, host, seg: ps, pumps: [], waitS: 26, pumpS: 205, exit: te, x: mid.x, y: mid.y, h: hP };
    for (let i = 0; i < pumps; i++) svc.pumps.push({ lane: i, occ: null });
    ps.svc = svc; te.svc = svc;
    this.services.push(svc);
    const big = pumps > 2;
    this.signs.push({ seg: host, s: s0 - 1500, kind: 'gantry', side: 1, panels: [{ side: 'R', color: BLUE, title: big ? 'Fuel & services' : 'Fuel stop', sub: `${name}  1 km`, arrow: 45, icon: 'fuel' }] });
    this.signs.push({ seg: host, s: s0 + 50, kind: 'side', side: 1, panels: [{ side: 'R', color: BLUE, title: 'Fuel', sub: name, arrow: 45, icon: 'fuel' }] });
    return svc;
  }
  private laybyAt(seg: Seg, s0: number) {
    if (s0 < 900 || s0 + 540 > seg.len - 900) return;
    // keep clear of exits, merges and other lay-bys on the same side
    if (seg.aux.some((a) => a.side === 1 && a.type !== 'merge' && s0 < a.s1 + 150 && s0 + 540 > a.s0 - 150)) return;
    const aux: Aux = { side: 1, s0, s1: s0 + 540, type: 'layby', slots: [] };
    for (let i = 0; i < 3; i++) aux.slots!.push({ s: s0 + 130 + i * 78, occ: null });
    seg.aux.push(aux);
    const p = seg.path.at(s0 + 270, seg.laneLat(seg.lanes));
    const name = `${seg.road} lay-by ${this.laybys.filter((l) => l.seg.road === seg.road).length + 1}`;
    // a few hitch-hikers wait at most lay-bys; more drift in over time after a pickup
    const waiting = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 3);
    this.laybys.push({ seg, aux, x: p.x, y: p.y, h: p.h, name, waiting, refillT: 0 });
    this.signs.push({ seg, s: s0 - 500, kind: 'side', side: 1, panels: [{ side: 'R', color: BLUE, title: 'Lay-by', sub: 'Passengers · 500 m', arrow: 45, icon: 'P' }] });
  }
  private crossing(r: { c: Path; f: Seg; r: Seg }, x: number, y: number, name: string) {
    const sc = r.c.nearest(x, y).s;
    const p = r.c.at(sc);
    const ph = p.h + Math.PI / 2;
    const L = 2800;
    const av = this.road(name, [{ x: p.x - Math.cos(ph) * L, y: p.y - Math.sin(ph) * L }, p, { x: p.x + Math.cos(ph) * L, y: p.y + Math.sin(ph) * L }], 2, 2, 'avenue', 30);
    av.f.limit = av.r.limit = 3;
    av.f.despawn = av.r.despawn = true;
    this.spawnSegs.push({ seg: av.f, rate: 2.4, mitesOnly: true }, { seg: av.r, rate: 2.4, mitesOnly: true });
    const sig = new Signal(this.signals.length, p.x, p.y);
    this.signals.push(sig);
    const halfMain = MEDIAN / 2 + r.f.lanes * LW + LW + 6;
    const halfAve = 15 + 2 * LW + 6;
    const lights: Crossing['lights'] = [];
    for (const seg of [r.f, r.r]) {
      const s = seg.path.nearest(p.x, p.y).s - halfAve - 16;
      seg.stops.push({ s, kind: 'signal', sig, group: 0 });
      lights.push({ seg, s, group: 0 });
    }
    for (const seg of [av.f, av.r]) {
      const s = seg.path.nearest(p.x, p.y).s - halfMain - 16;
      seg.stops.push({ s, kind: 'signal', sig, group: 1 });
      lights.push({ seg, s, group: 1 });
    }
    const a = { x: Math.cos(p.h), y: Math.sin(p.h) }, b = { x: Math.cos(ph), y: Math.sin(ph) };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: p.x + a.x * halfAve * i + b.x * halfMain * j, y: p.y + a.y * halfAve * i + b.y * halfMain * j }));
    this.crossings.push({ x: p.x, y: p.y, h: p.h, sig, corners, lights });
    for (const seg of [r.f, r.r]) {
      const s = seg.path.nearest(p.x, p.y).s;
      this.signs.push({ seg, s: s - 700, kind: 'side', side: 1, panels: [{ side: 'R', color: 0x8a5a14, title: 'Traffic lights', sub: name, arrow: null, icon: 'lights' }] });
    }
  }
  private interchangeSigns(seg: Seg, tl: Trans, tr: Trans, through: string) {
    for (const back of [2200, 1250]) {
      const s = tl.fromS - back;
      this.signs.push({ seg, s, kind: 'gantry', side: 1, panels: [
        { side: 'L', color: GREEN, title: tl.label, sub: `Exit left  ${dist(tl.fromS - s)}`, arrow: -45 },
        { side: 'C', color: GREEN, title: through, sub: 'Straight on', arrow: 0 },
        { side: 'R', color: GREEN, title: tr.label, sub: `Exit right  ${dist(tr.fromS - s)}`, arrow: 45 },
      ] });
    }
    this.signs.push({ seg, s: tl.fromS + 50, kind: 'side', side: -1, panels: [{ side: 'L', color: GREEN, title: tl.label, arrow: -45 }] });
    this.signs.push({ seg, s: tr.fromS + 50, kind: 'side', side: 1, panels: [{ side: 'R', color: GREEN, title: tr.label, arrow: 45 }] });
  }

  private build() {
    const terra = this.station('terra', 'Terra Nova', 'Garden planet', -16000, 1500, 0x4ad991);
    const kestrel = this.station('kestrel', 'Kestrel Station', 'Starbase', 900, -16000, 0x7fc2ff);
    const jove = this.station('jove', 'Jove Gasport', 'Gas giant port', 16000, -1000, 0xffa45c);
    const vesta = this.station('vesta', 'Vesta Colony', 'Mining colony', 0, 16000, 0xd9a6ff);
    const harbor = this.station('harbor', 'Harbor Prime', 'Trading hub', -15000, -14500, 0xffd166);
    const glacier = this.station('glacier', 'Glacier Outpost', 'Ice mining outpost', 15000, -14000, 0x9be7ff);
    const ember = this.station('ember', 'Ember Refinery', 'Fuel refinery', -14500, 15000, 0xff7a45);

    const P = (a: number[][]) => a.map(([x, y]) => ({ x, y }));
    const M1 = this.road('M1', P([[-15000, 1500], [-13700, 1500], [-12400, 1500], [-11100, 1500], [-9500, 900], [-7600, -200], [-5800, -300], [-4200, 0], [-2600, 0], [0, 0], [2600, 0], [4200, 0], [6000, 300], [8200, 600], [10200, -300], [12400, -1100], [15000, -1000]]), 5, 5);
    const M2 = this.road('M2', P([[900, -15000], [900, -13700], [900, -12400], [900, -11100], [300, -9300], [-700, -7400], [-500, -5600], [0, -4200], [0, -2600], [0, 0], [0, 2600], [0, 4200], [700, 6000], [900, 8200], [-300, 10300], [-600, 12500], [0, 15000]]), 4, 4);
    const OR = this.road('Ore Road', P([[1100, 15800], [2600, 15800], [5200, 15000], [8200, 12900], [11000, 9600], [13200, 6200], [14900, 3200], [15900, 1200], [15900, -200]]), 3, 3);
    this.gates(M1, terra, jove, 1.0);
    this.gates(M2, kestrel, vesta, 1.2);
    this.gates(OR, vesta, jove, 5);
    const E = M1.f, W = M1.r, S = M2.f, N = M2.r;
    E.name = 'M1 East'; W.name = 'M1 West'; S.name = 'M2 South'; N.name = 'M2 North'; OR.f.name = 'Ore Road'; OR.r.name = 'Ore Road';
    for (const r of [M1, M2]) { r.f.localOK = r.r.localOK = true; }
    OR.f.trucky = OR.r.trucky = true; OR.f.density = OR.r.density = 0.5;

    // ---- the wider network: three more destinations, six more highways (3, 4 and 5 lanes each way)
    const AU = this.road('Aurora Way', P([[-16000, 500], [-16000, -1500], [-16100, -3500], [-15700, -6000], [-15900, -8500], [-15500, -11000], [-15000, -12500], [-15000, -13500]]), 4, 4);
    const HR = this.road('Harbor Run', P([[-14000, -14500], [-12500, -14500], [-10500, -15200], [-8000, -15500], [-5500, -15200], [-3000, -15800], [-1500, -16000], [-100, -16000]]), 3, 3);
    const FL = this.road('Frost Line', P([[1900, -16000], [3600, -16000], [6000, -15600], [8500, -15000], [10500, -14400], [12200, -14100], [14000, -14000]]), 3, 3);
    const IR = this.road('Ice Road', P([[15000, -13000], [15000, -11000], [15500, -9000], [15200, -7000], [15700, -5000], [16000, -3500], [16000, -2000]]), 3, 3);
    const SH = this.road('Slag Highway', P([[-1000, 16000], [-2500, 16000], [-5000, 16500], [-7500, 16000], [-10000, 15500], [-12000, 15000], [-13500, 15000]]), 4, 4);
    const CR = this.road('Cinder Road', P([[-14500, 14000], [-14500, 12000], [-15000, 10000], [-14800, 8000], [-15600, 6000], [-15900, 4500], [-16000, 2500]]), 3, 3);
    this.gates(AU, terra, harbor, 1.7);
    this.gates(HR, harbor, kestrel, 2.6);
    this.gates(FL, kestrel, glacier, 2.8);
    this.gates(IR, glacier, jove, 4.2);
    this.gates(SH, vesta, ember, 1.8);
    this.gates(CR, ember, terra, 4.2);
    for (const r of [AU, HR, FL, SH]) r.f.localOK = r.r.localOK = true;
    for (const r of [IR, CR]) { r.f.trucky = r.r.trucky = true; r.f.density = r.r.density = 0.55; }

    const sAt = (seg: Seg, x: number, y: number) => seg.path.nearest(x, y).s;
    const A = 520, B = 1320;
    const right = { level: 1, limit: 3, kind: 'jct' as const, dir: 'R' as const };
    const left = { limit: 4, kind: 'jct' as const, dir: 'L' as const };
    this.ramp(E, sAt(E, -A, 0), 1, S, sAt(S, 0, A), 1, 0.55, { ...right, label: vesta.name });
    this.ramp(S, sAt(S, 0, -A), 1, W, sAt(W, -A, 0), 1, 0.55, { ...right, label: terra.name });
    this.ramp(W, sAt(W, A, 0), 1, N, sAt(N, 0, -A), 1, 0.55, { ...right, label: kestrel.name });
    this.ramp(N, sAt(N, 0, A), 1, E, sAt(E, A, 0), 1, 0.55, { ...right, label: jove.name });
    this.ramp(E, sAt(E, -B, 0), -1, N, sAt(N, 0, -B), -1, 0.55, { ...left, level: 2, label: kestrel.name });
    this.ramp(N, sAt(N, 0, B), -1, W, sAt(W, -B, 0), -1, 0.55, { ...left, level: 3, label: terra.name });
    this.ramp(W, sAt(W, B, 0), -1, S, sAt(S, 0, B), -1, 0.55, { ...left, level: 2, label: vesta.name });
    this.ramp(S, sAt(S, 0, -B), -1, E, sAt(E, B, 0), -1, 0.55, { ...left, level: 3, label: jove.name });
    const ex = (seg: Seg, dir: 'L' | 'R') => seg.outs.find((t) => t.type === 'exit' && t.kind === 'jct' && t.dir === dir)!;
    this.interchangeSigns(E, ex(E, 'L'), ex(E, 'R'), jove.name);
    this.interchangeSigns(W, ex(W, 'L'), ex(W, 'R'), terra.name);
    this.interchangeSigns(S, ex(S, 'L'), ex(S, 'R'), vesta.name);
    this.interchangeSigns(N, ex(N, 'L'), ex(N, 'R'), kestrel.name);

    // traffic-light crossings near the busiest hubs
    this.crossing(M1, -12400, 1500, 'Skyport Avenue');
    this.crossing(M2, 900, -12400, 'Dockside Avenue');

    // services, lay-bys, U-turns, speed checks
    const Lr = (seg: Seg) => seg.len;
    this.servicesAt(E, 5200, 4, 'Nebula Services');
    this.laybyAt(E, 8000);
    this.laybyAt(E, 18500);
    this.uturn(E, 10200, W, terra.name);
    this.uturn(E, 22000, W, terra.name);
    this.laybyAt(E, 25500);

    this.laybyAt(W, 4200);
    this.laybyAt(W, 13000);
    this.uturn(W, 7400, E, jove.name);
    this.uturn(W, 19500, E, jove.name);
    this.laybyAt(W, 22000);
    this.servicesAt(W, 24300, 4, 'Orion Rest');

    this.servicesAt(S, 5400, 2, 'Comet Fuel');
    this.laybyAt(S, 8200);
    this.laybyAt(S, 18500);
    this.uturn(S, 10300, N, kestrel.name);
    this.uturn(S, 22200, N, kestrel.name);
    this.laybyAt(S, 25200);
    this.servicesAt(S, 27000, 2, 'Rocky Fuel');

    this.servicesAt(N, 2600, 2, 'Crater Fuel');
    this.laybyAt(N, 5600);
    this.laybyAt(N, 17000);
    this.uturn(N, 8000, S, vesta.name);
    this.uturn(N, 19700, S, vesta.name);
    this.laybyAt(N, 22400);
    this.servicesAt(N, Lr(N) - 6200, 2, 'Halo Fuel');

    this.servicesAt(OR.f, 9000, 2, 'Ore Pit Stop');
    this.laybyAt(OR.f, 4000);
    this.laybyAt(OR.f, 15000);
    this.laybyAt(OR.r, 6000);
    this.laybyAt(OR.r, 17000);
    this.servicesAt(OR.r, 12000, 2, 'Quarry Fuel');

    const furnish = (rd: { f: Seg; r: Seg }, from: Station, to: Station, names: [string, string], pumps: [number, number]) => {
      const L = rd.f.len;
      const q = (x: number) => Math.round((L * x) / 100) * 100;
      this.uturn(rd.f, q(0.82), rd.r, from.name);
      this.uturn(rd.r, q(0.82), rd.f, to.name);
      this.laybyAt(rd.f, q(0.1));
      this.laybyAt(rd.f, q(0.25));
      this.servicesAt(rd.f, q(0.45), pumps[0], names[0]);
      this.laybyAt(rd.r, q(0.12));
      this.laybyAt(rd.r, q(0.32));
      this.laybyAt(rd.r, q(0.7));
      this.servicesAt(rd.r, q(0.6), pumps[1], names[1]);
      for (const [seg, f] of [[rd.f, 0.62], [rd.r, 0.5]] as [Seg, number][]) {
        const s = q(f);
        const p = seg.path.at(s, seg.laneLat(seg.lanes) + 60);
        this.cameras.push({ seg, s, x: p.x, y: p.y });
        this.signs.push({ seg, s: s - 800, kind: 'side', side: 1, panels: [{ side: 'R', color: POLICE, title: 'Speed check', sub: 'Police patrol', arrow: null, icon: 'police' }] });
      }
    };
    furnish(AU, terra, harbor, ['Aurora Fuel', 'Skyline Stop'], [3, 2]);
    furnish(HR, harbor, kestrel, ['Harbor Pumps', 'Tidewater Fuel'], [2, 3]);
    furnish(FL, kestrel, glacier, ['Frost Fuel', 'Icicle Stop'], [2, 2]);
    furnish(IR, glacier, jove, ['Glacier Pumps', 'Sleet Stop'], [2, 2]);
    furnish(SH, vesta, ember, ['Slag Services', 'Furnace Fuel'], [3, 3]);
    furnish(CR, ember, terra, ['Cinder Stop', 'Ashfall Fuel'], [2, 2]);

    for (const [seg, s] of [[E, 19300], [W, 11300], [S, 19400], [N, 11200]] as [Seg, number][]) {
      const p = seg.path.at(s, seg.laneLat(seg.lanes) + 60);
      this.cameras.push({ seg, s, x: p.x, y: p.y });
      this.signs.push({ seg, s: s - 800, kind: 'side', side: 1, panels: [{ side: 'R', color: POLICE, title: 'Speed check', sub: 'Police patrol', arrow: null, icon: 'police' }] });
    }

    // welcome / route confirmation gantries at departures
    for (const st of this.stations) for (const seg of st.dep) {
      const dest = seg.arrStation!;
      this.signs.push({ seg, s: 380, kind: 'gantry', side: 1, panels: [{ side: 'C', color: GREEN, title: seg.road === 'M1' || seg.road === 'M2' ? seg.name : dest.name, sub: seg.road === 'M1' || seg.road === 'M2' ? `${dest.name}  ${dist(seg.len)}` : `${seg.road}  ${dist(seg.len)}`, arrow: 0 }] });
    }

    // turning around by docking at a station (router only — never applied automatically)
    for (const st of this.stations) for (const a of st.arr) for (const d of st.dep) {
      this.addT({ type: 'end', from: a, fromS: a.len - 150, to: d, toS: 150, side: 1, latShift: 0, label: st.name, kind: 'dock', dir: 'U', pen: 2500 });
    }
    this.computeLimits();
    this.validate();
  }

  private computeLimits() {
    for (const seg of this.segs) {
      const n = Math.ceil(seg.len / 100) + 1;
      seg.limits = new Int8Array(n);
      for (let i = 0; i < n; i++) {
        let lim = seg.limit;
        if (seg.kind === 'motorway') {
          const p = seg.path.at(i * 100);
          lim = 5;
          if (Math.hypot(p.x, p.y) < 4300) lim = 4;
          for (const c of this.crossings) if (Math.hypot(p.x - c.x, p.y - c.y) < 2300) lim = 3;
          for (const st of this.stations) if (Math.hypot(p.x - st.x, p.y - st.y) < 3300) lim = 3;
        }
        seg.limits[i] = lim;
      }
      if (seg.kind === 'motorway') {
        let prev = seg.limits[0];
        this.limitSigns.push({ seg, s: 520, limit: prev });
        for (let i = 1; i < n; i++) if (seg.limits[i] !== prev) { prev = seg.limits[i]; this.limitSigns.push({ seg, s: i * 100 + 30, limit: prev }); }
      }
    }
  }

  private validate() {
    for (const seg of this.segs) for (const a of seg.aux) for (const b of seg.aux) {
      if (a !== b && a.side === b.side && a.s0 < b.s1 + 60 && b.s0 < a.s1 + 60) console.warn('aux overlap', seg.name, a.type, a.s0 | 0, b.type, b.s0 | 0);
    }
  }

  stationGoals(st: Station): Goal[] { return st.arr.map((seg) => ({ seg, s: seg.len - 150 })); }

  route(seg: Seg, s: number, goals: Goal[], auxSide = 0): Route | null {
    let best = Infinity, bestT: Trans | null = null, bestG: Goal | null = null, direct = false;
    for (const g of goals) if (g.seg === seg && g.s >= s - 1 && g.s - s < best) { best = g.s - s; bestG = g; direct = true; }
    const dist = new Map<Trans, number>(), prev = new Map<Trans, Trans | null>(), done = new Set<Trans>();
    for (const t of seg.outs) {
      const ahead = t.fromS - s;
      if (ahead < -1) continue;
      if (t.type === 'exit' && ahead < 90 && auxSide !== t.side) continue;
      dist.set(t, Math.max(0, ahead) + (t.pen ?? 0)); prev.set(t, null);
    }
    for (;;) {
      let cur: Trans | null = null, cd = Infinity;
      for (const [t, d] of dist) if (!done.has(t) && d < cd) { cd = d; cur = t; }
      if (!cur || cd >= best) break;
      done.add(cur);
      const ns = cur.to, s0 = cur.toS;
      for (const g of goals) if (g.seg === ns && g.s >= s0 && cd + g.s - s0 < best) { best = cd + g.s - s0; bestG = g; bestT = cur; direct = false; }
      for (const u of ns.outs) {
        if (u.fromS < s0 + (u.type === 'exit' ? 60 : -1)) continue;
        const nd = cd + u.fromS - s0 + (u.pen ?? 0);
        if (nd < (dist.get(u) ?? Infinity)) { dist.set(u, nd); prev.set(u, cur); }
      }
    }
    if (!bestG) return null;
    const list: Trans[] = [];
    if (!direct) { let t: Trans | null = bestT; while (t) { list.unshift(t); t = prev.get(t) ?? null; } }
    return { trans: list, goal: bestG, cost: best };
  }

  routePoints(r: Route, seg: Seg, s: number, step = 80): Pt[] {
    const pts: Pt[] = [];
    let cs = seg, ss = s;
    for (const t of r.trans) {
      if (t.fromS > ss) pts.push(...cs.path.pts(ss, t.fromS, 0, step));
      cs = t.to; ss = t.toS;
    }
    if (r.goal.s > ss) pts.push(...cs.path.pts(ss, r.goal.s, 0, step));
    return pts;
  }
}

export function dist(d: number): string {
  if (d >= 950) return (Math.round(d / 100) / 10).toFixed(1) + ' km';
  return Math.round(d / 100) * 100 + ' m';
}
