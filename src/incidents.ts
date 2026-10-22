import Phaser from 'phaser';
import { Network, Seg, LW } from './network';
import { Traffic, Veh } from './traffic';
import { clamp, pick, rand } from './geom';
import { SPEEDS, bumperCrashAt, bumperFee, bumperRepair } from './state';

export interface Block { lane: number; s0: number; s1: number; inc: Incident }
export interface Incident {
  id: number; kind: 'breakdown' | 'accident'; seg: Seg;
  cas: Veh[]; lanes: number[]; shoulder: boolean;
  phase: 'stopping' | 'wait' | 'repair' | 'clear';
  t: number; stopT: number; front: number; rear: number;
  policeAt: number; towAt: number; police: Veh | null; tow: Veh | null; policeHere: boolean; towHere: boolean;
  repairT: number; repairDur: number; clearT: number; withPlayer: boolean; blocks: Block[]; done: boolean; waited: number;
}
export interface IncHooks {
  playerCrashed(inc: Incident, atFault: boolean, other: Veh | null, fee: number): void;
  playerReleased(inc: Incident, waited: number): void;
  bump(fee: number, atFault: boolean, other: Veh, saved: boolean): void;
}

export class Incidents {
  list: Incident[] = [];
  nextId = 1;
  spawnT = 20;
  stopT = 16;
  constructor(public net: Network, public tr: Traffic, public hooks: IncHooks) {
    tr.onCollide = (a, b, rv) => this.collision(a, b, rv);
  }

