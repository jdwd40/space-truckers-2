import { Network, Seg, Trans, Goal, Aux, Services, Stop, LW, TAPER } from './network';
import { clamp, rand, pick } from './geom';
import { SPEEDS } from './state';

/** Traffic tuning. Density scales both the initial fill and the ongoing spawn rate (1 = the original quiet highways). */
export const TRAFFIC_CFG = {
  density: 2.0,
  /** share of motorway spawns that are trucks (rig / tanker / long / road train) */
  truckShare: 0.5,
  /** same, on the designated haulage roads */
  truckShareTrucky: 0.72,
  /** how many vehicles are kept alive around the player (within the view plus ~1.9 km). The main lever for how busy roads look. */
  nearTarget: 72,
  /** multiplier on nearTarget around stations and the central interchange / on open stretches between them */
  hubBoost: 1.35,
  quietFactor: 0.7,
  /** chance that a freshly spawned truck brings a convoy of 2-3 more behind it */
  convoyChance: 0.22,
  /** hard caps so a busy network never runs away */
  maxVehicles: 900,
  maxLocals: 560,
  initialLocals: 900,
  maxPolice: 12,
};
/** vehicles in a lane that is about to be dropped start merging this far before the section ends */
export const MERGE_ZONE = 2200;

export type VType = 'mite' | 'van' | 'rig' | 'long' | 'train' | 'police' | 'player' | 'pod' | 'sport' | 'taxi' | 'bus' | 'tanker' | 'tow' | 'shuttle';

const SPEC: Record<VType, { cab: number; w: number; trailers: number[]; vmin: number; vmax: number; a: number; T: number }> = {
  mite: { cab: 24, w: 13, trailers: [], vmin: 300, vmax: 375, a: 125, T: 0.75 },
  pod: { cab: 14, w: 9, trailers: [], vmin: 380, vmax: 470, a: 190, T: 0.55 },
  sport: { cab: 22, w: 12, trailers: [], vmin: 370, vmax: 450, a: 170, T: 0.6 },
  taxi: { cab: 24, w: 13, trailers: [], vmin: 290, vmax: 360, a: 120, T: 0.75 },
  van: { cab: 34, w: 15, trailers: [], vmin: 250, vmax: 320, a: 95, T: 0.85 },
  bus: { cab: 70, w: 17, trailers: [], vmin: 200, vmax: 255, a: 45, T: 1.0 },
  shuttle: { cab: 44, w: 16, trailers: [], vmin: 235, vmax: 300, a: 75, T: 0.9 },
  rig: { cab: 22, w: 17, trailers: [46], vmin: 205, vmax: 285, a: 70, T: 0.95 },
  tanker: { cab: 22, w: 17, trailers: [58], vmin: 200, vmax: 265, a: 60, T: 1.0 },
  long: { cab: 24, w: 18, trailers: [66], vmin: 190, vmax: 270, a: 58, T: 1.0 },
  train: { cab: 24, w: 18, trailers: [46, 46], vmin: 185, vmax: 250, a: 50, T: 1.0 },
  police: { cab: 28, w: 14, trailers: [], vmin: 335, vmax: 375, a: 135, T: 0.75 },
  tow: { cab: 30, w: 17, trailers: [], vmin: 250, vmax: 330, a: 90, T: 0.9 },
  player: { cab: 26, w: 17, trailers: [], vmin: 0, vmax: 0, a: 90, T: 0.85 },
};
/** how far over the posted limit each kind of ship is happy to cruise */
const FAST: Partial<Record<VType, number>> = { mite: 1.06, police: 1.06, taxi: 1.08, sport: 1.3, pod: 1.38 };
export const HITCH = 4;
const TR = 160, TSTEP = 3;

export class Veh {
  static NID = 1;
  id = Veh.NID++;
  cab: number; w: number; trailers: number[] = []; totLen = 0;
  vDes: number; aMax: number; bComf = 150; T: number;
  latT: number | null = null;
  route: Trans[] = []; goal: Goal | null = null; dest: string | null = null; svcTarget: Services | null = null;
  pend: number | null = null; pendT = 0; pendWait = 0; pendMand = false; sig = 0; lcCool = 0;
  acc = 0; braking = false; leadGap = Infinity; leadV = 0;
  x = 0; y = 0; h = 0; latVel = 0;
  trail = new Float32Array(TR * 2); tHead = 0; tN = 0;
  state: 'drive' | 'park' | 'parked' | 'leave' | 'fuel' | 'held' | 'broken' | 'crashed' | 'stopped' = 'drive';
  svc: Services | null = null; pump = -1; pumpDone = false; wait = 0;
  wantLayby: Aux | null = null; laybyChecked: Aux | null = null; slot = -1;
  alpha = 0; dead = false; age = 0; local = false; variant = Math.floor(Math.random() * 6);
  isPlayer: boolean; lights = false; gfx: any = null; decideT = Math.random() * 0.6;
  hazard = false; siren = false; smoke = false; crashAng = 0; goShoulder = false; stopAt: number | null = null;
  ignoreBlock = false; emergency = false; reckless = false; squeeze = false; lastLC = -99; stopT = 0; giveUp = 0; resp: unknown = null; partner: Veh | null = null;
  /** dock gate currently holding this ship, and the one it was last waved through */
  gate: Gate | null = null; gateDone: Gate | null = null;
  /** the segment this ship was on before its current one, where it left it and where it joined this one: the trailers may still be back there */
  prevSeg: Seg | null = null; prevS = 0; enterS = 0;
  constructor(public type: VType, public seg: Seg, public s: number, public lane: number, public v: number) {
    const sp = SPEC[type];
    this.cab = sp.cab; this.w = sp.w; this.aMax = sp.a; this.T = sp.T;
    this.vDes = rand(sp.vmin, sp.vmax);
    this.isPlayer = type === 'player';
    this.setTrailers(sp.trailers);
    this.lat = seg.laneLat(lane);
    this.resetTrail();
  }
  lat: number;
  setTrailers(list: number[]) {
    this.trailers = list.slice();
    this.totLen = this.cab + list.reduce((a, t) => a + t + HITCH, 0);
  }
  targetLat(): number { return this.seg.freeLat && this.latT !== null ? this.latT : this.seg.laneLat(this.lane); }
  pose() { return this.seg.path.at(this.s, this.lat); }
  resetTrail() {
    const p = this.pose();
    this.x = p.x; this.y = p.y; this.h = p.h;
    // back() walks the ring downwards from tHead, so the point i steps behind the nose goes at tHead - i. Filled the other
    // way round, the first lookups after a reset hit the far end of the ring and drew the cab and trailers hundreds of
    // units behind the ship until it had driven far enough to overwrite them.
    this.tHead = TR - 1; this.tN = TR;
    for (let i = 0; i < TR; i++) { const k = this.tHead - i; this.trail[k * 2] = p.x - Math.cos(p.h) * i * TSTEP; this.trail[k * 2 + 1] = p.y - Math.sin(p.h) * i * TSTEP; }
  }
  pushTrail() {
    const hx = this.trail[this.tHead * 2], hy = this.trail[this.tHead * 2 + 1];
    const d = Math.hypot(this.x - hx, this.y - hy);
    if (d >= TSTEP) {
      this.tHead = (this.tHead + 1) % TR;
      this.trail[this.tHead * 2] = this.x; this.trail[this.tHead * 2 + 1] = this.y;
    }
  }
  /**
   * Point at distance d behind the front along the travelled trail. Walks the real distances between the stored points:
   * they are pushed once the ship has moved at least TSTEP, so at speed they sit further apart than that, and treating
   * the spacing as exact put the cab and trailers too far back on every frame that had not just pushed a point. Those
   * frames alternated with ones that had, and the rig flickered between two positions.
   */
  back(d: number): { x: number; y: number } {
    let px = this.x, py = this.y, rem = d, i = this.tHead;
    for (let n = 0; n < TR; n++) {
      const qx = this.trail[i * 2], qy = this.trail[i * 2 + 1];
      const L = Math.hypot(qx - px, qy - py);
      if (L > 1e-6 && rem <= L) { const f = rem / L; return { x: px + (qx - px) * f, y: py + (qy - py) * f }; }
      rem -= L; px = qx; py = qy; i = (i - 1 + TR) % TR;
    }
    // past the end of the trail (only right after a reset, when it is a straight line anyway): extend along the heading
    return { x: px - Math.cos(this.h) * rem, y: py - Math.sin(this.h) * rem };
  }
}

