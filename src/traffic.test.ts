import { afterEach, describe, expect, it, vi } from 'vitest';
import { Path } from './geom';
import { Network, Seg } from './network';
import { Traffic, TRAFFIC_CFG, Veh, type PlayerCtl } from './traffic';

vi.mock('./state', () => ({ SPEEDS: [0, 90, 150, 215, 280, 345] }));

const originalConfig = { ...TRAFFIC_CFG };
afterEach(() => { Object.assign(TRAFFIC_CFG, originalConfig); vi.restoreAllMocks(); });

function seed(value = 17) {
  vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  });
}
const ctl: PlayerCtl = {
  desired: () => 345, extraGap: () => Infinity, obeySignal: () => true,
  brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
};
function road(name = 'test', y = 0, kind: 'motorway' | 'avenue' = 'motorway') {
  return new Seg(name, new Path([{ x: 0, y }, { x: 12000, y }]), 3, kind);
}
/** Real routing on a small direct network; no Phaser or route-result mocks. */
function traffic(segs = [road()]) {
  const net = Object.assign(Object.create(Network.prototype) as Network, {
    segs, spawnSegs: [], signals: [], services: [], laybys: [],
    stations: [{ id: 'end', name: 'End', x: 12000, y: 0, arr: segs, dep: [] }],
    byId: {},
  });
  net.byId.end = net.stations[0];
  return new Traffic(net, ctl);
}
function live(tr: Traffic) { return tr.vs.filter(v => !v.dead && !v.isPlayer && !v.incidentResponder); }

describe('traffic mix', () => {
  function sample(kind: 'motorway' | 'avenue', trucky = false) {
    const seg = road('mix', 0, kind);
    seg.trucky = trucky;
    const tr = traffic([seg]);
    TRAFFIC_CFG.convoyChance = 0;
    const fleet: Veh[] = [];
    for (let i = 0; i < 1000; i++) {
      const v = tr.spawnNPC(seg, 1000, false, 0);
      expect(Boolean(v)).toBe(true); // do not hide route failures in mix assertions
      fleet.push(v!);
      tr.vs.length = seg.veh.length = tr.policeN = 0;
    }
    return fleet;
  }
  it('keeps industrial freight and hub passenger distributions distinct', () => {
    seed();
    const hub = sample('motorway');
    const industrial = sample('motorway', true);
    const freight = (v: Veh) => ['rig', 'tanker', 'long', 'train'].includes(v.type);
    const passengers = (v: Veh) => ['bus', 'shuttle'].includes(v.type);
    expect(industrial.filter(freight).length).toBeGreaterThan(650);
    expect(industrial.filter(freight).length).toBeGreaterThan(hub.filter(freight).length + 100);
    expect(hub.filter(passengers).length).toBeGreaterThan(industrial.filter(passengers).length + 80);
    expect(new Set(hub.map(v => v.type)).size).toBe(13);
    expect(new Set(industrial.filter(freight).map(v => v.trailers.length)).size).toBe(2);
  });
  it('puts visible passenger and service fleets on both highways and avenues', () => {
    seed();
    for (const kind of ['motorway', 'avenue'] as const) {
      const fleet = sample(kind);
      const n = (type: string) => fleet.filter(v => v.type === type).length;
      expect(n('tow')).toBeGreaterThanOrEqual(25);
      expect(n('shuttle')).toBeGreaterThanOrEqual(90);
      expect(n('bus')).toBeGreaterThanOrEqual(50);
      expect(new Set(fleet.filter(v => v.type === 'shuttle').map(v => v.variant)).size).toBe(6);
      expect(fleet.find(v => v.type === 'shuttle')!.totLen).toBeGreaterThan(fleet.find(v => v.type === 'pod')!.totLen * 2);
      expect(fleet.find(v => v.type === 'shuttle')!.vDes).toBeLessThan(fleet.find(v => v.type === 'pod')!.vDes);
    }
  });
});

