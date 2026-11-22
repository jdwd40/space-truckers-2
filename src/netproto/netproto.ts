/**
 * PROTOTYPE — throwaway, never merge. Wayfinder ticket "Network feel for driving".
 *
 * Question: with the player's own rig predicted locally and everything else interpolated from authority snapshots, does
 * driving still feel right at 50, 100 and 200 ms latency? What snapshot rate and interpolation delay are needed, and how
 * visible are corrections?
 *
 * How it fakes a network inside one page:
 *  - The AUTHORITY is a second, hidden world (its own Network and Traffic) with all the traffic and its own copy of the
 *    rig. It receives the rig's controls `rtt / 2` late and applies them at the same tick the client did (the client runs
 *    ahead of the authority by the uplink delay, the usual scheme).
 *  - The CLIENT is the game's own WorldScene. Its Traffic simulates only the rig (prediction); every other ship is a
 *    ghost placed from snapshots that arrive `rtt / 2` late and are drawn a further interpolation delay in the past.
 *  - Each snapshot also carries where the authority had the rig at that tick. The client compares that with what it
 *    predicted for the same tick and corrects the difference.
 * Job rules, docking, fuel and money stay on the client: this prototype is about the feel of driving only. Incidents and
 * police stops are switched off.
 */
import { Network, Seg } from '../network';
import { Traffic, Veh, PlayerCtl, VType } from '../traffic';
import { calculateServiceBrake } from '../handling';
import { G, toast } from '../state';
import type { WorldScene } from '../world';

export const CFG = {
  /** round trip in ms, split evenly between uplink and downlink */
  rtt: 100,
  /** extra random delay on each snapshot, ms */
  jitter: 0,
  /** share of snapshots lost */
  loss: 0,
  /** snapshots per second */
  snapRate: 20,
  /** how far in the past other ships are drawn, ms; -1 = two snapshot intervals */
  interp: -1,
  /** other ships drawn in the past between two snapshots, or dead-reckoned forward to the rig's own time */
  display: 'interp' as 'interp' | 'extrap',
  /** the rig's lane changes are predicted at once, or wait for the authority */
  lanes: 'predict' as 'predict' | 'wait',
  /** corrections are spread over a few frames, or applied in one jump */
  smooth: true,
  /** draw where the authority has every ship right now */
  truth: false,
};

interface Ask { tgt: number; mand: boolean; squeeze: boolean }
interface Input {
  dt: number; vd: number; gap: number; braking: boolean; obey: boolean; asks: Ask[]; route: number[];
  tele: { seg: number; s: number; lat: number; lane: number; v: number } | null;
  state: Veh['state']; goShoulder: boolean; ignoreBlock: boolean; trailers: number[]; aMax: number; bComf: number; maxBrake: number;
  stopAt: number | null; pumpDone: boolean;
}
interface Sample {
  ta: number; seg: number; s: number; lat: number; v: number; lane: number; pend: number | null; sig: number;
  braking: boolean; hazard: boolean; siren: boolean; smoke: boolean; state: Veh['state']; alpha: number; crashAng: number;
}
interface VehRec extends Sample { id: number; type: VType; trailers: number[]; variant: number }
interface RigRec { seg: number; s: number; lat: number; lane: number; pend: number | null; v: number; odo: number }
type Ev = { t: 'blocked'; kind?: 'busy' | 'nolane'; dir?: number } | { t: 'bump'; rv: number };
interface Snap { tick: number; ta: number; arrive: number; rig: RigRec; vehs: VehRec[]; events: Ev[] }
interface Ghost { v: Veh; samples: Sample[]; seen: number }
interface Hist { tick: number; seg: number; odo: number; v: number; lane: number }

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** rough wire size of one ship in a snapshot: id 2, section 2, s 3, lat 1, speed 2, lane + flags 2 */
const BYTES_PER_SHIP = 12;