export interface PlayerCtl {
  desired(v: Veh): number;
  extraGap(v: Veh): number;
  obeySignal(v: Veh, st: Stop, state: 'G' | 'A' | 'R'): boolean;
  brakeMin(v: Veh): number | null;
  onTrans(v: Veh, t: Trans): void;
  onBlocked(kind?: 'busy' | 'nolane', dir?: number): void;
  onRouteNeeded(v: Veh): void;
}

interface Zone { x: number; y: number; r: number; w: number }
/**
 * A dock gate on a station approach or exit. NPCs stop at `s` and are waved through one at a time; most of the time the
 * gate keeps up with traffic, but every minute or two it has a busy spell and a queue builds up behind it.
 */
export interface Gate { seg: Seg; s: number; t: number; busy: number; calm: number; held: number }

export class Traffic {
  vs: Veh[] = [];
  player!: Veh;
  leaving = new Map<Services, Veh | null>();
  spawnT: number[] = [];
  localT = 0;
  zones: Zone[] = [];
  gates: Gate[] = [];
  /** extra departures still owed by a convoy leaving a dock, per spawn segment */
  burst: number[] = [];
  view = { x: 0, y: 0, r: 1500 };
  onAdd: (v: Veh) => void = () => {};
  onRemove: (v: Veh) => void = () => {};
  onCollide: (a: Veh, b: Veh, rv: number) => void = () => {};
  clock = 0; bumpCool = 0;
  localSegs: Seg[];
  constructor(public net: Network, public ctl: PlayerCtl) {
    this.spawnT = net.spawnSegs.map(() => Math.random() * 3);
    this.burst = net.spawnSegs.map(() => 0);
    this.localSegs = net.segs.filter((s) => s.kind === 'motorway');
    this.zones.push({ x: 0, y: 0, r: 5200, w: 3 });
    for (const st of net.stations) this.zones.push({ x: st.x, y: st.y, r: 6000, w: st.id === 'terra' || st.id === 'kestrel' ? 3 : 2 });
  }

