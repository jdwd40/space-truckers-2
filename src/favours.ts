import Phaser from 'phaser';
import { Network, Seg, Services, Station, Trans, Aux } from './network';
import { Traffic, Veh } from './traffic';
import { G, toast, hint, money, save } from './state';
import { rand, pick } from './geom';
import { sfx } from './audio';
import type { GlowLayer } from './glow';

/** Roadside favour tuning: seconds between offers, rewards, how long a boost takes. */
export const FAVOUR_CFG = {
  cooldown: [55, 110] as [number, number],
  firstAfter: 40,
  boostReward: 40,
  parcelReward: 65,
  parcelMisdeliveredReward: 25,
  boostTime: 3.5,
};

export interface FavourHost { player: Veh; pstate: string; laybySlot: { s: number; occ: unknown } | null }

type Boost = { kind: 'boost'; phase: 'waiting' | 'told' | 'boosting' | 'done'; seg: Seg; aux: Aux; veh: Veh; t: number; told: boolean };
type Parcel = { kind: 'parcel'; phase: 'offered' | 'pickup' | 'carry'; svc: Services; target: Station; part: string; seg: Seg };
export type Favour = Boost | Parcel;

const PARTS = ['a spare coupling', 'a coolant pump', 'a nav-beacon board', 'a box of relay fuses', 'a replacement airlock seal', 'a crate of drill bits'];

export class Favours {
  active: Favour | null = null;
  cool = FAVOUR_CFG.firstAfter;
  constructor(public net: Network, public tr: Traffic, public host: FavourHost) {}

  // ------------------------------------------------------------------ HUD text
  /** short objective line for the job card, or '' */
  hud(): string {
    const f = this.active;
    if (!f) return '';
    if (f.kind === 'parcel') return f.phase === 'carry' ? `📦 Parcel for ${f.target.name}` : f.phase === 'pickup' ? `📦 Collecting parcel at ${f.svc.name}` : `📦 ${f.svc.name}: parcel for ${f.target.name}`;
    return f.phase === 'boosting' ? '🔋 Boosting the stranded hauler' : f.told ? '🔋 Stranded hauler in the lay-by ahead' : '';
  }
  /** prompt for the warning chip while the player can act, or '' */
  prompt(): string {
    const f = this.active;
    if (!f || f.kind !== 'boost') return '';
    if (f.phase === 'boosting') return `🔋 Boosting… ${Math.max(1, Math.ceil(f.t))}s`;
    return this.canBoost() ? '🔋 Press E (or tap here) to give the hauler a battery boost' : '';
  }
  private canBoost(): boolean {
    const f = this.active;
    if (!f || f.kind !== 'boost' || f.phase === 'boosting' || f.phase === 'done') return false;
    const p = this.host.player;
    if (this.host.pstate !== 'parked' || p.seg !== f.seg || f.veh.dead) return false;
    const gap = f.veh.s - f.veh.totLen - p.s;
    return gap > -40 && gap < 320;
  }

  // ------------------------------------------------------------------ main loop
  update(dt: number, driving: boolean) {
    const f = this.active;
    if (f) { this.step(f, dt); return; }
    if (!driving) return;
    this.cool -= dt;
    if (this.cool > 0) return;
    this.cool = rand(8, 14); // retry interval while nothing suitable is ahead
    if (Math.random() < 0.5 ? this.tryBoost() || this.tryParcel() : this.tryParcel() || this.tryBoost()) this.cool = 0;
  }
  private finish() {
    this.active = null;
    this.cool = rand(FAVOUR_CFG.cooldown[0], FAVOUR_CFG.cooldown[1]);
  }

  // ------------------------------------------------------------------ battery boost: a hauler stranded in a lay-by ahead
  private tryBoost(): boolean {
    const p = this.host.player, seg = p.seg;
    if (seg.kind !== 'motorway' || p.lane < 0 || p.lane >= seg.lanes) return false;
    const lay = seg.aux.find((a) => a.type === 'layby' && a.s0 > p.s + 2600 && a.s0 < p.s + 6500 && !a.slots![2].occ && (!a.slots![0].occ || !a.slots![1].occ));
    if (!lay) return false;
    const slot = lay.slots![2];
    const type = pick(['van', 'rig', 'bus', 'tanker', 'taxi'] as const);
    const v = this.tr.spawnNPC(seg, slot.s, false, seg.lanes, type);
    if (!v) return false;
    v.v = 0; v.age = 8; v.state = 'parked'; v.wait = 170; v.hazard = true; v.slot = 2; slot.occ = v; v.wantLayby = lay; v.svcTarget = null; v.local = false;
    this.tr.reroute(v);
    this.active = { kind: 'boost', phase: 'waiting', seg, aux: lay, veh: v, t: 0, told: false };
    return true;
  }
  private stepBoost(f: Boost, dt: number) {
    const p = this.host.player;
    if (f.veh.dead || f.veh.state === 'leave' || f.veh.state === 'drive') { if (f.phase === 'done') this.finish(); else { this.active = null; this.cool = rand(20, 40); } return; }
    if (f.phase === 'waiting' && p.seg === f.seg && f.aux.s0 - p.s < 2300 && f.aux.s0 - p.s > 0) {
      f.phase = 'told'; f.told = true;
      toast('🔋 A hauler is stranded in the lay-by ahead — pull in (D) if you fancy giving it a boost', '#ffe27a', 5000);
      hint('favour', 'Optional favours: a stranded ship in a lay-by or a parcel at a fuel stop. Ignore them if you like — there is no clock and no penalty.');
    }
    if (f.phase === 'waiting' || f.phase === 'told') {
      // drove past, or wandered off onto another road: quietly let it go (the hauler leaves on its own later)
      const passed = p.seg === f.seg ? p.s > f.aux.s1 + 150 && this.host.pstate !== 'parked' : p.seg !== f.seg && this.host.pstate !== 'parked' && f.told;
      if (passed || (p.seg !== f.seg && !f.told && f.veh.age > 60)) { this.active = null; this.cool = rand(20, 40); }
      return;
    }
    if (f.phase === 'boosting') {
      f.t -= dt;
      if (Math.random() < dt * 6) sfx.click();
      if (f.t <= 0) {
        f.phase = 'done';
        f.veh.hazard = false; f.veh.wait = 1.5;
        G.money += FAVOUR_CFG.boostReward; save();
        toast(`⚡ Engine's running again! The driver tips you ${money(FAVOUR_CFG.boostReward)}`, '#7ff0c0', 4500);
        sfx.chime(); setTimeout(() => sfx.coin(), 400);
        if (typeof window !== 'undefined') (window as any).Tesana?.track?.('favour', { kind: 'boost' });
      }
    }
  }
  /** E key / tapping the prompt */
  act() {
    const f = this.active;
    if (!f || f.kind !== 'boost' || !this.canBoost()) return;
    f.phase = 'boosting'; f.t = FAVOUR_CFG.boostTime;
    toast('Hooking up the jump leads…', '#9fe9ff', 2000);
    sfx.whoosh();
  }