  // ------------------------------------------------------------ main loop
  update(dt: number, active: boolean) {
    if (active) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnT = rand(34, 60); this.trySpawn(); }
      this.stopT -= dt;
      if (this.stopT <= 0) { this.stopT = rand(10, 20); this.tryTrafficStop(); }
    }
    for (const inc of this.list) this.step(inc, dt);
    this.list = this.list.filter((i) => !i.done);
  }

  private step(inc: Incident, dt: number) {
    inc.t += dt;
    if (inc.withPlayer) inc.waited += dt;
    if (inc.phase === 'stopping') {
      inc.stopT += dt;
      if (inc.cas.every((v) => v.dead || v.v < 1.5) || inc.stopT > 9) this.settle(inc);
    } else if (inc.phase === 'wait') {
      if (!inc.police && inc.t >= inc.policeAt) this.dispatch(inc, 'police');
      if (!inc.tow && inc.t >= inc.towAt) this.dispatch(inc, 'tow');
      const here = (r: Veh | null) => !!r && !r.dead && r.v < 3 && r.stopAt !== null && r.stopAt - r.s < 40;
      if (here(inc.police)) inc.policeHere = true;
      if (here(inc.tow)) inc.towHere = true;
      const policeOk = inc.policeHere || (!!inc.police && inc.police.dead);
      const towOk = inc.towHere || (!!inc.tow && inc.tow.dead);
      if (policeOk && towOk) { inc.phase = 'repair'; inc.repairT = inc.repairDur; }
      else if (inc.t > 90) { inc.phase = 'repair'; inc.repairT = 1; }
    } else if (inc.phase === 'repair') {
      inc.repairT -= dt;
      if (inc.repairT <= 0) this.release(inc);
    } else {
      inc.clearT -= dt;
      if (inc.clearT <= 0) this.finish(inc);
    }
  }

  private settle(inc: Incident) {
    const seg = inc.seg, n = seg.lanes;
    let front = -Infinity, rear = Infinity;
    const lanes = new Set<number>();
    for (const v of inc.cas) {
      if (v.dead) continue;
      front = Math.max(front, v.s); rear = Math.min(rear, v.s - v.totLen);
      lanes.add(clamp(v.lane, 0, n - 1));
    }
    if (front === -Infinity) { inc.done = true; return; }
    inc.front = front; inc.rear = rear;
    inc.lanes = [...lanes].sort((a, b) => a - b);
    const s0 = Math.max(40, rear - 430), s1 = front + 70;
    for (const l of inc.lanes) { const b: Block = { lane: l, s0, s1, inc }; seg.blocks.push(b); inc.blocks.push(b); }
    inc.phase = 'wait'; inc.t = 0;
    inc.policeAt = inc.withPlayer ? rand(8, 11) : rand(9, 14);
    inc.towAt = inc.policeAt + (inc.withPlayer ? rand(9, 13) : rand(10, 16));
  }

  private dispatch(inc: Incident, type: 'police' | 'tow') {
    const seg = inc.seg;
    const lane = inc.lanes[0];
    const stopAt = type === 'police' ? inc.rear - 24 : inc.rear - 24 - 28 - 34;
    const vw = this.tr.view;
    let s = Math.max(120, inc.rear - 3300);
    for (let i = 0; i < 7; i++) {
      const p = seg.path.at(s);
      if (s <= 130 || Math.hypot(p.x - vw.x, p.y - vw.y) > vw.r + 120) break;
      s = Math.max(120, s - 450);
    }
    if (s > stopAt - 160) s = Math.max(60, stopAt - 160);
    for (let i = 0; i < 8 && !this.tr.laneFree(seg, s, lane, 32); i++) s = Math.max(40, s - 70);
    const v = this.tr.add(type, seg, s, lane, 300);
    v.emergency = true; v.ignoreBlock = true; v.siren = true; v.vDes = 400; v.local = false; v.stopAt = stopAt; v.resp = inc;
    if (type === 'police') inc.police = v; else inc.tow = v;
  }

  private release(inc: Incident) {
    for (const v of inc.cas) {
      if (v.dead) continue;
      v.hazard = false; v.smoke = false; v.crashAng = 0; v.goShoulder = false;
      if (v.isPlayer) { v.state = 'drive'; this.hooks.playerReleased(inc, inc.waited); }
      else { v.state = 'leave'; v.decideT = 0; v.vDes = Math.max(v.vDes, 230); }
    }
    for (const r of [inc.police, inc.tow]) {
      if (!r || r.dead) continue;
      r.stopAt = null; r.emergency = false; r.siren = false; r.resp = null;
      r.dest = pick(this.net.stations).id; r.state = 'drive'; r.decideT = 0.5;
      this.tr.reroute(r);
    }
    inc.phase = 'clear'; inc.clearT = 7;
  }

  private finish(inc: Incident) {
    for (const b of inc.blocks) { const i = inc.seg.blocks.indexOf(b); if (i >= 0) inc.seg.blocks.splice(i, 1); }
    for (const r of [inc.police, inc.tow]) if (r) r.ignoreBlock = false;
    inc.done = true;
  }

  // ------------------------------------------------------------ creating incidents
  private create(kind: 'breakdown' | 'accident', seg: Seg, cas: Veh[], withPlayer: boolean): Incident {
    const inc: Incident = {
      id: this.nextId++, kind, seg, cas, lanes: [], shoulder: false, phase: 'stopping', t: 0, stopT: 0, front: 0, rear: 0,
      policeAt: 0, towAt: 0, police: null, tow: null, policeHere: false, towHere: false,
      repairT: 0, repairDur: (kind === 'accident' ? rand(12, 17) : rand(9, 13)) * (withPlayer ? bumperRepair() : 1), clearT: 0, withPlayer, blocks: [], done: false, waited: 0,
    };
    this.list.push(inc);
    return inc;
  }
  private crash(v: Veh) {
    v.state = 'crashed'; v.hazard = true; v.smoke = true; v.pend = null; v.sig = 0; v.goShoulder = false; v.latT = null;
    v.crashAng = (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.34);
    v.wantLayby = null;
  }

  clearStretch(seg: Seg, a: number, b: number): boolean {
    for (const z of seg.aux) if (z.s1 > a && z.s0 < b) return false;
    for (const st of seg.stops) if (st.s > a && st.s < b) return false;
    return true;
  }

  /** put a breakdown or crash on the player's own road, a few km ahead, so it is actually met */
  private spawnAhead(): boolean {
    const tr = this.tr, p = tr.player, seg = p.seg;
    if (seg.kind !== 'motorway' || p.lane < 0 || p.lane >= seg.lanes || p.state === 'crashed') return false;
    if (this.list.some((i) => i.seg === seg && i.front > p.s - 600 && i.front < p.s + 6500)) return false;
    for (let tries = 0; tries < 8; tries++) {
      const s = p.s + rand(2500, 5000);
      if (s > seg.len - 2500) return false;
      if (!this.clearStretch(seg, s - 500, s + 500)) continue;
      const lane = Math.floor(rand(0, seg.lanes));
      const v = tr.spawnNPC(seg, s, false, lane, pick(['mite', 'taxi', 'pod', 'van', 'rig', 'tanker', 'long', 'bus'] as const));
      if (!v) continue;
      v.age = 8;
      if (Math.random() < 0.45) {
        const o = tr.spawnNPC(seg, s + v.totLen + 22, false, lane, 'van');
        if (o) {
          o.age = 8;
          const inc = this.create('accident', seg, [v, o], false);
          for (const c of inc.cas) this.crash(c);
          return true;
        }
      }
      const inc = this.create('breakdown', seg, [v], false);
      v.state = 'broken'; v.hazard = true; v.stopT = 7;
      v.goShoulder = Math.random() < 0.6 && this.clearStretch(seg, s - 450, s + 1800);
      inc.shoulder = v.goShoulder;
      return true;
    }
    return false;
  }

  private trySpawn() {
    const tr = this.tr, p = tr.player;
    if (this.list.filter((i) => !i.withPlayer && !i.done).length >= 3) return;
    if (Math.random() < 0.7 && this.spawnAhead()) return;
    const cands: Veh[] = [];
    for (const v of tr.vs) {
      if (v.isPlayer || v.dead || v.state !== 'drive' || v.emergency || v.type === 'police' || v.type === 'tow') continue;
      const seg = v.seg;
      if (seg.kind !== 'motorway' || v.lane < 0 || v.lane >= seg.lanes || v.age < 6) continue;
      if (v.s < 2500 || v.s > seg.len - 2500) continue;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < 1700 || d > 7500) continue;
      if (this.list.some((i) => i.seg === seg && Math.abs(i.front - v.s) < 2500)) continue;
      if (!this.clearStretch(seg, v.s - 450, v.s + 300)) continue;
      cands.push(v);
    }
    if (!cands.length) return;
    const ahead = cands.filter((v) => v.seg === p.seg && v.s > p.s + 1700 && v.s < p.s + 7000);
    const v = pick(ahead.length && Math.random() < 0.75 ? ahead : cands);
    const seg = v.seg;
    // an accident needs a neighbour to crash into
    let partner: Veh | null = null;
    for (const o of seg.veh) {
      if (o === v || o.dead || o.state !== 'drive' || o.emergency || o.isPlayer) continue;
      const rearEnd = o.lane === v.lane && o.s > v.s && o.s - o.totLen - v.s < 170;
      const side = Math.abs(o.lane - v.lane) === 1 && Math.abs(o.s - v.s) < 30;
      if (rearEnd || side) { partner = o; break; }
    }
    if (partner && Math.random() < 0.5) {
      const inc = this.create('accident', seg, [v, partner], false);
      for (const c of inc.cas) this.crash(c);
    } else {
      const inc = this.create('breakdown', seg, [v], false);
      v.state = 'broken'; v.hazard = true; v.stopT = 7;
      v.goShoulder = Math.random() < 0.6 && this.clearStretch(seg, v.s - 450, v.s + 1800);
      inc.shoulder = v.goShoulder;
    }
  }

  /** a patrol car picks on a speeding ship near the player and pulls it over onto the hard shoulder */
  private tryTrafficStop() {
    const tr = this.tr, vw = tr.view;
    const cops = tr.vs.filter((v) => v.type === 'police' && !v.emergency && v.state === 'drive' && !v.isPlayer && v.seg.kind === 'motorway' && v.lane >= 0 && v.lane < v.seg.lanes && v.age > 6);
    for (let i = cops.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cops[i], cops[j]] = [cops[j], cops[i]]; }
    for (const cop of cops) {
      if (Math.hypot(cop.x - vw.x, cop.y - vw.y) > vw.r + 4200) continue;
      const seg = cop.seg;
      if (cop.s < 1500 || cop.s > seg.len - 2800) continue;
      const lim = SPEEDS[seg.limitAt(cop.s)];
      let off: Veh | null = null;
      for (const o of seg.veh) {
        if (o.isPlayer || o.dead || o.state !== 'drive' || o.emergency || o.type === 'police' || o.type === 'tow') continue;
        if (o.s > cop.s + 40 && o.s - cop.s < 1100 && o.lane >= 0 && o.lane < seg.lanes && o.v > lim * 1.02) { off = o; break; }
      }
      if (!off) continue;
      if (!this.clearStretch(seg, cop.s - 150, off.s + 1600)) continue;
      off.state = 'stopped'; off.goShoulder = true; off.stopT = rand(9, 14); off.pend = null; off.giveUp = 0; off.partner = cop; cop.partner = off;
      cop.state = 'stopped'; cop.goShoulder = true; cop.stopT = off.stopT + 2; cop.siren = true; cop.pend = null; cop.giveUp = 0;
      return;
    }
  }

  // ------------------------------------------------------------ collisions with the player
  collision(a: Veh, b: Veh, rv: number) {
    const p = a.isPlayer ? a : b, o = a.isPlayer ? b : a;
    const seg = p.seg;
    const still = o.state === 'broken' || o.state === 'crashed' || o.state === 'stopped' || (o.stopAt !== null && o.v < 3);
    const lim = bumperCrashAt();
    const major = rv >= lim || (still && rv >= lim - 22);
    const wouldMajor = rv >= 62 || (still && rv >= 40);
    const atFault = this.tr.clock - p.lastLC < 2.4 || (p.s <= o.s + 4 && p.v > o.v + 5 && Math.abs(p.lat - o.lat) < LW * 0.9) || still;
    const canInc = seg.kind === 'motorway' && p.lane >= 0 && p.lane < seg.lanes && o.lane >= 0 && o.lane < seg.lanes;
    if (major && canInc) {
      const free = o.state === 'drive' || o.state === 'leave';
      const cas = free ? [p, o] : [p];
      const inc = this.create('accident', seg, cas, true);
      for (const c of cas) this.crash(c);
      this.tr.bumpCool = 8;
      const fee = atFault ? Math.round((140 + Math.random() * 80) * bumperFee() / 5) * 5 : 0;
      this.hooks.playerCrashed(inc, atFault, o, fee);
      return;
    }
    // minor bump: nudge apart, keep driving
    const same = Math.abs(p.lat - o.lat) < LW * 0.6;
    if (same) { const rearV = p.s < o.s ? p : o, frontV = rearV === p ? o : p; rearV.s = frontV.s - frontV.totLen - 1.5; rearV.v = Math.min(rearV.v, frontV.v); }
    else p.lat += Math.sign(p.lat - o.lat || 1) * 5;
    p.v *= 0.8;
    const fee = atFault ? Math.round((25 + Math.random() * 40) * bumperFee() / 5) * 5 : 0;
    this.tr.bumpCool = 5;
    this.hooks.bump(fee, atFault, o, wouldMajor);
  }

  // ------------------------------------------------------------ queries for the player's guidance
  hazardAhead(seg: Seg, s: number): { d: number; lanes: number[]; inc: Incident } | null {
    let best: { d: number; lanes: number[]; inc: Incident } | null = null;
    for (const b of seg.blocks) {
      if (b.s1 < s - 20) continue;
      const d = Math.max(0, b.s0 - s);
      if (d > 2400) continue;
      if (!best || d < best.d) best = { d, lanes: (b.inc as Incident).lanes, inc: b.inc as Incident };
    }
    return best;
  }
  laneBlockedAhead(seg: Seg, lane: number, s: number, range: number): { d: number; inc: Incident } | null {
    for (const b of seg.blocks) if (b.lane === lane && b.s1 > s - 20 && b.s0 - s < range) return { d: Math.max(0, b.s0 - s), inc: b.inc as Incident };
    return null;
  }
  inSlowZone(seg: Seg, s: number): boolean {
    for (const b of seg.blocks) if (s > b.s0 - 160 && s < b.s1 + 80) return true;
    return false;
  }
  status(inc: Incident): string {
    if (inc.phase === 'stopping') return 'Crash! Everything has stopped…';
    if (inc.phase === 'wait') {
      if (!inc.policeHere) return `Waiting for police — they are on their way`;
      return 'Police are on the scene — repair truck on its way';
    }
    if (inc.phase === 'repair') return `Repair crew at work — about ${Math.max(1, Math.ceil(inc.repairT))}s to go`;
    return 'All clear — pulling out…';
  }

  // ------------------------------------------------------------ drawing the scene
  private openLane(inc: Incident): number {
    const n = inc.seg.lanes, l0 = inc.lanes[0];
    let best = -1, bd = 99;
    for (let l = 0; l < n; l++) if (!inc.lanes.includes(l) && Math.abs(l - l0) < bd) { bd = Math.abs(l - l0); best = l; }
    return best < 0 ? l0 : best;
  }

  draw(g: Phaser.GameObjects.Graphics, fx: Phaser.GameObjects.Graphics, time: number, cx: number, cy: number, r: number) {
    g.clear();
    const rect = (x: number, y: number, h: number, len: number, wid: number, col: number, a = 1) => {
      const c = Math.cos(h), s = Math.sin(h), nx = -s, ny = c;
      g.fillStyle(col, a);
      g.fillPoints([
        new Phaser.Geom.Point(x - c * len / 2 - nx * wid / 2, y - s * len / 2 - ny * wid / 2),
        new Phaser.Geom.Point(x + c * len / 2 - nx * wid / 2, y + s * len / 2 - ny * wid / 2),
        new Phaser.Geom.Point(x + c * len / 2 + nx * wid / 2, y + s * len / 2 + ny * wid / 2),
        new Phaser.Geom.Point(x - c * len / 2 + nx * wid / 2, y - s * len / 2 + ny * wid / 2),
      ], true);
    };
    for (const inc of this.list) {
      if (inc.phase === 'stopping') {
        for (const v of inc.cas) if (v.smoke) this.smoke(fx, v, time);
        continue;
      }
      const seg = inc.seg;
      const mid = seg.path.at((inc.rear + inc.front) / 2);
      if (Math.hypot(mid.x - cx, mid.y - cy) > r + 700) continue;
      const open = this.openLane(inc);
      const l0 = inc.lanes[0];
      const dir = Math.sign(seg.laneLat(open) - seg.laneLat(l0)) || 1;
      // cones along the closed lane(s)
      for (const b of inc.blocks) {
        for (let s = b.s0 + 24; s < inc.rear - 70; s += 50) {
          const q = seg.path.at(s, seg.laneLat(b.lane));
          g.fillStyle(0x000000, 0.3); g.fillCircle(q.x + 2, q.y + 3, 6);
          g.fillStyle(0xff7a1a, 1); g.fillCircle(q.x, q.y, 6);
          g.fillStyle(0xffffff, 1); g.fillCircle(q.x, q.y, 3.6);
          g.fillStyle(0xff7a1a, 1); g.fillCircle(q.x, q.y, 1.8);
        }
      }
      // flashing arrow board at the start of the closure
      const bp = seg.path.at(inc.blocks[0].s0 - 14, seg.laneLat(l0));
      rect(bp.x + 2, bp.y + 3, bp.h, 16, 46, 0x000000, 0.3);
      rect(bp.x, bp.y, bp.h, 16, 46, 0x22262f, 1);
      const act = Math.floor(time * 4) % 4;
      for (let i = 0; i < 3; i++) {
        const q = seg.path.at(inc.blocks[0].s0 - 14, seg.laneLat(l0) + dir * (i - 1) * 13);
        const on = i === act || (i === 0 && act === 3);
        g.fillStyle(on ? 0xffc02a : 0x5a4a1a, 1); g.fillCircle(q.x, q.y, 4.6);
        if (on) { fx.fillStyle(0xffb020, 0.5); fx.fillCircle(q.x, q.y, 14); }
      }
      // officer waving traffic past
      if (inc.policeHere && inc.phase !== 'clear') {
        const so = inc.blocks[0].s0 + 100;
        const o = seg.path.at(so, seg.laneLat(l0) + dir * 5);
        const lat = { x: -Math.sin(o.h) * dir, y: Math.cos(o.h) * dir };
        const al = { x: Math.cos(o.h), y: Math.sin(o.h) };
        const sw = Math.sin(time * 5);
        const tx = o.x + lat.x * 17 + al.x * sw * 10, ty = o.y + lat.y * 17 + al.y * sw * 10;
        g.fillStyle(0x000000, 0.3); g.fillCircle(o.x + 2, o.y + 3, 8);
        g.fillStyle(0xffd23c, 1); g.fillCircle(o.x, o.y, 8);
        g.fillStyle(0x1c2a52, 1); g.fillCircle(o.x - al.x * 2, o.y - al.y * 2, 3.6);
        g.fillStyle(0xf2c9a0, 1); g.fillCircle(o.x, o.y, 3.6);
        g.lineStyle(3.5, 0xffd23c, 1); g.lineBetween(o.x, o.y, tx, ty);
        g.fillStyle(0xff3b30, 1); g.fillCircle(tx, ty, 3.6);
        fx.fillStyle(0xff3b30, 0.6); fx.fillCircle(tx, ty, 12);
      }
      // repair crew welding next to the casualty
      if (inc.phase === 'repair' && inc.towHere) {
        const v = inc.cas.find((c) => !c.dead);
        if (v) {
          const q = seg.path.at(v.s - v.totLen + 2, seg.laneLat(l0) - dir * 14);
          g.fillStyle(0xffb020, 1); g.fillCircle(q.x, q.y, 4.5); g.fillStyle(0xf2c9a0, 1); g.fillCircle(q.x, q.y, 2.3);
          for (let k = 0; k < 4; k++) { fx.fillStyle(0xbff4ff, 0.8); fx.fillCircle(q.x + rand(-9, 9), q.y + rand(-9, 9), rand(0.8, 2.2)); }
          fx.fillStyle(0x7fdcff, 0.35 + 0.2 * Math.sin(time * 30)); fx.fillCircle(q.x, q.y, 9);
        }
      }
      for (const v of inc.cas) if (v.smoke) this.smoke(fx, v, time);
    }
  }
  private smoke(fx: Phaser.GameObjects.Graphics, v: Veh, time: number) {
    for (let k = 0; k < 4; k++) {
      const ph = (time * 0.7 + k / 4 + v.id * 0.37) % 1;
      fx.fillStyle(0xdde6f5, (1 - ph) * 0.16);
      fx.fillCircle(v.x + Math.sin(v.id + k * 2) * 6 + ph * 10, v.y + Math.cos(v.id * 1.3 + k) * 5 - ph * 12, 4 + ph * 10);
    }
    if (Math.random() < 0.15) { fx.fillStyle(0xffd27a, 0.7); fx.fillCircle(v.x + rand(-6, 6), v.y + rand(-6, 6), rand(1, 2.2)); }
  }
}