  // ---------- spawning ----------
  add(type: VType, seg: Seg, s: number, lane: number, v?: number): Veh {
    const veh = new Veh(type, seg, s, lane, 0);
    veh.v = v ?? Math.min(veh.vDes, SPEEDS[seg.limitAt(s)]) * 0.9;
    veh.resetTrail();
    this.vs.push(veh);
    seg.veh.push(veh);
    this.onAdd(veh);
    return veh;
  }
  private randType(seg: Seg, hub = false): VType {
    const r = Math.random();
    if (seg.kind === 'avenue') return r < 0.5 ? 'mite' : r < 0.68 ? 'taxi' : r < 0.85 ? 'pod' : r < 0.93 ? 'van' : 'bus';
    const police = this.vs.filter((v) => v.type === 'police' && !v.emergency).length;
    if (r < 0.04 && police < TRAFFIC_CFG.maxPolice) return 'police';
    // local shuttles run between the hubs
    if (hub && !seg.trucky && r < 0.09) return 'shuttle';
    const q = Math.random();
    if (Math.random() < (seg.trucky ? TRAFFIC_CFG.truckShareTrucky : TRAFFIC_CFG.truckShare)) {
      return q < 0.31 ? 'rig' : q < 0.49 ? 'tanker' : q < 0.74 ? 'long' : 'train';
    }
    if (seg.trucky) return q < 0.37 ? 'mite' : q < 0.53 ? 'pod' : q < 0.79 ? 'van' : 'bus';
    return q < 0.31 ? 'mite' : q < 0.54 ? 'pod' : q < 0.68 ? 'sport' : q < 0.8 ? 'taxi' : q < 0.94 ? 'van' : 'bus';
  }
  /** lane `lane` of seg no longer exists (or does not yet exist) at s: the outer lanes of a drop / gain taper */
  deadLane(seg: Seg, lane: number, s: number): boolean {
    if (lane < 0 || lane >= seg.lanes) return false;
    if (seg.drop && lane >= seg.lanes - seg.drop && s > seg.len - TAPER) return true;
    if (seg.gain && lane >= seg.lanes - seg.gain && s < TAPER) return true;
    return false;
  }
  /** lane `lane` is being dropped ahead and traffic in it should be merging left */
  dropping(seg: Seg, lane: number, s: number): boolean {
    return seg.drop > 0 && lane >= seg.lanes - seg.drop && lane < seg.lanes && s > seg.len - MERGE_ZONE;
  }
  laneFree(seg: Seg, s: number, lane: number, len: number, behind = 120, ahead = 160): boolean {
    const lt = seg.laneLat(lane);
    for (const o of seg.veh) {
      if (Math.abs(o.lat - lt) > seg.laneW * 0.8 && Math.abs(o.targetLat() - lt) > seg.laneW * 0.8) continue;
      if (o.s > s - len - behind && o.s - o.totLen < s + ahead) return false;
    }
    return true;
  }
  private inAux(seg: Seg, s: number): boolean {
    for (const a of seg.aux) if (s > a.s0 - 500 && s < a.s1 + 200) return true;
    for (const st of seg.stops) if (Math.abs(st.s - s) < 300) return true;
    return false;
  }
  /** traffic hot spots: stations and the central interchange */
  busyAt(x: number, y: number): number {
    return this.zones.some((z) => Math.hypot(x - z.x, y - z.y) < z.r * 0.6) ? TRAFFIC_CFG.hubBoost : TRAFFIC_CFG.quietFactor;
  }
  spawnNPC(seg: Seg, s: number, local: boolean, forceLane?: number, forceType?: VType, tight = false, speed?: number): Veh | null {
    const q = seg.path.at(s);
    const type = forceType ?? this.randType(seg, this.busyAt(q.x, q.y) > 1);
    const n = seg.lanes;
    let lane = Math.floor(Math.random() * n);
    const heavy = type === 'rig' || type === 'long' || type === 'train' || type === 'tanker' || type === 'bus' || type === 'shuttle';
    if (heavy && n > 1 && lane < n - 2) lane = n - 1 - Math.floor(Math.random() * Math.min(2, n - 1));
    if ((type === 'pod' || type === 'sport') && n > 2) lane = Math.floor(Math.pow(Math.random(), 1.8) * n);
    if (forceLane !== undefined) lane = forceLane;
    else if (this.dropping(seg, lane, s) || this.deadLane(seg, lane, s)) lane = Math.max(0, n - 1 - Math.max(seg.drop, seg.gain));
    const len = SPEC[type].cab + SPEC[type].trailers.reduce((a, t) => a + t + HITCH, 0);
    if (!this.laneFree(seg, s, lane, len, tight ? 12 : 120, tight ? 12 : 160)) return null;
    const v = this.add(type, seg, s, lane, speed);
    v.local = local;
    // a ship leaving a hangar is hidden by the hangar floor until it reaches the door, so it needs no fade-in: with one
    // it was still see-through a hundred units outside, right behind a rig that had just undocked
    if (seg.depStation) v.age = 0.8;
    v.reckless = type === 'pod' || type === 'sport' ? Math.random() < 0.5 : Math.random() < 0.03;
    if (seg.kind !== 'avenue') {
      const options = this.net.stations.filter((st) => st !== seg.depStation);
      v.dest = pick(options).id;
      this.reroute(v);
      if (!v.goal) { v.dead = true; return null; }
      if (!local && type !== 'police' && Math.random() < (type === 'mite' ? 0.12 : 0.3)) this.pickServices(v);
    }
    const truck = type === 'rig' || type === 'long' || type === 'tanker' || type === 'train';
    if (truck && forceType === undefined && seg.kind === 'motorway' && Math.random() < TRAFFIC_CFG.convoyChance) this.convoy(v);
    return v;
  }
  /** a few more trucks of the same outfit close behind (or ahead, at a gate), cruising at the leader's speed */
  private convoy(lead: Veh) {
    const seg = lead.seg, k = 1 + Math.floor(Math.random() * 2) + (Math.random() < 0.3 ? 1 : 0);
    const spacing = lead.totLen + 46;
    const ahead = lead.s - spacing * k < 250;
    for (let i = 1; i <= k; i++) {
      const s = lead.s + (ahead ? spacing * i : -spacing * i);
      if (s < 40 || s > seg.len - 300 || this.inAux(seg, s)) break;
      const f = this.spawnNPC(seg, s, lead.local, lead.lane, lead.type, true);
      if (!f) break;
      f.variant = lead.variant; f.vDes = lead.vDes * rand(0.985, 1.0); f.dest = lead.dest; f.svcTarget = null; f.reckless = false; f.T = 0.5;
      this.reroute(f);
      f.v = lead.v;
    }
  }
  private pickServices(v: Veh) {
    const segs = new Set<Seg>([v.seg, ...v.route.map((t) => t.to)]);
    const opts = this.net.services.filter((sv) => segs.has(sv.host) && (sv.host !== v.seg || sv.exit.fromS > v.s + 1500));
    if (!opts.length) return;
    v.svcTarget = pick(opts);
    this.reroute(v);
  }
  goalsFor(v: Veh): Goal[] {
    if (v.svcTarget) return [{ seg: v.svcTarget.seg, s: v.svcTarget.pumpS }];
    if (!v.dest) return [];
    return this.net.stationGoals(this.net.byId[v.dest]);
  }
  reroute(v: Veh) {
    if (v.isPlayer) { this.ctl.onRouteNeeded(v); return; }
    const goals = this.goalsFor(v);
    if (!goals.length) { v.route = []; v.goal = null; return; }
    const side = v.lane >= v.seg.lanes ? 1 : v.lane < 0 ? -1 : 0;
    const r = this.net.route(v.seg, v.s, goals, side);
    v.route = r ? r.trans : [];
    v.goal = r ? r.goal : null;
  }
  populate() {
    for (let i = 0; i < TRAFFIC_CFG.initialLocals; i++) this.spawnLocal(true);
    for (const seg of this.net.segs) {
      if (seg.kind !== 'motorway' && seg.kind !== 'avenue') continue;
      const gap = (seg.kind === 'avenue' ? 300 : (seg.trucky ? 1900 : 520) / Math.max(0.5, seg.density)) / TRAFFIC_CFG.density / 1.4;
      for (let s = 300; s < seg.len - 300; s += rand(gap * 0.6, gap * 1.4)) {
        if (this.inAux(seg, s)) continue;
        this.spawnNPC(seg, s, false);
      }
    }
  }
  private spawnLocal(init = false) {
    if (init) {
      const z = pick(this.zones.flatMap((zz) => Array(zz.w).fill(zz)) as Zone[]);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.r;
      const x = z.x + Math.cos(a) * r, y = z.y + Math.sin(a) * r;
      let best: Seg | null = null, bs = 0, bd = 400;
      for (const seg of this.localSegs) {
        if (!seg.localOK || x < seg.path.minX - bd || x > seg.path.maxX + bd || y < seg.path.minY - bd || y > seg.path.maxY + bd) continue;
        const nr = seg.path.nearest(x, y);
        if (nr.d < bd) { bd = nr.d; best = seg; bs = nr.s; }
      }
      if (!best || bs < 400 || bs > best.len - 500 || this.inAux(best, bs)) return;
      this.spawnNPC(best, bs, true);
      return;
    }
    // sample road positions in a ring just outside the visible area, so new traffic rolls in rather than popping up
    const vw = this.view, near = vw.r + 250, far = vw.r + 1900;
    const cands = this.localSegs.filter((seg) => vw.x > seg.path.minX - far && vw.x < seg.path.maxX + far && vw.y > seg.path.minY - far && vw.y < seg.path.maxY + far);
    if (!cands.length) return;
    for (let tries = 0; tries < 5; tries++) {
      const seg = pick(cands);
      const s = rand(400, seg.len - 500);
      if (s < 400) continue;
      const p = seg.path.at(s);
      const d = Math.hypot(p.x - vw.x, p.y - vw.y);
      if (d < near || d > far || this.inAux(seg, s)) continue;
      // quieter stretches between the hubs; haulage roads keep their own lower density
      if (Math.random() > Math.min(1, this.busyAt(p.x, p.y)) * Math.max(0.5, seg.density)) continue;
      this.spawnNPC(seg, s, true);
      return;
    }
  }