export class NetProto {
  cn: Network; ct: Traffic; pc: Veh;
  an: Network; at: Traffic; pa: Veh;
  private idxC = new Map<Seg, number>(); private idxA = new Map<Seg, number>();
  /** client ticks so far, the shared clock (seconds), and the clock at the end of each tick */
  n = 0; time = 0; private times: number[] = [];
  private inputs: (Input | undefined)[] = []; private aNext = 0; authTime = 0; private lastSnapT = -1;
  private cur: Input;
  private hist: Hist[] = [];
  private wire: Snap[] = []; private events: Ev[] = [];
  ghosts = new Map<number, Ghost>(); private newestTa = -1;
  private odoC = 0; private odoA = 0; private err = 0; private errV = 0;
  private asks: Ask[] = []; private lastAskTick = -1;
  private last: { seg: Seg; s: number };
  private segMis = 0; private laneMis = 0; private lastRecTa = 0; private ignoreBefore = 0;
  // ---- measurements
  private errLog: { t: number; e: number }[] = []; private jumpLog: { t: number; c: number }[] = [];
  stats = { corrections: 0, overrules: 0, hard: 0, authBumps: 0, clientBumps: 0, snaps: 0, ships: 0, sampled: 0 };
  /** every measured prediction error since the last reset(), for the headless run */
  allErr: number[] = [];

  constructor(public scene: WorldScene) {
    this.cn = scene.net; this.ct = scene.traffic; this.pc = scene.player;
    this.an = new Network();
    if (this.an.segs.length !== this.cn.segs.length || this.an.trans.length !== this.cn.trans.length) throw new Error('netproto: the two networks differ');
    this.cn.segs.forEach((s, i) => this.idxC.set(s, i));
    this.an.segs.forEach((s, i) => this.idxA.set(s, i));
    // roadworks and signal phases are random per world: the authority takes the client's
    this.cn.segs.forEach((s, i) => { this.an.segs[i].blocks = s.blocks.map((b) => ({ ...b })); });
    this.cn.signals.forEach((s, i) => { this.an.signals[i].t = s.t; });
    this.cur = this.capture(0.02);
    const self = this;
    const actl: PlayerCtl = {
      desired: () => self.cur.vd,
      extraGap: () => self.cur.gap,
      obeySignal: (_v, _st, state) => self.cur.obey && state !== 'G',
      brakeMin: (v) => {
        if (v.state === 'crashed') return v.v > 0 ? -430 : null;
        if (!self.cur.braking) return null;
        for (const st of v.seg.stops) { const d = st.s - v.s; if (d > -1 && d < 1000 && st.sig.state(st.group) !== 'G') return calculateServiceBrake(v.v, v, d); }
        return calculateServiceBrake(v.v, v);
      },
      onTrans() {}, onRouteNeeded() {},
      onBlocked: (kind, dir) => { self.events.push({ t: 'blocked', kind, dir }); },
    };
    this.at = new Traffic(this.an, actl);
    for (const g of this.ct.gates) this.at.addGate(this.an.segs[this.idxC.get(g.seg)!], g.s);
    const p = this.pc;
    this.pa = this.at.add('player', this.an.segs[this.idxC.get(p.seg)!], p.s, p.lane, p.v);
    this.at.player = this.pa;
    this.at.view = { ...this.ct.view };
    this.at.populate();
    this.at.onCollide = (_a, _b, rv) => { this.stats.authBumps++; this.events.push({ t: 'bump', rv }); };
    // the client world: ghosts only, bumps are just counted, no incidents and no police stops
    this.ct.ghosts = true;
    this.ct.onCollide = () => { this.stats.clientBumps++; };
    (scene.inc as any).update = () => {};
    scene.policeCool = Infinity;
    const ask = this.ct.ask.bind(this.ct);
    this.ct.ask = (v, tgt, mand) => {
      if (v === p && tgt !== v.lane) { this.asks.push({ tgt, mand, squeeze: v.squeeze }); this.lastAskTick = this.n; }
      ask(v, tgt, mand);
    };
    this.last = { seg: p.seg, s: p.s };
  }

