import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Events: { EventEmitter: class { emit() {} } } } }));
vi.mock('./state', () => ({ SPEEDS: [0, 90, 150, 215, 280, 345], bumperCrashAt: () => 60, bumperFee: () => 1, bumperRepair: () => 1 }));

import { Path } from './geom';
import { Network, Seg, TAPER } from './network';
import { MERGE_ZONE, Traffic, TRAFFIC_CFG, Veh, type PlayerCtl, type VType } from './traffic';
import { Incidents } from './incidents';
import { openLanes, Roadworks, WORKS_CFG } from './roadworks';

const config = { ...TRAFFIC_CFG };
afterEach(() => { Object.assign(TRAFFIC_CFG, config); vi.restoreAllMocks(); });

function seed(value: number) {
  vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  });
}
const ctl: PlayerCtl = {
  desired: () => 215, extraGap: () => Infinity, obeySignal: () => true,
  brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
};
const S0 = 6000, S1 = 7200;
function scene(lanes = 3, closed = [2], length = 16000) {
  const seg = new Seg('test', new Path([{ x: 0, y: 0 }, { x: length, y: 0 }]), lanes, 'motorway');
  const net = Object.assign(Object.create(Network.prototype) as Network, {
    segs: [seg], spawnSegs: [], signals: [], services: [], laybys: [], signs: [],
    stations: [{ id: 'end', name: 'End', x: length + 9000, y: 0, arr: [seg], dep: [] }],
    byId: {},
  });
  net.byId.end = net.stations[0];
  const tr = new Traffic(net, ctl);
  tr.view.r = 50000; tr.localT = Infinity;
  const works = new Roadworks(net);
  const site = closed.length ? works.add(seg, S0, S1, closed)! : null;
  return { seg, net, tr, works, site };
}
function drive(tr: Traffic, type: VType, seg: Seg, s: number, lane: number, v = 200): Veh {
  const veh = tr.add(type, seg, s, lane, v);
  veh.dest = 'end'; tr.reroute(veh);
  return veh;
}
/** run until done; every step asserts nothing has got past a barrier in a closed lane */
function run(tr: Traffic, seg: Seg, closed: number[], seconds: number, done: () => boolean = () => false, each: () => void = () => {}) {
  for (let t = 0; t < seconds && !done(); t += 0.05) {
    tr.update(0.05);
    each();
    for (const v of tr.vs) if (v.seg === seg && !v.dead && closed.includes(v.lane) && v.s > S0 && v.s < S1) throw new Error(`${v.type} ${v.id} is inside the closure at ${v.s}`);
  }
}