  // ---------- core update ----------
  update(dt: number) {
    for (const sig of this.net.signals) sig.t += dt;
    this.clock += dt;
    for (const seg of this.net.segs) seg.veh.length = 0;
    for (const v of this.vs) if (!v.dead) v.seg.veh.push(v);
    for (const seg of this.net.segs) if (seg.veh.length > 1) seg.veh.sort((a, b) => a.s - b.s);
    this.gateUpdate(dt);
    for (const sv of this.net.services) this.svcUpdate(sv);
    for (const v of this.vs) if (!v.dead) this.plan(v);
    for (const v of this.vs) if (!v.dead) this.move(v, dt);
    this.collide(dt);
    for (const v of this.vs) {
      if (v.dead) continue;
      v.lcCool -= dt;
      if (!v.isPlayer) {
        v.decideT -= dt;
        if (v.decideT <= 0) { v.decideT = 0.35 + Math.random() * 0.3; this.decide(v); }
        this.npcStates(v, dt);
      }
      this.pending(v, dt);
    }
    // removals
    for (let i = this.vs.length - 1; i >= 0; i--) {
      const v = this.vs[i];
      if (v.dead) { this.release(v); this.onRemove(v); this.vs.splice(i, 1); }
    }
    // spawning
    const count = this.vs.length;
    this.net.spawnSegs.forEach((sp, i) => {
      this.spawnT[i] -= dt;
      if (this.spawnT[i] > 0) return;
      const dock = sp.seg.kind !== 'avenue';
      if (dock && this.burst[i] > 0) {
        // a convoy rolling out of the hangar: ships leave a second or so apart at a crawl and bunch up on the way out
        this.spawnT[i] = rand(0.7, 1.2);
        if (count < TRAFFIC_CFG.maxVehicles && this.spawnNPC(sp.seg, 25, false, undefined, undefined, false, 70)) this.burst[i]--;
        return;
      }
      this.spawnT[i] = (sp.rate * rand(0.6, 1.5) * (dock ? 1.05 : 1)) / TRAFFIC_CFG.density;
      if (dock && Math.random() < 0.22) this.burst[i] = 2 + Math.floor(Math.random() * 4);
      if (count < TRAFFIC_CFG.maxVehicles) this.spawnNPC(sp.seg, 25, false);
    });
    this.localT -= dt;
    if (this.localT <= 0) {
      this.localT = 0.12;
      const vw = this.view, far = vw.r + 1900;
      let locals = 0, near = 0;
      for (const v of this.vs) {
        if (v.dead || v.isPlayer) continue;
        if (v.local) locals++;
        if (Math.abs(v.x - vw.x) < far && Math.abs(v.y - vw.y) < far && Math.hypot(v.x - vw.x, v.y - vw.y) < far) near++;
      }
      const want = TRAFFIC_CFG.nearTarget * this.busyAt(vw.x, vw.y);
      if (near < want && locals < TRAFFIC_CFG.maxLocals && this.vs.length < TRAFFIC_CFG.maxVehicles + 40) {
        this.spawnLocal();
        if (near < want * 0.6) this.spawnLocal();
      }
    }
  }

  // ---------- dock gates ----------
  addGate(seg: Seg, s: number) { this.gates.push({ seg, s, t: rand(0.5, 2), busy: 0, calm: rand(25, 90), held: 0 }); }

  private gateUpdate(dt: number) {
    for (const g of this.gates) {
      g.t -= dt; g.calm -= dt;
      if (g.busy > 0) g.busy -= dt;
      else if (g.calm <= 0) { g.busy = rand(8, 16); g.calm = rand(70, 150); }
      let next: Veh | null = null, held = 0;
      for (const v of g.seg.veh) { // sorted by s, so the last match is the ship at the head of the queue
        if (v.isPlayer || v.emergency || v.resp || v.state !== 'drive' || v.gateDone === g) continue;
        if (v.s > g.s + 4) { if (v.gate === g) { v.gate = null; v.stopAt = null; } continue; }
        if (v.s < g.s - 2600) continue;
        if (v.gate !== g) { v.gate = g; v.stopAt = g.s; }
        held++; next = v;
      }
      g.held = held;
      // wave the head of the queue through once it is at (or crawling up to) the barrier; a free gate admits on arrival
      if (next && g.t <= 0 && (next.s > g.s - 90 || next.v < 30)) {
        next.gate = null; next.gateDone = g; next.stopAt = null;
        g.t = g.busy > 0 ? rand(2.4, 4.2) : rand(0.9, 1.8);
      }
    }
  }

  private release(v: Veh) {
    if (v.svc && v.pump >= 0) { const p = v.svc.pumps[v.pump]; if (p.occ === v) p.occ = null; }
    for (const [sv, lv] of this.leaving) if (lv === v) this.leaving.set(sv, null);
    if (v.wantLayby || v.slot >= 0) this.freeSlot(v);
  }
  private freeSlot(v: Veh) {
    for (const lb of this.net.laybys) for (const sl of lb.aux.slots!) if (sl.occ === v) sl.occ = null;
    v.slot = -1;
  }

  spanOf(o: Veh, withPend: boolean): [number, number] {
    const tl = o.targetLat();
    let a = Math.min(o.lat, tl), b = Math.max(o.lat, tl);
    if (withPend && o.pend !== null && o.sig !== 0) { const pl = o.seg.laneLat(o.pend); a = Math.min(a, pl); b = Math.max(b, pl); }
    return [a - o.w / 2, b + o.w / 2];
  }

  private stopApplies(v: Veh, st: Stop): boolean {
    const state = st.sig.state(st.group);
    if (v.isPlayer) return this.ctl.obeySignal(v, st, state);
    if (state === 'G') return false;
    if (state === 'R') return true;
    return st.s - v.s > (v.v * v.v) / (2 * v.bComf * 1.3);
  }