describe('player braking integration', () => {
  it('retains NPC emergency braking and the separate crashed-vehicle deceleration', () => {
    const tr = traffic();
    tr.view.r = 20000;
    const npc = tr.add('mite', tr.net.segs[0], 1000, 0, 200);
    tr.add('bus', tr.net.segs[0], 1080, 0, 0);
    npc.maxBrake = 40;
    const crash = tr.add('player', tr.net.segs[0], 3000, 0, 100);
    crash.maxBrake = 40; crash.state = 'crashed';
    tr.update(0);
    expect(npc.acc).toBe(-700);
    expect(crash.acc).toBe(-430);
  });
  it.each([200, 10])('honours per-vehicle maximum braking at speed %s', speed => {
    const tr = traffic();
    tr.ctl = { ...ctl, desired: () => 0, brakeMin: () => -10000 };
    const v = tr.add('player', tr.net.segs[0], 1000, 0, speed);
    expect(v.maxBrake).toBe(380);
    v.maxBrake = 40;
    tr.update(0);
    expect(v.acc).toBe(-40);
  });
});

describe('safe spawning', () => {
  it('sees vehicles that entered a spawn segment during the current update', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.45);
    TRAFFIC_CFG.convoyChance = 0;
    const a = road('approach'), b = road('departure');
    a.endT = { id: 0, type: 'end', from: a, fromS: a.len, to: b, toS: 25, side: 1, latShift: 0, label: 'departure', kind: 'link', dir: 'S' };
    a.outs.push(a.endT);
    const tr = traffic([a, b]);
    const entering = tr.add('rig', a, a.len - 1, 1, 100);
    tr.net.spawnSegs = [{ seg: b, rate: 1, mitesOnly: false }];
    tr.spawnT = [0]; tr.burst = [0]; tr.localT = 10;
    tr.view = { x: 6000, y: 0, r: 20000 };
    tr.update(0.02);
    expect(entering.seg.name).toBe(b.name);
    const overlapping = tr.vs.filter(v => v !== entering && v.seg === b && v.lane === entering.lane && Math.abs(v.s - entering.s) < 100);
    expect(overlapping).toHaveLength(0);
  });
  it('uses another live lane when the preferred lane is blocked', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const seg = road();
    seg.blocks.push({ lane: 0, s0: 900, s1: 1100, inc: null });
    const tr = traffic([seg]);
    const v = tr.spawnNPC(seg, 1000, false, undefined, 'mite');
    expect(Boolean(v)).toBe(true);
    expect(v!.lane).not.toBe(0);
    expect(v!.goal).not.toBeNull();
  });
  it.each(['unreachable', 'no destinations'] as const)('does not register a ghost vehicle when a route is %s', kind => {
    const tr = traffic();
    if (kind === 'unreachable') tr.net.stations[0].arr = [];
    else tr.net.stations = [];
    const added = vi.fn();
    tr.onAdd = added;
    expect(Boolean(tr.spawnNPC(tr.net.segs[0], 1000, false, 0, 'police'))).toBe(false);
    expect(tr.vs).toHaveLength(0);
    expect(tr.net.segs[0].veh).toHaveLength(0);
    expect(tr.policeN).toBe(0);
    expect(added).not.toHaveBeenCalled();
  });
  it.each(['previous section', 'next section', 'pending merge'] as const)('respects occupancy in a %s', kind => {
    const a = road('a'), b = road('b');
    a.next = b; b.prev = a;
    a.endT = { id: 0, type: 'end', from: a, fromS: a.len, to: b, toS: 0, side: 1, latShift: 0, label: 'b', kind: 'link', dir: 'S' };
    a.outs.push(a.endT);
    const tr = traffic([a, b]);
    let seg = a, s = a.len - 100;
    if (kind === 'next section') tr.add('train', b, 40, 0, 0);
    if (kind === 'previous section') { tr.add('mite', a, a.len - 20, 0, 0); seg = b; s = 100; }
    if (kind === 'pending merge') { const v = tr.add('rig', a, 1000, 1, 0); v.pend = 0; v.sig = -1; s = 1000; }
    expect(Boolean(tr.net.route(seg, s, tr.net.stationGoals(tr.net.stations[0])))).toBe(true);
    expect(Boolean(tr.spawnNPC(seg, s, false, 0, 'train'))).toBe(false);
  });
  it.each(['blocked', 'dropping', 'gaining', 'missing auxiliary', 'out of bounds'] as const)('rejects a forced spawn in a %s position', kind => {
    const seg = road();
    const tr = traffic([seg]);
    let s = 1000, lane = 2;
    if (kind === 'blocked') seg.blocks.push({ lane, s0: 900, s1: 1100, inc: null });
    if (kind === 'dropping') { seg.drop = 1; s = seg.len - 1500; }
    if (kind === 'gaining') { seg.gain = 1; s = 100; }
    if (kind === 'missing auxiliary') lane = seg.lanes;
    if (kind === 'out of bounds') s = -1;
    expect(Boolean(tr.spawnNPC(seg, s, false, lane, 'rig'))).toBe(false);
    expect(tr.vs).toHaveLength(0);
  });
});