describe('roadworks layouts', () => {
  it('blocks every closed lane, warns ahead of them and names the open side', () => {
    const { seg, net, site } = scene(4, [2, 3]);
    expect(site!.open).toEqual([0, 1]);
    expect(site!.dir).toBe(-1);
    expect(site!.sign).toBe('2 right lanes closed · keep left');
    expect(seg.blocks.map(b => b.lane)).toEqual([2, 3]);
    const gantries = net.signs.filter(sg => sg.kind === 'gantry');
    expect(gantries.map(sg => S0 - sg.s)).toEqual([2000, 1000, 300]);
    expect(gantries.every(sg => sg.panels[0].sub === site!.sign && sg.panels[0].arrow === -45)).toBe(true);
  });
  it('sends traffic right past an inner closure', () => {
    const { site } = scene(3, [0]);
    expect(site!.open).toEqual([1, 2]);
    expect(site!.dir).toBe(1);
    expect(site!.sign).toBe('Left lane closed · keep right');
  });
  it.each([
    ['every lane', [0, 1, 2]],
    ['a middle lane', [1]],
    ['a split closure', [0, 2]],
    ['no lanes', []],
  ] as [string, number[]][])('refuses to close %s', (_, lanes) => {
    const { seg, net } = scene(3, []);
    expect(openLanes(net, seg, S0, S1, lanes)).toBeNull();
  });
  it('refuses layouts reaching a lane taper, a section join, a slip road or a signal', () => {
    const { seg, net } = scene(3, []);
    const ok = () => openLanes(net, seg, S0, S1, [2]);
    expect(ok()).toEqual([0, 1]);
    expect(openLanes(net, seg, MERGE_ZONE + 50, MERGE_ZONE + 1000, [2])).toBeNull();
    expect(openLanes(net, seg, MERGE_ZONE + 150, MERGE_ZONE + 1000, [2])).toEqual([0, 1]);
    seg.gain = 1;
    expect(openLanes(net, seg, MERGE_ZONE + TAPER, MERGE_ZONE + TAPER + 1000, [0])).toBeNull();
    seg.gain = 0; seg.drop = 1;
    expect(openLanes(net, seg, seg.len - MERGE_ZONE - 1500, seg.len - MERGE_ZONE - 500, [0])).toBeNull();
    seg.drop = 0;
    expect(openLanes(net, seg, seg.len - 1500, seg.len + 200, [2])).toBeNull();
    expect(openLanes(net, seg, 1000, 2000, [2])).toBeNull();
    seg.aux.push({ side: 1, s0: S0 - 1000, s1: S0 - 400, type: 'exit' });
    expect(ok()).toBeNull();
    // the same slip road is no obstacle to an inner closure: the outer lane it leaves from stays open
    expect(openLanes(net, seg, S0, S1, [0])).toEqual([1, 2]);
    seg.aux.length = 0;
    seg.aux.push({ side: 1, s0: S0 - MERGE_ZONE - 1500, s1: S0 - MERGE_ZONE - 800, type: 'merge' });
    expect(ok()).toBeNull();
    seg.aux.length = 0;
    expect(ok()).toEqual([0, 1]);
  });
  it('does not stack two sites on the same stretch', () => {
    const { seg, works } = scene();
    expect(works.add(seg, S0 + 500, S1 + 500, [0])).toBeNull();
  });
  it.each([1, 2, 3, 4, 5])('places legal sites on the real network, seed %i', value => {
    seed(value);
    const net = new Network(), works = new Roadworks(net);
    works.place();
    expect(works.sites.length).toBe(WORKS_CFG.sites);
    // the sites must not all end up on the empty outer loops, where nobody would meet them
    expect(works.sites.some(s => s.lanes[0] === 0 && s.seg.aux.length > 0)).toBe(true);
    expect(new Set(works.sites.map(s => s.seg.road)).size).toBe(works.sites.length);
    for (const site of works.sites) {
      const { seg } = site;
      expect(site.open.length).toBeGreaterThan(0);
      expect(site.open.length + site.lanes.length).toBe(seg.lanes);
      expect(site.s0 - MERGE_ZONE).toBeGreaterThan(seg.gain ? TAPER : 0);
      expect(site.s1).toBeLessThan(seg.len - (seg.drop ? MERGE_ZONE : 0));
      for (const lane of site.lanes) expect(seg.blocks.some(b => b.lane === lane && b.inc === site)).toBe(true);
    }
  });
});