  nextTrans(v: Veh): Trans | null {
    const seg = v.seg;
    if (v.lane >= seg.lanes || v.lane < 0) {
      const z = seg.auxAt(v.s, v.lane < 0 ? -1 : 1);
      if (z && z.type === 'exit') return z.trans!;
    }
    return seg.endT;
  }

  leader(v: Veh): { gap: number; lv: number } {
    const seg = v.seg;
    const L = Math.max(180, v.v * 3.2 + 80);
    let gap = Infinity, lv = 0;
    const [a0, a1] = this.spanOf(v, false);
    for (const o of seg.veh) {
      if (o === v || o.s < v.s || (o.s === v.s && o.id < v.id)) continue;
      if (o.s - v.s > L + 160) break;
      const og = o.s - o.totLen - v.s;
      const [b0, b1] = this.spanOf(o, false);
      let hit = a0 < b1 - 1.5 && a1 > b0 + 1.5;
      if (!hit && o.pend !== null && og > 4) { const [c0, c1] = this.spanOf(o, true); hit = a0 < c1 - 1.5 && a1 > c0 + 1.5; }
      if (hit && og < gap) { gap = Math.max(0.5, og); lv = o.v; }
    }
    for (const st of seg.stops) {
      const d = st.s - v.s;
      if (d > -0.5 && d < L && d < gap && this.stopApplies(v, st)) { gap = Math.max(0.5, d); lv = 0; }
    }
    if (v.stopAt !== null) { const d = v.stopAt - v.s; if (d > -4 && d < gap) { gap = Math.max(0.5, d); lv = 0; } }
    if (!v.ignoreBlock && seg.blocks.length) {
      for (const b of seg.blocks) {
        const d = b.s0 - v.s;
        if (d < -1 || d > L || d >= gap) continue;
        const lt = seg.laneLat(b.lane);
        if (a0 < lt + LW / 2 - 3 && a1 > lt - LW / 2 + 3) { gap = Math.max(0.5, d); lv = 0; }
      }
    }
    // aux lane ends
    if (v.lane >= seg.lanes || v.lane < 0) {
      const z = seg.auxAt(v.s, v.lane < 0 ? -1 : 1);
      if (z && z.type !== 'exit') {
        let d = z.s1 - 8 - v.s;
        if ((v.state === 'park' || v.state === 'parked') && v.slot >= 0 && z.slots) d = Math.max(0.5, z.slots[v.slot].s - v.s);
        if (d < gap) { gap = Math.max(0.5, d); lv = 0; }
      }
    }
    // a lane that is dropped at the end of this section: AI traffic queues at the taper until it can merge
    if (!v.isPlayer && seg.drop && v.lane >= seg.lanes - seg.drop && v.lane < seg.lanes) {
      const d = seg.len - TAPER - v.s;
      if (d < gap) { gap = Math.max(0.5, d); lv = 0; }
    }
    // services
    if (seg.svc) {
      const sv = seg.svc;
      let d = Infinity;
      if (v.pump < 0) d = sv.waitS - v.s;
      else if (!v.pumpDone) d = sv.pumpS - v.s;
      else if (this.leaving.get(sv) !== v) d = 0.5;
      if (d < gap && d > -2) { gap = Math.max(0.5, d); lv = 0; }
    }
    // look into the next segment
    const t = this.nextTrans(v);
    if (t && gap > 0) {
      const d0 = t.fromS - v.s;
      if (d0 < L && d0 < gap) {
        const lat2 = t.type === 'exit' ? 0 : t.type === 'merge' ? t.to.laneLat(t.side > 0 ? t.to.lanes : -1) : v.lat + t.latShift;
        const c0 = lat2 - v.w / 2, c1 = lat2 + v.w / 2;
        for (const o of t.to.veh) {
          if (o.s < t.toS - 1 || o === v) continue;
          const og = d0 + (o.s - o.totLen - t.toS);
          if (og > gap) break;
          const [b0, b1] = this.spanOf(o, false);
          if (c0 < b1 - 1.5 && c1 > b0 + 1.5) { gap = Math.max(0.5, og); lv = o.v; break; }
        }
        if (t.to.svc && v.pump < 0) { const d = d0 + t.to.svc.waitS - 4; if (d < gap) { gap = Math.max(0.5, d); lv = 0; } }
        for (const st of t.to.stops) {
          const d = d0 + st.s - t.toS;
          if (d < gap && d < L && this.stopApplies(v, st)) { gap = Math.max(0.5, d); lv = 0; }
        }
      }
    }
    if (v.isPlayer) { const e = this.ctl.extraGap(v); if (e < gap) { gap = Math.max(0.5, e); lv = 0; } }
    return { gap, lv };
  }

  private plan(v: Veh) {
    const seg = v.seg;
    if (v.state === 'crashed') { v.acc = v.v > 0.5 ? -430 : 0; v.braking = true; v.leadGap = Infinity; return; }
    let vd: number;
    if (v.isPlayer) vd = this.ctl.desired(v);
    else {
      vd = Math.min(v.vDes, SPEEDS[seg.limitAt(v.s)] * (FAST[v.type] ?? 1));
      if (v.emergency) vd = v.vDes;
      if (v.state === 'parked' || v.state === 'fuel' || v.state === 'held') vd = 0;
      const onShoulder = v.lane >= seg.lanes && Math.abs(v.lat - seg.laneLat(seg.lanes)) < 3;
      if (v.state === 'broken') vd = v.goShoulder && !onShoulder ? 110 : 0;
      if (v.state === 'stopped') vd = onShoulder ? (v.stopAt !== null && v.stopAt - v.s > 10 ? 150 : 0) : 140;
    }
    // police direct traffic past a scene: everyone slows down
    if (!v.emergency && seg.blocks.length) for (const b of seg.blocks) if (v.s > b.s0 - 160 && v.s < b.s1 + 80) { vd = Math.min(vd, SPEEDS[2]); break; }
    const { gap, lv } = this.leader(v);
    v.leadGap = gap; v.leadV = lv;
    const v0 = Math.max(1, vd);
    const free = v.v <= v0 ? v.aMax * (1 - Math.pow(v.v / v0, 4)) : -Math.min(v.bComf, (v.v - v0) * 1.6 + 20);
    let a = free;
    if (gap < Infinity) {
      const dv = v.v - lv;
      const ss = 9 + Math.max(0, v.v * v.T + (v.v * dv) / (2 * Math.sqrt(v.aMax * v.bComf)));
      a -= v.aMax * (ss / gap) ** 2;
    }
    if (v.isPlayer) { const bm = this.ctl.brakeMin(v); if (bm !== null) a = Math.min(a, bm); }
    if (vd === 0 && v.v < 25) a = Math.min(a, -60);
    v.acc = clamp(a, v.isPlayer ? -380 : -700, v.aMax);
    v.braking = v.acc < -35 || (v.v < 4 && vd < 5);
  }