describe('traffic continuity', () => {
  it('limits simultaneous expired periodic reroutes to two per update without dropping deferred vehicles', () => {
    seed();
    const tr = traffic();
    tr.localT = Infinity; tr.view.r = 20000;
    const fleet = Array.from({ length: 5 }, (_, i) => {
      const v = tr.add('mite', tr.net.segs[0], 1000 + i * 1000, 0, 0);
      v.dest = 'end'; tr.reroute(v);
      v.routeRefresh = -1; v.decideT = Infinity;
      return v;
    });
    const searches = vi.spyOn(tr.net, 'route'); // observe real graph searches, not mocked results
    for (const remaining of [3, 1, 0]) {
      searches.mockClear();
      tr.update(0.01);
      expect(searches).toHaveBeenCalledTimes(remaining === 0 ? 1 : 2);
      expect(fleet.filter(v => v.routeRefresh <= 0)).toHaveLength(remaining);
      expect(fleet.every(v => v.goal !== null)).toBe(true);
    }
  });
  it('queues at a lane drop until the adjacent lane is safe', () => {
    const tr = traffic();
    const seg = tr.net.segs[0]; seg.drop = 1;
    tr.view.r = 20000;
    const merging = tr.add('rig', seg, seg.len - 1400, 2, 100);
    merging.decideT = 0;
    const blocker = tr.add('bus', seg, merging.s, 1, 0);
    tr.update(0);
    expect(merging.pend).toBe(1);
    expect(merging.pendMand).toBe(true);
    expect(merging.leadGap).toBeLessThan(Infinity);
    merging.pendT = 0;
    tr.update(0);
    expect(merging.lane).toBe(2);
    blocker.dead = true;
    tr.update(0);
    expect(merging.lane).toBe(1);
  });
  it('preserves dock queues and releases only the head vehicle', () => {
    const tr = traffic();
    const seg = tr.net.segs[0];
    tr.addGate(seg, 1200);
    const gate = tr.gates[0]; gate.t = 100;
    const head = tr.add('bus', seg, 1150, 0, 0);
    const tail = tr.add('rig', seg, 900, 0, 0);
    tr.update(0);
    expect(head.stopAt).toBe(1200);
    expect(tail.stopAt).toBe(1200);
    gate.t = 0;
    tr.update(0);
    expect(head.gateDone).toBe(gate);
    expect(head.stopAt).toBeNull();
    expect(tail.stopAt).toBe(1200);
    expect(gate.t).toBeGreaterThan(0);
  });
});