  private get up() { return CFG.rtt / 2000; }
  private get down() { return CFG.rtt / 2000; }
  get interp() { return CFG.interp < 0 ? 2 / CFG.snapRate : CFG.interp / 1000; }

  /** one step of both worlds; stands in for `traffic.update(dt)` */
  tick(dt: number) {
    const i = this.n;
    this.ct.holdPlayerLane = CFG.lanes === 'wait';
    this.deliver();
    this.placeGhosts(dt);
    // signals are a fixed cycle, so the client knows their state at the rig's own (ahead) time
    const lead = this.time - this.authTime;
    this.cn.signals.forEach((s, k) => { s.t = this.an.signals[k].t + lead; });
    // ---- client: predict the rig
    const inp = this.capture(dt);
    this.inputs[i] = inp;
    this.ct.update(dt);
    const p = this.pc;
    this.odoC += p.v * dt;
    this.correct(dt);
    this.hist.push({ tick: i, seg: this.idxC.get(p.seg)!, odo: this.odoC, v: p.v, lane: p.lane });
    this.last = { seg: p.seg, s: p.s };
    this.time += dt; this.times[i] = this.time; this.n++;
    // ---- authority: every tick whose controls have had time to arrive
    while (this.aNext < this.n && this.time - this.times[this.aNext] >= this.up - 1e-9) this.stepAuthority(this.aNext++);
  }

  private capture(dt: number): Input {
    const s = this.scene as any, p = this.pc;
    const moved = this.last && (p.seg !== this.last.seg || Math.abs(p.s - this.last.s) > 1e-6);
    return {
      dt, vd: s.desired(p), gap: s.extraGap(p), braking: G.braking, obey: G.braking || !!s.autoHold,
      asks: this.asks.splice(0), route: p.route.map((t) => t.id),
      tele: moved ? { seg: this.idxC.get(p.seg)!, s: p.s, lat: p.lat, lane: p.lane, v: p.v } : null,
      state: p.state, goShoulder: p.goShoulder, ignoreBlock: p.ignoreBlock, trailers: p.trailers, aMax: p.aMax, bComf: p.bComf, maxBrake: p.maxBrake,
      stopAt: p.stopAt === null ? null : p.stopAt - p.s, pumpDone: p.pumpDone,
    };
  }

  private stepAuthority(j: number) {
    const inp = this.inputs[j]!; this.inputs[j] = undefined; this.cur = inp;
    const pa = this.pa, an = this.an;
    if (inp.tele) {
      // the scene put the rig somewhere new (leaving a dock): the authority follows, clearing the spot as the game does
      const seg = an.segs[inp.tele.seg], t = inp.tele;
      for (const v of this.at.vs) if (!v.isPlayer && v.seg === seg && Math.abs(v.lat - t.lat) < 29 && v.s > t.s - pa.totLen - 30 && v.s - v.totLen < t.s + 30) v.dead = true;
      pa.seg = seg; pa.s = t.s; pa.lat = t.lat; pa.lane = t.lane; pa.v = t.v; pa.pend = null; pa.sig = 0;
      pa.resetTrail(); pa.prevSeg = seg; pa.prevS = t.s; pa.enterS = t.s;
    }
    pa.state = inp.state; pa.goShoulder = inp.goShoulder; pa.ignoreBlock = inp.ignoreBlock;
    pa.aMax = inp.aMax; pa.bComf = inp.bComf; pa.maxBrake = inp.maxBrake;
    if (pa.trailers.length !== inp.trailers.length || pa.trailers.some((x, k) => x !== inp.trailers[k])) pa.setTrailers(inp.trailers);
    pa.stopAt = inp.stopAt === null ? null : pa.s + inp.stopAt;
    if (inp.pumpDone && pa.seg.svc) pa.pumpDone = true;
    pa.route = inp.route.map((id) => an.trans[id]);
    for (const a of inp.asks) { pa.squeeze = a.squeeze; this.at.ask(pa, a.tgt, a.mand); }
    this.at.view = this.ct.view;
    this.at.update(inp.dt);
    this.odoA += pa.v * inp.dt;
    this.authTime = this.times[j];
    if (this.authTime - this.lastSnapT >= 1 / CFG.snapRate - 1e-6) { this.lastSnapT = this.authTime; this.snapshot(j); }
  }