  private move(v: Veh, dt: number) {
    v.age += dt;
    v.v = Math.max(0, v.v + v.acc * dt);
    if (v.v < 1 && v.acc < 0) v.v = 0;
    const ds = v.v * dt;
    v.s += ds;
    const tl = v.targetLat();
    const want = tl - v.lat;
    const rate = v.isPlayer ? 75 : v.trailers.length ? 40 : 55;
    const sp = Math.min(rate, Math.abs(want) * 5 + 8);
    const dl = Math.sign(want) * Math.min(Math.abs(want), sp * dt);
    v.latVel = dt > 0 ? dl / dt : 0;
    v.lat += dl;
    this.transitions(v, ds);
    if (v.dead) return;
    const p = v.seg.path.at(v.s, v.lat);
    v.x = p.x; v.y = p.y;
    v.h = p.h + Math.atan2(v.latVel, Math.max(v.v, 60));
    v.pushTrail();
    const seg = v.seg;
    let al = Math.min(1, v.age / 0.8);
    // dock roads run about 60 units inside the hangar door, so arrivals and departures fade under the hangar floor
    if (!v.isPlayer && seg.despawn && !seg.endT) al = Math.min(al, (seg.len - v.s) / 140);
    else if (!v.isPlayer && seg.arrStation && !seg.endT) al = Math.min(al, (seg.len - v.s - 15) / 35);
    if (!v.isPlayer && seg.depStation && v.s < 60) al = Math.min(al, (v.s - 10) / 35);
    v.alpha = clamp(al, 0, 1);
    if (!v.isPlayer && (seg.arrStation || seg.despawn) && !seg.endT && v.s > seg.len - 15) v.dead = true;
    if (v.local && !v.isPlayer && v.age > 3 && v.state === 'drive' && !v.emergency) {
      const dx = v.x - this.view.x, dy = v.y - this.view.y, dd = Math.hypot(dx, dy);
      // locals are recycled once they are well out of sight, or out of sight and driving away
      const away = dx * Math.cos(v.h) + dy * Math.sin(v.h) > 0;
      if (dd > this.view.r + 2600 || (dd > this.view.r + 500 && away)) v.dead = true;
    }
  }

  private transitions(v: Veh, ds: number) {
    for (let k = 0; k < 3; k++) {
      const seg = v.seg;
      if (v.lane >= seg.lanes || v.lane < 0) {
        const side = v.lane < 0 ? -1 : 1;
        let applied = false;
        for (const z of seg.aux) {
          if (z.side !== side || v.s < z.s1 || v.s - ds - 1 > z.s1) continue;
          if (z.type === 'exit') { this.apply(v, z.trans!, v.s - z.s1); applied = true; break; }
          if (!v.isPlayer || z.type === 'merge') { v.lane = side > 0 ? seg.lanes - 1 : 0; v.pend = null; }
        }
        if (applied) continue;
      }
      if (v.s >= seg.len) {
        if (seg.endT) { this.apply(v, seg.endT, v.s - seg.len); continue; }
        if (v.isPlayer) v.s = seg.len; else v.dead = true;
      }
      break;
    }
    // missed planned exit
    const t = v.route[0];
    if (t && t.from === v.seg && t.type === 'exit' && v.s > t.fromS + 1) this.reroute(v);
  }

  private apply(v: Veh, t: Trans, over: number) {
    const old = v.seg;
    v.prevSeg = old; v.prevS = v.s - over; v.enterS = t.toS;
    if (t.type === 'exit') { v.seg = t.to; v.s = t.toS + over; v.lane = 0; v.lat = 0; }
    else if (t.type === 'merge') { v.seg = t.to; v.s = t.toS + over; v.lane = t.side > 0 ? t.to.lanes : -1; v.lat = t.to.laneLat(v.lane); }
    else {
      v.lat = old.svc ? 0 : v.lat + t.latShift;
      v.seg = t.to; v.s = t.toS + over;
      let best = 0, bd = Infinity;
      for (let i = 0; i < t.to.lanes; i++) { const d = Math.abs(t.to.laneLat(i) - v.lat); if (d < bd) { bd = d; best = i; } }
      v.lane = best;
      if (t.to.freeLat) v.latT = v.svc && v.pump >= 0 ? t.to.laneLat(v.svc.pumps[v.pump].lane) : 0;
    }
    v.pend = null;
    if (v.gate) { v.gate = null; v.stopAt = null; }
    if (old.svc) {
      if (this.leaving.get(old.svc) === v) this.leaving.set(old.svc, null);
      if (v.svc && v.pump >= 0 && v.svc.pumps[v.pump].occ === v) v.svc.pumps[v.pump].occ = null;
      v.svc = null; v.pump = -1; v.pumpDone = false; v.latT = null;
      if (!v.isPlayer) { v.svcTarget = null; v.route = []; this.reroute(v); return; }
    }
    if (v.isPlayer) this.ctl.onTrans(v, t);
    if (v.route.length && v.route[0] === t) v.route.shift();
    else if (v.route.length || v.goal) this.reroute(v);
  }

  private svcUpdate(sv: Services) {
    const entry = sv.exit.to;
    const cands: Veh[] = [];
    for (let i = sv.seg.veh.length - 1; i >= 0; i--) { const o = sv.seg.veh[i]; if (o.pump < 0 && !o.pumpDone) cands.push(o); }
    for (let i = entry.veh.length - 1; i >= 0; i--) { const o = entry.veh[i]; if (o.s > entry.len - 260) cands.push(o); }
    for (const c of cands) {
      const order = sv.pumps.map((p, i) => i).sort((a, b) => Math.abs(sv.seg.laneLat(a)) - Math.abs(sv.seg.laneLat(b)));
      const free = order.find((i) => !sv.pumps[i].occ);
      if (free === undefined) break;
      sv.pumps[free].occ = c; c.pump = free; c.svc = sv; c.pumpDone = false;
      if (c.seg === sv.seg) c.latT = sv.seg.laneLat(free);
    }
    // leaving token
    const lv = this.leaving.get(sv) ?? null;
    if (lv && (lv.dead || lv.seg !== sv.seg)) this.leaving.set(sv, null);
    if (!this.leaving.get(sv)) {
      let pickV: Veh | null = null;
      for (const o of sv.seg.veh) if (o.pumpDone && (!pickV || o.s > pickV.s)) pickV = o;
      if (pickV) {
        // wait until previous leaver has moved on
        const blocking = sv.seg.veh.some((o) => o !== pickV && o.s > pickV!.s && o.s - o.totLen < pickV!.s + 30 && Math.abs(o.lat) < 30 && o.pumpDone);
        if (!blocking) {
          this.leaving.set(sv, pickV);
          pickV.latT = 0;
          if (pickV.pump >= 0 && sv.pumps[pickV.pump].occ === pickV) sv.pumps[pickV.pump].occ = null;
        }
      }
    }
  }