describe('traffic at roadworks', () => {
  it('never spawns in a closed lane on the approach or inside the works', () => {
    seed(3);
    TRAFFIC_CFG.convoyChance = 0;
    const { seg, tr } = scene(3, [1, 2]);
    for (let s = S0 - MERGE_ZONE + 50; s < S1; s += 300) {
      expect(tr.spawnNPC(seg, s, false, 2, 'mite')).toBeNull();
      expect(tr.spawnNPC(seg, s, false, 1, 'mite')).toBeNull();
      for (let i = 0; i < 8; i++) {
        const v = tr.spawnNPC(seg, s, false, undefined, 'mite');
        if (v) { expect(v.lane).toBe(0); v.dead = true; tr.vs.length = seg.veh.length = 0; }
      }
    }
    expect(tr.spawnNPC(seg, S0 - MERGE_ZONE - 300, false, 2, 'mite')).not.toBeNull();
    expect(tr.spawnNPC(seg, S1 + 300, false, 2, 'mite')).not.toBeNull();
  });
  it('slows traffic on the approach and through the works, then lets it go', () => {
    const { seg, tr } = scene(3, [2]);
    const v = drive(tr, 'sport', seg, S0 - 3000, 0, 300);
    const at = (s: number) => { run(tr, seg, [2], 60, () => v.s >= s); return v.v; };
    expect(at(S0 - MERGE_ZONE - 100)).toBeGreaterThan(250);
    expect(at(S0 - 200)).toBeLessThan(230);
    expect(at(S1 - 100)).toBeLessThan(160);
    expect(at(S1 + 900)).toBeGreaterThan(200);
  });
  it('keeps open-lane traffic out of a lane that is about to close', () => {
    const { seg, tr } = scene(3, [2]);
    const v = drive(tr, 'mite', seg, S0 - MERGE_ZONE + 100, 1);
    expect(tr.safe(v, 2)).toBe(false);
  });
  it.each([[[2], 2], [[1, 2], 2], [[0], 0], [[0, 1], 0]] as [number[], number][])('merges out of closed lanes %j from lane %i before the barrier', (closed, lane) => {
    seed(5);
    const { seg, tr, site } = scene(3, closed);
    const v = drive(tr, 'rig', seg, S0 - MERGE_ZONE - 400, lane);
    let inOpenAt = Infinity;
    run(tr, seg, closed, 40, () => v.s > S1 + 100, () => { if (inOpenAt === Infinity && site!.open.includes(v.lane)) inOpenAt = v.s; });
    expect(inOpenAt).toBeLessThan(S0 - 200);
    expect(v.s).toBeGreaterThan(S1);
  });
  it('holds at the barrier with no gap, then merges and passes once one opens', () => {
    const { seg, tr } = scene(2, [1]);
    const wall = Array.from({ length: 30 }, (_, i) => drive(tr, 'van', seg, S0 + 200 - i * 50, 0, 0));
    for (const w of wall) { w.state = 'held'; w.decideT = Infinity; }
    const v = drive(tr, 'rig', seg, S0 - 1000, 1, 200);
    const behind = drive(tr, 'mite', seg, S0 - 1400, 1, 200);
    run(tr, seg, [1], 30);
    expect(v.lane).toBe(1);
    expect(v.v).toBeLessThan(1);
    expect(v.s).toBeLessThan(S0);
    expect(v.s).toBeGreaterThan(S0 - 40);
    expect(behind.v).toBeLessThan(1);
    expect(behind.s).toBeLessThan(v.s - v.totLen);
    for (const w of wall) w.state = 'drive';
    run(tr, seg, [1], 90, () => v.s > S1 && behind.s > S1);
    expect(v.s).toBeGreaterThan(S1);
    expect(behind.s).toBeGreaterThan(S1);
  });
  it('lets the player step out across a two-lane closure from the far lane', () => {
    const { seg, tr } = scene(3, [1, 2]);
    const p = tr.add('player', seg, S0 - 12, 2, 0);
    expect(tr.stepOut(seg, 2, p.s)).toBe(1);
    expect(tr.stepOut(seg, 1, p.s)).toBe(0);
    expect(tr.stepOut(seg, 0, p.s)).toBeNull();
    expect(tr.safe(p, 1)).toBe(true);
    p.lane = 1; p.lat = seg.laneLat(1);
    expect(tr.safe(p, 2)).toBe(false);
    expect(tr.safe(p, 0)).toBe(true);
  });
  it('stops the player at the barrier rather than letting them through', () => {
    const { seg, tr } = scene(3, [2]);
    const p = tr.add('player', seg, S0 - 700, 2, 200);
    tr.player = p;
    run(tr, seg, [2], 20);
    expect(p.v).toBeLessThan(1);
    expect(p.s).toBeLessThan(S0);
  });
  it.each([11, 12, 13, 14])('builds a queue under load and clears it when arrivals stop, seed %i', value => {
    seed(value);
    TRAFFIC_CFG.convoyChance = 0; TRAFFIC_CFG.maxVehicles = 400;
    const closed = [1, 2];
    const { seg, tr } = scene(3, closed);
    tr.net.spawnSegs = [{ seg, rate: 1, mitesOnly: false }];
    tr.spawnT = [Infinity]; tr.burst = [0];
    let passed = 0, longest = 0, clock = 0;
    const seen = new Set<Veh>();
    const types: VType[] = ['mite', 'van', 'rig', 'bus', 'pod', 'train'];
    const tally = () => {
      const queue = tr.vs.filter(v => !v.dead && v.s < S0 && v.s > S0 - 3000 && v.v < 60).length;
      longest = Math.max(longest, queue);
      for (const v of tr.vs) if (!seen.has(v) && !v.dead && v.s > S1) { seen.add(v); passed++; }
    };
    let spawned = 0;
    // well over what one lane can carry, for a minute and a half
    run(tr, seg, closed, 90, undefined, () => {
      clock += 0.05;
      if (clock >= 0.5) {
        clock = 0;
        const v = tr.spawnNPC(seg, 300, false, undefined, types[Math.floor(Math.random() * types.length)], false, 215);
        if (v) spawned++;
      }
      tally();
    });
    expect(spawned).toBeGreaterThan(120);
    expect(longest).toBeGreaterThan(12);
    expect(passed).toBeGreaterThan(10);
    const left = () => tr.vs.filter(v => !v.dead && v.s < S1).length;
    let last = left(), still = 0;
    run(tr, seg, closed, 900, () => left() === 0, () => {
      tally();
      const n = left();
      still = n < last ? 0 : still + 0.05;
      last = n;
      if (still > 60) throw new Error(`no vehicle passed for a minute with ${n} left`);
    });
    expect(left()).toBe(0);
    expect(passed).toBe(spawned);
  }, 60000);
});