  private snapshot(tick: number) {
    if (Math.random() < CFG.loss) return; // events wait for the next one, as on a reliable channel
    const pa = this.pa, vw = this.at.view, R = vw.r + 2600, ta = this.authTime;
    const vehs: VehRec[] = [];
    for (const v of this.at.vs) {
      if (v.dead || v === pa || Math.abs(v.x - vw.x) > R || Math.abs(v.y - vw.y) > R) continue;
      vehs.push({
        id: v.id, type: v.type, trailers: v.trailers, variant: v.variant, ta, seg: this.idxA.get(v.seg)!, s: v.s, lat: v.lat, v: v.v,
        lane: v.lane, pend: v.pend, sig: v.sig, braking: v.braking, hazard: v.hazard, siren: v.siren, smoke: v.smoke, state: v.state, alpha: v.alpha, crashAng: v.crashAng,
      });
    }
    this.wire.push({
      tick, ta, arrive: this.time + this.down + Math.random() * CFG.jitter / 1000, vehs, events: this.events.splice(0),
      rig: { seg: this.idxA.get(pa.seg)!, s: pa.s, lat: pa.lat, lane: pa.lane, pend: pa.pend, v: pa.v, odo: this.odoA },
    });
  }

  // ------------------------------------------------------------------ client side
  private deliver() {
    if (!this.wire.length) return;
    const due = this.wire.filter((s) => s.arrive <= this.time).sort((a, b) => a.ta - b.ta);
    if (!due.length) return;
    this.wire = this.wire.filter((s) => s.arrive > this.time);
    for (const snap of due) {
      for (const e of snap.events) {
        if (e.t === 'bump') toast('Authority: you bumped another ship', '#ffb4a0', 1800);
        else if (CFG.lanes === 'wait') { this.pc.pend = null; this.scene.onBlocked(e.kind, e.dir); }
      }
      if (snap.ta <= this.newestTa) continue; // overtaken by a newer one
      this.newestTa = snap.ta;
      this.stats.snaps++; this.stats.ships = snap.vehs.length;
      for (const r of snap.vehs) {
        let g = this.ghosts.get(r.id);
        if (!g) {
          const v = new Veh(r.type, this.cn.segs[r.seg], r.s, r.lane, r.v);
          v.id = r.id; v.setTrailers(r.trailers); v.variant = r.variant; v.lat = r.lat; v.alpha = 0; v.pumpDone = true;
          v.resetTrail();
          this.ct.addGhost(v);
          g = { v, samples: [], seen: 0 };
          this.ghosts.set(r.id, g);
        }
        g.samples.push(r); g.seen = snap.ta;
        while (g.samples.length > 2 && g.samples[1].ta < snap.ta - 1) g.samples.shift();
      }
      this.reconcile(snap);
    }
  }