  // ------------------------------------------------------------------ spare-part delivery: a parcel waiting at a fuel stop
  private tryParcel(): boolean {
    const p = this.host.player, seg = p.seg;
    if (seg.kind !== 'motorway' || p.lane < 0 || p.lane >= seg.lanes) return false;
    const svc = this.net.services.find((sv) => sv.host === seg && sv.exit.fromS > p.s + 2000 && sv.exit.fromS < p.s + 3400);
    if (!svc) return false;
    // the parcel goes where the player is already heading, or to the nearest station from the fuel stop
    let target: Station | null = null;
    if (G.job) target = this.net.byId[G.job.stage === 'pickup' ? G.job.from : G.job.to];
    else {
      // free roaming: the station this road leads to
      let last = seg; while (last.next) last = last.next;
      target = last.arrStation;
    }
    if (!target || !this.net.route(svc.exit.to, 0, this.net.stationGoals(target))) return false;
    const part = pick(PARTS);
    this.active = { kind: 'parcel', phase: 'offered', svc, target, part, seg };
    toast(`📦 ${svc.name} radios: they have ${part} for ${target.name} — pull in there if you'd like to take it`, '#ffe27a', 5500);
    hint('favour', 'Optional favours: a stranded ship in a lay-by or a parcel at a fuel stop. Ignore them if you like — there is no clock and no penalty.');
    return true;
  }
  private stepParcel(f: Parcel, _dt: number) {
    const p = this.host.player;
    if (f.phase === 'offered') {
      // missed the exit: the offer lapses quietly
      if ((p.seg === f.seg && p.s > f.svc.exit.fromS + 60) || (p.seg !== f.seg && p.seg !== f.svc.exit.to)) { this.active = null; this.cool = rand(20, 40); }
    } else if (f.phase === 'pickup') {
      if (p.seg === f.svc.seg && p.v < 6) {
        f.phase = 'carry';
        toast(`📦 Parcel loaded: ${f.part}. Drop it off when you dock at ${f.target.name}`, '#7ff0c0', 4500);
        sfx.coin();
      } else if (p.seg !== f.svc.exit.to && p.seg !== f.svc.seg) { this.active = null; this.cool = rand(20, 40); }
    }
  }
  /** the player took an exit */
  onExit(t: Trans) {
    const f = this.active;
    if (f && f.kind === 'parcel' && f.phase === 'offered' && t.svc === f.svc) { f.phase = 'pickup'; toast('Pulling in for the parcel', '#9fe9ff', 2000); }
  }
  /** the player docked at a station */
  onDocked(st: Station) {
    const f = this.active;
    if (!f || f.kind !== 'parcel' || f.phase !== 'carry') return;
    const right = st === f.target;
    const reward = right ? FAVOUR_CFG.parcelReward : FAVOUR_CFG.parcelMisdeliveredReward;
    G.money += reward; save();
    toast(right ? `📦 Parcel delivered — ${f.target.name} says thanks and slips you ${money(reward)}` : `📦 Left the parcel at ${st.name}'s courier desk to forward on — ${money(reward)} for the trouble`, '#7ff0c0', 5000);
    sfx.chime(); setTimeout(() => sfx.coin(), 400);
    if (typeof window !== 'undefined') (window as any).Tesana?.track?.('favour', { kind: 'parcel', right });
    this.finish();
  }

  private step(f: Favour, dt: number) {
    if (f.kind === 'boost') this.stepBoost(f, dt); else this.stepParcel(f, dt);
  }

  // ------------------------------------------------------------------ jump-lead sparks while boosting
  draw(fx: Phaser.GameObjects.Graphics, gl: GlowLayer, time: number) {
    const f = this.active;
    if (!f || f.kind !== 'boost' || f.phase !== 'boosting') return;
    const p = this.host.player, v = f.veh;
    const a = { x: p.x, y: p.y }, b = v.back(v.totLen - 4);
    fx.lineStyle(2.5, 0xffd23c, 0.8); fx.lineBetween(a.x, a.y, b.x, b.y);
    for (let k = 0; k < 6; k++) { const t = Math.random(); gl.dot(a.x + (b.x - a.x) * t + rand(-6, 6), a.y + (b.y - a.y) * t + rand(-6, 6), rand(1, 2.5), 0xbff4ff, 0.9); }
    gl.soft(b.x, b.y, 16, 0x7fdcff, 0.3 + 0.2 * Math.sin(time * 30));
  }
}