describe('roadworks on the real network', () => {
  it.each([21, 22, 23])('keeps traffic flowing past every site for five minutes, seed %i', value => {
    seed(value);
    const net = new Network(), works = new Roadworks(net);
    works.place();
    const tr = new Traffic(net, ctl);
    const start = net.byId.terra.dep[0];
    tr.player = tr.add('player', start, 140, start.lanes - 1, 0);
    tr.player.state = 'held';
    tr.ctl = { ...ctl, desired: () => 0 };
    tr.view = { x: tr.player.x, y: tr.player.y, r: 1600 };
    tr.populate();
    const stuck = new Map<Veh, number>();
    const through = new Map(works.sites.map(s => [s, 0]));
    const prev = new Map<Veh, number>();
    for (let i = 0; i < 3000; i++) {
      tr.update(0.1);
      for (const v of tr.vs) {
        if (v.dead || v.isPlayer) continue;
        for (const site of works.sites) {
          if (v.seg !== site.seg) continue;
          if (site.lanes.includes(v.lane) && v.s > site.s0 + 1 && v.s < site.s1) throw new Error(`${v.type} inside closure`);
          const was = prev.get(v);
          if (was !== undefined && was < site.s1 && v.s >= site.s1) through.set(site, through.get(site)! + 1);
          if (v.s > site.s0 - MERGE_ZONE && v.s < site.s0 && v.state === 'drive') stuck.set(v, v.v < 2 ? (stuck.get(v) ?? 0) + 0.1 : 0);
        }
        prev.set(v, v.s);
      }
    }
    expect(Math.max(0, ...stuck.values())).toBeLessThan(120);
    expect([...through.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  }, 60000);
});

describe('roadworks and incidents', () => {
  function withIncidents() {
    const s = scene(3, [2]);
    s.tr.player = s.tr.add('player', s.seg, 500, 0, 0);
    const inc = new Incidents(s.net, s.tr, { playerCrashed() {}, playerReleased() {}, bump() {} });
    return { ...s, inc };
  }
  it('reports the works as a hazard with the lanes that are closed', () => {
    const { seg, inc, site } = withIncidents();
    const hz = inc.hazardAhead(seg, S0 - 1500)!;
    expect(hz.inc).toBe(site);
    expect(hz.lanes).toEqual([2]);
    expect(hz.d).toBe(1500);
    expect(inc.hazardAhead(seg, S0 - 2500)).toBeNull();
  });
  it('keeps ordinary incidents off the approach and the works, where they could shut the open lane', () => {
    const { seg, inc } = withIncidents();
    expect(inc.clearStretch(seg, S0 - 500, S0 + 500)).toBe(false);
    expect(inc.clearStretch(seg, S0 - MERGE_ZONE - 400, S0 - MERGE_ZONE + 100)).toBe(false);
    expect(inc.clearStretch(seg, S1 - 100, S1 + 100)).toBe(false);
    expect(inc.clearStretch(seg, S0 - MERGE_ZONE - 900, S0 - MERGE_ZONE - 100)).toBe(true);
    expect(inc.clearStretch(seg, S1 + 400, S1 + 900)).toBe(true);
  });
});