  private placeGhosts(dt: number) {
    const extrap = CFG.display === 'extrap';
    const past = this.time - this.up - this.down - this.interp;
    const tau = extrap ? this.time : past;
    for (const [id, g] of this.ghosts) {
      if (g.seen < this.newestTa && (extrap || past >= g.seen)) { this.ct.dropGhost(g.v); this.ghosts.delete(id); continue; }
      const S = g.samples, v = g.v, first = S[0], lastS = S[S.length - 1];
      let seg: Seg, s: number, lat: number, src: Sample;
      if (tau >= lastS.ta) {
        // nothing newer has arrived: carry on at the last known speed (always the case when dead-reckoning)
        const d = Math.min(tau - lastS.ta, extrap ? 1 : 0.25);
        src = lastS; seg = this.cn.segs[lastS.seg]; s = lastS.s + lastS.v * d; lat = lastS.lat;
      } else if (tau <= first.ta) { src = first; seg = this.cn.segs[first.seg]; s = first.s; lat = first.lat; }
      else {
        let k = S.length - 2;
        while (k > 0 && S[k].ta > tau) k--;
        const a = S[k], b = S[k + 1], f = (tau - a.ta) / (b.ta - a.ta);
        src = f < 0.5 ? a : b;
        if (a.seg === b.seg) { seg = this.cn.segs[a.seg]; s = a.s + (b.s - a.s) * f; lat = a.lat + (b.lat - a.lat) * f; }
        else {
          // crossed onto another section between the two snapshots: travel the distance covered, on whichever side it falls
          const dist = (a.v + b.v) / 2 * (b.ta - a.ta), sa = a.s + dist * f, segA = this.cn.segs[a.seg];
          if (sa <= segA.len) { seg = segA; s = sa; lat = a.lat; src = a; }
          else { seg = this.cn.segs[b.seg]; s = Math.max(0, b.s - dist * (1 - f)); lat = b.lat; src = b; }
        }
      }
      if (s > seg.len) { const q = this.cn.place(seg, s); seg = q.seg; s = Math.min(q.s, q.seg.len); }
      const same = v.seg === seg;
      if (extrap && same && Math.abs(s - v.s) < 80) {
        // dead reckoning: ease towards the new estimate instead of jumping whenever a snapshot disagrees
        const k = Math.min(1, 6 * dt), fwd = v.s + src.v * dt;
        s = fwd + (s - fwd) * k; lat = v.lat + (lat - v.lat) * Math.min(1, 10 * dt);
      }
      const jump = !same || Math.abs(s - v.s) > 200;
      v.latVel = same && dt > 0 ? (lat - v.lat) / dt : 0;
      v.seg = seg; v.s = s; v.lat = lat; v.v = src.v; v.lane = src.lane; v.pend = src.pend; v.sig = src.sig;
      v.braking = src.braking; v.hazard = src.hazard; v.siren = src.siren; v.smoke = src.smoke; v.state = src.state; v.alpha = src.alpha; v.crashAng = src.crashAng;
      v.dead = false;
      if (jump && !same && v.age === 0) { v.resetTrail(); }
      this.ct.placeGhost(v, dt);
    }
  }

  /** compare what the authority had for the rig at a tick with what was predicted for that tick */
  private reconcile(snap: Snap) {
    while (this.hist.length && this.hist[0].tick < snap.tick) this.hist.shift();
    const h = this.hist[0], r = snap.rig, p = this.pc;
    const dT = snap.ta - this.lastRecTa; this.lastRecTa = snap.ta;
    if (!h || h.tick !== snap.tick || snap.tick < this.ignoreBefore) return;
    if (r.seg !== h.seg) {
      this.segMis += dT;
      if (this.segMis > 0.4) { this.hardSnap(snap); return; }
    } else this.segMis = 0;
    this.err = r.odo - h.odo; this.errV = r.v - h.v;
    const e = Math.abs(this.err);
    this.errLog.push({ t: this.time, e }); this.allErr.push(e); this.stats.sampled++;
    if (e > 2) this.stats.corrections++;
    if (r.seg !== h.seg || this.idxC.get(p.seg) !== r.seg || snap.tick < this.lastAskTick) return;
    if (CFG.lanes === 'wait') {
      p.lane = r.lane;
      if (r.pend === null) p.pend = null;
      return;
    }
    if (r.lane !== h.lane) {
      this.laneMis += dT;
      // the authority has finished deciding and still disagrees: it wins
      if (this.laneMis > 0.25 && r.pend === null) {
        p.lane = r.lane; p.pend = null;
        for (const x of this.hist) x.lane = r.lane;
        this.laneMis = 0; this.stats.overrules++;
        toast('Authority overruled your lane change', '#ffb4a0', 1800);
      }
    } else this.laneMis = 0;
  }