  private npcStates(v: Veh, dt: number) {
    const seg = v.seg;
    if (v.state === 'broken' && v.goShoulder && v.lane < seg.lanes) { v.stopT -= dt; if (v.stopT <= 0) v.goShoulder = false; }
    if (v.state === 'stopped' && v.lane < seg.lanes) { v.giveUp += dt; if (v.giveUp > 10) { v.state = 'drive'; v.goShoulder = false; v.siren = false; v.giveUp = 0; } }
    if (v.state === 'stopped' && v.type === 'police' && v.partner && v.stopAt === null && v.lane >= seg.lanes && v.partner.state === 'stopped' && v.partner.lane >= seg.lanes && v.partner.v < 1.5) {
      const at = v.partner.s - v.partner.totLen - 24;
      if (at > v.s + 4) v.stopAt = at;
    }
    if (v.state === 'stopped' && v.lane >= seg.lanes && v.v < 1.5) {
      v.stopT -= dt;
      if (v.stopT <= 0) { v.goShoulder = false; v.state = 'leave'; v.siren = false; v.decideT = 0; v.stopAt = null; v.partner = null; }
    }
    if (seg.svc && v.pump >= 0 && !v.pumpDone && v.state === 'drive' && v.v < 3 && v.s > seg.svc.pumpS - 18) { v.state = 'fuel'; v.wait = rand(3, 6.5); }
    if (v.state === 'fuel') { v.wait -= dt; if (v.wait <= 0) { v.state = 'drive'; v.pumpDone = true; } }
    if (v.state === 'park' && v.lane !== seg.lanes && v.pend === null) { this.freeSlot(v); v.state = 'drive'; v.wantLayby = null; }
    if (v.state === 'park' && v.lane === seg.lanes && v.v < 2 && v.slot >= 0) {
      const z = seg.auxAt(v.s, 1);
      if (z && z.slots && v.s > z.slots[v.slot].s - 26) { v.state = 'parked'; v.wait = rand(5, 14); }
      else if (!z) { this.freeSlot(v); v.state = 'leave'; }
    }
    if (v.state === 'parked') { v.wait -= dt; if (v.wait <= 0) { this.freeSlot(v); v.state = 'leave'; v.wantLayby = null; v.decideT = 0; } }
    if (v.state === 'leave' && v.lane < seg.lanes && v.lane >= 0) v.state = 'drive';
  }

  laneClosed(seg: Seg, lane: number, s: number, horizon = 1500): boolean {
    for (const b of seg.blocks) if (b.lane === lane && b.s1 > s - 60 && b.s0 - s < horizon) return true;
    return false;
  }
  /** stopped at the cones of a closed lane: allowed to step sideways through a neighbouring closed lane to reach an open one */
  private trapped(v: Veh): boolean {
    return !v.isPlayer && v.v < 10 && v.lane >= 0 && v.lane < v.seg.lanes && this.laneClosed(v.seg, v.lane, v.s, 200);
  }
  safe(v: Veh, tgt: number): boolean {
    const seg = v.seg;
    // a merge lane only leads into the edge lane: if that lane is coned off further ahead, merge anyway and move over after
    const fromAux = v.lane >= seg.lanes || v.lane < 0;
    if (!v.ignoreBlock && tgt >= 0 && tgt < seg.lanes && !this.trapped(v) && this.laneClosed(seg, tgt, v.s, fromAux ? 250 : 1500)) return false;
    const tl = seg.laneLat(tgt);
    const a0 = tl - v.w / 2 - 2, a1 = tl + v.w / 2 + 2;
    const P = v.isPlayer;
    const k = v.squeeze ? 0.05 : v.reckless ? 0.25 : 1;
    for (const o of seg.veh) {
      if (o === v) continue;
      const [b0, b1] = this.spanOf(o, false);
      if (!(a0 < b1 && a1 > b0)) continue;
      if (o.s >= v.s) {
        const g = o.s - o.totLen - v.s;
        if (g < Math.max(2.5, (6 + v.v * (P ? 0.15 : 0.3) + Math.max(0, v.v - o.v) * (P ? 0.5 : 0.9)) * k)) return false;
      } else {
        const g = v.s - v.totLen - o.s;
        if (g < Math.max(2.5, (8 + o.v * (P ? 0.22 : 0.5) + Math.max(0, o.v - v.v) * (P ? 0.6 : 1.1)) * k)) return false;
      }
    }
    return true;
  }
  laneGapAhead(v: Veh, lane: number): number {
    const lt = v.seg.laneLat(lane);
    const a0 = lt - v.w / 2, a1 = lt + v.w / 2;
    let g = Infinity;
    for (const o of v.seg.veh) {
      if (o === v || o.s < v.s) continue;
      const [b0, b1] = this.spanOf(o, false);
      if (a0 < b1 && a1 > b0) { g = Math.min(g, o.s - o.totLen - v.s); break; }
    }
    return g;
  }
  ask(v: Veh, tgt: number, mand: boolean) {
    if (tgt === v.lane) return;
    v.pend = tgt; v.pendT = v.isPlayer ? 0.12 : v.reckless ? 0.25 : 0.7; v.pendWait = 0; v.pendMand = mand; v.sig = Math.sign(tgt - v.lane);
  }
  private pending(v: Veh, dt: number) {
    const seg = v.seg;
    if (v.pend !== null) {
      if (seg.kind === 'ramp' || seg.kind === 'services') { v.pend = null; }
      else {
        const p = v.pend;
        if (p >= seg.lanes || p < 0) {
          const z = seg.auxAt(v.s + 20, p < 0 ? -1 : 1);
          const ok = (z && v.s < z.s1 - 25) || (v.isPlayer && v.state === 'held') || v.goShoulder;
          if (!ok) { v.pend = null; if (v.isPlayer) this.ctl.onBlocked('nolane'); }
        }
      }
    }
    if (v.pend !== null) {
      v.pendT -= dt;
      if (v.pendT <= 0) {
        if (this.safe(v, v.pend)) { v.lane = v.pend; v.pend = null; v.lcCool = (v.reckless ? 1.0 : 2.5) + Math.random() * 2; v.lastLC = this.clock; v.squeeze = false; }
        else {
          v.pendWait += dt;
          const aux = v.pend >= seg.lanes || v.pend < 0;
          if (v.pendWait > (v.pendMand ? (v.isPlayer ? (aux ? 3.5 : 1.4) : 12) : 2.5)) {
            const dir = Math.sign(v.pend - v.lane);
            v.pend = null; v.squeeze = false;
            if (v.isPlayer) this.ctl.onBlocked(aux ? 'nolane' : 'busy', dir);
          }
        }
      }
    }
    if (v.pend !== null) v.sig = Math.sign(v.pend - v.lane);
    else if (Math.abs(v.lat - v.targetLat()) < 1.2) v.sig = 0;
    else if (!seg.freeLat) v.sig = Math.sign(v.targetLat() - v.lat);
  }