describe('bounded traffic', () => {
  it('spreads a small initial budget along a long section instead of only near its start', () => {
    seed();
    TRAFFIC_CFG.maxVehicles = 12; TRAFFIC_CFG.maxLocals = 0; TRAFFIC_CFG.initialLocals = 0; TRAFFIC_CFG.convoyChance = 0;
    const tr = traffic();
    tr.populate();
    const positions = live(tr).map(v => v.s);
    expect(positions.length).toBeGreaterThan(5);
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(tr.net.segs[0].len * 0.6);
  });
  it('stays bounded through two minutes on the expanded real network', () => {
    seed();
    const tr = new Traffic(new Network(), ctl);
    const seg = tr.net.byId.terra.dep[0];
    tr.player = tr.add('player', seg, 140, seg.lanes - 1, 0);
    tr.view = { x: tr.player.x, y: tr.player.y, r: 1600 };
    let invalidSpawns = 0;
    tr.onAdd = v => { if (v.seg.kind !== 'avenue' && !v.goal) invalidSpawns++; };
    tr.populate();
    for (let i = 0; i < 1200; i++) {
      tr.view.x = tr.player.x; tr.view.y = tr.player.y;
      tr.update(0.1);
      expect(live(tr).length).toBeLessThanOrEqual(TRAFFIC_CFG.maxVehicles);
      expect(live(tr).filter(v => v.local).length).toBeLessThanOrEqual(TRAFFIC_CFG.maxLocals);
      expect(invalidSpawns).toBe(0);
    }
    expect(live(tr).length).toBeGreaterThan(100);
  });
  it.each([false, true])('caps simultaneous ongoing departures with dock burst=%s and automatic convoys', burst => {
    vi.spyOn(Math, 'random').mockReturnValue(0.45);
    TRAFFIC_CFG.maxVehicles = 10; TRAFFIC_CFG.maxLocals = 0; TRAFFIC_CFG.convoyChance = 1;
    const tr = traffic([road('a'), road('b', 100), road('c', 200), road('d', 300)]);
    for (let i = 0; i < 9; i++) tr.add('mite', tr.net.segs[0], 2000 + i * 500, 0, 0);
    tr.net.spawnSegs = tr.net.segs.map(seg => ({ seg, rate: 1, mitesOnly: false }));
    tr.spawnT = [0, 0, 0, 0]; tr.burst = Array(4).fill(burst ? 3 : 0);
    tr.update(0);
    expect(live(tr)).toHaveLength(10);
    expect(live(tr).every(v => v.type === 'mite' || v.goal !== null)).toBe(true);
    if (burst) expect(tr.burst.reduce((sum, n) => sum + n, 0)).toBe(11);
    for (let i = 0; i < 20; i++) { tr.spawnT.fill(0); tr.update(0.12); expect(live(tr).length).toBeLessThanOrEqual(10); }
  });
  it.each(['global', 'local'] as const)('caps automatic convoy followers at the %s limit', budget => {
    vi.spyOn(Math, 'random').mockReturnValue(0.45);
    TRAFFIC_CFG.convoyChance = 1;
    TRAFFIC_CFG.maxVehicles = budget === 'global' ? 3 : 100;
    TRAFFIC_CFG.maxLocals = budget === 'local' ? 3 : 100;
    const tr = traffic();
    for (let i = 0; i < 2; i++) tr.add('mite', tr.net.segs[0], 7000 + i * 500, 0, 0).local = true;
    const lead = tr.spawnNPC(tr.net.segs[0], 4000, true, 1);
    expect(lead?.type).toBe('tanker');
    expect(live(tr)).toHaveLength(3);
    expect(lead?.goal).not.toBeNull();
  });
  it('actually forms a safe matched convoy when capacity is available', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.45);
    TRAFFIC_CFG.convoyChance = 1;
    const tr = traffic();
    const lead = tr.spawnNPC(tr.net.segs[0], 4000, true, 1)!;
    expect(live(tr).length).toBeGreaterThan(1);
    const follower = live(tr).find(v => v !== lead)!;
    expect(follower.type).toBe(lead.type);
    expect(follower.variant).toBe(lead.variant);
    expect(follower.v).toBe(lead.v);
    expect(follower.goal).not.toBeNull();
    expect(lead.s - lead.totLen - follower.s).toBeGreaterThanOrEqual(12);
  });
  it('never prevents explicit player or emergency additions at the ordinary cap', () => {
    TRAFFIC_CFG.maxVehicles = 1;
    const tr = traffic();
    expect(Boolean(tr.spawnNPC(tr.net.segs[0], 1000, true, 0, 'mite'))).toBe(true);
    const player = tr.add('player', tr.net.segs[0], 2000, 0);
    const responder = tr.add('tow', tr.net.segs[0], 3000, 0);
    responder.incidentResponder = true; responder.emergency = true;
    expect(tr.vs.includes(player) && tr.vs.includes(responder)).toBe(true);
    expect(live(tr)).toHaveLength(1);
  });
  it('uses the live ordinary budget rather than a stale total that includes the player and responders', () => {
    seed();
    TRAFFIC_CFG.maxVehicles = 3; TRAFFIC_CFG.maxLocals = 0;
    const tr = traffic();
    const seg = tr.net.segs[0];
    tr.add('mite', seg, 4000, 0, 0);
    tr.add('mite', seg, 5000, 0, 0);
    tr.add('player', seg, 6000, 0, 0);
    const responder = tr.add('tow', seg, 7000, 0, 0);
    responder.incidentResponder = true; responder.emergency = true;
    tr.net.spawnSegs.push({ seg, rate: 1, mitesOnly: false });
    tr.spawnT = [0]; tr.burst = [0]; tr.localT = 10;
    tr.update(0);
    expect(live(tr)).toHaveLength(3);
    expect(tr.vs).toHaveLength(5);
  });
  it('keeps replenishing a busy hub beyond the old target without visible pop-in', () => {
    seed();
    const tr = traffic();
    tr.view = { x: 6000, y: 0, r: 1500 };
    tr.zones = [{ x: 6000, y: 0, r: 10000, w: 1 }];
    for (let i = 0; i < 100; i++) {
      const v = tr.add('mite', tr.net.segs[0], 4500 + Math.floor(i / 3) * 80, i % 3, 0);
      v.local = true;
    }
    const spawnDistances: number[] = [];
    tr.onAdd = v => spawnDistances.push(Math.hypot(v.x - tr.view.x, v.y - tr.view.y));
    for (let i = 0; i < 10; i++) tr.update(0.12);
    expect(live(tr).length).toBeGreaterThan(100);
    expect(spawnDistances.every(d => d >= tr.view.r + 250)).toBe(true);
  });
  it('seeds a visibly busy neighbourhood around the initial player view', () => {
    seed();
    const tr = new Traffic(new Network(), ctl);
    const p = tr.net.byId.terra.dep[0].path.at(140);
    tr.view = { x: p.x, y: p.y, r: 1600 };
    tr.populate();
    const near = live(tr).filter(v => Math.hypot(v.x - p.x, v.y - p.y) < 3500);
    expect(near.length).toBeGreaterThanOrEqual(70);
    expect(live(tr).length).toBeLessThanOrEqual(TRAFFIC_CFG.maxVehicles);
  });
  it('distributes the bounded initial fill across every road instead of exhausting it on the first', () => {
    seed();
    TRAFFIC_CFG.maxVehicles = 90;
    TRAFFIC_CFG.initialLocals = 0;
    TRAFFIC_CFG.convoyChance = 0;
    const tr = new Traffic(new Network(), ctl);
    tr.populate();
    const roads = new Set(live(tr).map(v => v.seg.road));
    expect([...roads].sort()).toEqual(tr.net.roads.map(r => r.name).sort());
  });
  it('reserves capacity for nearby replenishment when background traffic is full', () => {
    seed();
    TRAFFIC_CFG.maxVehicles = 10;
    const tr = traffic();
    for (let i = 0; i < 10; i++) tr.spawnNPC(tr.net.segs[0], 500 + i * 800, false, 0, 'mite');
    expect(live(tr).length).toBeLessThan(10);
    expect(Boolean(tr.spawnNPC(tr.net.segs[0], 1000, true, 1, 'shuttle'))).toBe(true);
  });
  it('enforces the local quota even when the global budget has room', () => {
    const tr = traffic();
    TRAFFIC_CFG.maxLocals = 1;
    expect(tr.spawnNPC(tr.net.segs[0], 1000, true, 0, 'mite')).not.toBeNull();
    expect(tr.spawnNPC(tr.net.segs[0], 2000, true, 0, 'mite')).toBeNull();
    expect(live(tr)).toHaveLength(1);
  });
  it('caps the initial population on the real network', () => {
    seed();
    TRAFFIC_CFG.maxVehicles = 35;
    const tr = new Traffic(new Network(), ctl);
    tr.populate();
    expect(live(tr).length).toBeGreaterThan(0);
    expect(live(tr).length).toBeLessThanOrEqual(35);
  });
});