  /** the rig is on another road than the authority's: take the authority's place outright */
  private hardSnap(snap: Snap) {
    const p = this.pc, r = snap.rig;
    p.seg = this.cn.segs[r.seg]; p.s = r.s; p.lat = r.lat; p.lane = r.lane; p.v = r.v; p.pend = null;
    p.prevSeg = null; p.resetTrail();
    const ahead = r.v * (this.time - snap.ta);
    this.ct.nudge(p, ahead);
    this.odoC = r.odo + ahead; this.hist.length = 0; this.ignoreBefore = this.n;
    this.err = this.errV = 0; this.segMis = this.laneMis = 0;
    this.last = { seg: p.seg, s: p.s };
    this.stats.hard++;
    toast('Authority put your rig back on its road', '#ff8a7a', 2200);
    this.ct.reroute(p);
  }

  private correct(dt: number) {
    const p = this.pc;
    let c = Math.abs(this.err) < 0.05 ? 0 : this.err, cv = this.errV;
    if (CFG.smooth) { const lim = Math.max(30 * dt, Math.abs(c) * 6 * dt); c = clamp(c, -lim, lim); cv *= Math.min(1, 8 * dt); }
    if (c) {
      this.ct.nudge(p, c); this.odoC += c; this.err -= c;
      for (const h of this.hist) h.odo += c;
      this.jumpLog.push({ t: this.time, c: Math.abs(c) });
    }
    if (cv) {
      p.v = Math.max(0, p.v + cv); this.errV -= cv;
      for (const h of this.hist) h.v += cv;
    }
  }

  // ------------------------------------------------------------------ read-outs
  /** prediction error over the last `win` seconds, in road units (a cab is 26 long, a lane 32 wide) */
  summary(win = 10) {
    const t0 = this.time - win;
    this.errLog = this.errLog.filter((x) => x.t >= t0); this.jumpLog = this.jumpLog.filter((x) => x.t >= t0);
    const es = this.errLog.map((x) => x.e).sort((a, b) => a - b);
    const q = (f: number) => es.length ? es[Math.min(es.length - 1, Math.floor(es.length * f))] : 0;
    return {
      mean: es.reduce((a, b) => a + b, 0) / Math.max(1, es.length), p95: q(0.95), max: q(1),
      jump: this.jumpLog.reduce((a, x) => Math.max(a, x.c), 0),
      behind: (CFG.display === 'extrap' ? 0 : this.up + this.down + this.interp) * 1000,
      kbps: this.stats.ships * BYTES_PER_SHIP * CFG.snapRate / 1000,
      ghosts: this.ghosts.size, authShips: this.at.vs.length,
    };
  }
  reset() { this.allErr = []; this.errLog = []; this.jumpLog = []; this.stats = { corrections: 0, overrules: 0, hard: 0, authBumps: 0, clientBumps: 0, snaps: 0, ships: this.stats.ships, sampled: 0 }; }

  /** where the authority has every ship near the view right now (its present, `rtt / 2` behind the rig's own tick) */
  truth(): { x: number; y: number; h: number; len: number; rig: boolean }[] {
    const vw = this.ct.view, out = [];
    for (const v of this.at.vs) if (!v.dead && Math.abs(v.x - vw.x) < vw.r && Math.abs(v.y - vw.y) < vw.r) out.push({ x: v.x, y: v.y, h: v.h, len: v.totLen, rig: v === this.pa });
    return out;
  }
}