  /** the player's rig touching another ship: report it to the incident manager */
  private collide(dt: number) {
    const p = this.player;
    if (!p || p.dead || p.state === 'crashed') return;
    if (this.bumpCool > 0) { this.bumpCool -= dt; return; }
    const seg = p.seg;
    if (seg.kind !== 'motorway' && seg.kind !== 'ramp') return;
    for (const o of seg.veh) {
      if (o === p || o.dead || o.alpha < 0.6) continue;
      if (Math.abs(o.lat - p.lat) > (o.w + p.w) / 2 - 1.5) continue;
      if (p.s < o.s - o.totLen + 1 || o.s < p.s - p.totLen + 1) continue;
      const rv = Math.hypot(p.v - o.v, p.latVel - o.latVel);
      this.bumpCool = 2.5;
      this.onCollide(p, o, rv);
      break;
    }
  }

  private nearSignal(v: Veh): boolean {
    for (const st of v.seg.stops) if (st.s - v.s < 450 && st.s - v.s > -260) return true;
    return false;
  }

  private decide(v: Veh) {
    if (v.pend !== null) return;
    const seg = v.seg, n = seg.lanes;
    if (seg.kind === 'ramp' || seg.kind === 'services') return;
    if (Math.abs(v.lat - seg.laneLat(v.lane)) > 3) return;
    if (v.state === 'crashed' || v.emergency) return;
    if (v.state === 'broken' || v.state === 'stopped') {
      if (v.goShoulder && v.lane < n) this.ask(v, v.lane + 1, true);
      return;
    }
    if (v.lane >= n || v.lane < 0) {
      const side = v.lane < 0 ? -1 : 1;
      const z = seg.auxAt(v.s, side);
      if (z && z.type === 'exit') return;
      if (v.state === 'park' || v.state === 'parked') return;
      this.ask(v, side > 0 ? n - 1 : 0, true);
      return;
    }
    // a coned-off lane ahead: get out of it early
    if (!v.ignoreBlock && seg.blocks.length) {
      let hit = false;
      for (const b of seg.blocks) if (b.lane === v.lane && v.s < b.s1 && b.s0 - v.s < 1400) hit = true;
      if (hit) {
        const trapped = this.trapped(v);
        const opts = [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l < n && (trapped || !this.laneClosed(seg, l, v.s)));
        opts.sort((x, y) => (Number(this.laneClosed(seg, x, v.s)) - Number(this.laneClosed(seg, y, v.s))) || this.laneGapAhead(v, y) - this.laneGapAhead(v, x));
        if (opts.length) this.ask(v, opts[0], true);
        return;
      }
    }
    const t = v.route[0];
    const exitAhead = t && t.from === seg && t.type === 'exit' ? t : null;
    if (exitAhead && exitAhead.fromS - v.s < 2800) {
      const edge = exitAhead.side > 0 ? n - 1 : 0;
      if (v.lane !== edge) { this.ask(v, v.lane + exitAhead.side, true); return; }
      if (v.s >= exitAhead.aux!.s0 + 5 && v.s < exitAhead.fromS - 30) { this.ask(v, exitAhead.side > 0 ? n : -1, true); }
      return;
    }
    // lane ends ahead: merge left (gaps open because traffic alongside yields to the indicator)
    if (this.dropping(seg, v.lane, v.s)) {
      if (v.lane > 0) this.ask(v, v.lane - 1, true);
      return;
    }
    // lay-by visits
    if (!v.wantLayby && v.type !== 'police' && v.state === 'drive' && v.lane === n - 1 && seg.kind === 'motorway') {
      for (const z of seg.aux) {
        if (z.type !== 'layby' || v.laybyChecked === z) continue;
        if (seg.drop && z.s1 > seg.len - MERGE_ZONE) continue;
        const d = z.s0 - v.s;
        if (d > 150 && d < 900) {
          v.laybyChecked = z;
          if (Math.random() < (v.trailers.length ? 0.35 : 0.12) && z.slots!.some((sl) => !sl.occ)) v.wantLayby = z;
        }
      }
    }
    if (v.wantLayby) {
      const z = v.wantLayby;
      if (v.s > z.s1 - 260) { v.wantLayby = null; }
      else if (v.s >= z.s0 + 10) {
        const idx = z.slots!.findIndex((sl) => !sl.occ && sl.s > v.s + 50);
        if (idx >= 0 && v.lane === n - 1) { z.slots![idx].occ = v; v.slot = idx; v.state = 'park'; this.ask(v, n, true); return; }
        if (idx < 0) v.wantLayby = null;
      }
      if (v.lane !== n - 1) { this.ask(v, v.lane + 1, true); return; }
      return;
    }
    if (v.lcCool > 0 || n < 2 || this.nearSignal(v)) return;
    const fastOne = v.type === 'pod' || v.type === 'sport';
    const leadSlow = v.leadGap < v.v * 2.6 + 50 && v.leadV < v.vDes * (fastOne || v.reckless ? 0.97 : 0.88);
    const rightExitSoon = exitAhead && exitAhead.side > 0 && exitAhead.fromS - v.s < 4000;
    const leftExitSoon = exitAhead && exitAhead.side < 0 && exitAhead.fromS - v.s < 4000;
    if (leadSlow && v.lane > 0 && !rightExitSoon) {
      if (this.laneGapAhead(v, v.lane - 1) > v.leadGap + 80 && this.safe(v, v.lane - 1)) { this.ask(v, v.lane - 1, false); return; }
    }
    if (v.lane < n - 1 && !leftExitSoon && !this.dropping(seg, v.lane + 1, v.s + 1500) && !this.deadLane(seg, v.lane + 1, v.s)) {
      const ahead = this.laneGapAhead(v, v.lane + 1);
      const keen = fastOne ? 0.04 : v.type === 'mite' || v.type === 'police' || v.type === 'taxi' ? 0.25 : 0.7;
      if (ahead > v.v * 4 + 140 && !leadSlow && this.safe(v, v.lane + 1) && Math.random() < keen) this.ask(v, v.lane + 1, false);
    }
  }
}
