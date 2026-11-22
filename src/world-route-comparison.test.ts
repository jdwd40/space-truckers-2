import { afterEach, describe, expect, it, vi } from 'vitest';

/** The job board shuffles its destinations; these tests put Glacier Outpost first. */
vi.mock('phaser', () => ({
  default: {
    Events: { EventEmitter: class { emit() {} } }, Scene: class {},
    Utils: { Array: { Shuffle: <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => Number(y.id === 'glacier') - Number(x.id === 'glacier')) } },
  },
}));
import { WorldScene, STATION_R } from './world';
import { Network } from './network';
import { Traffic } from './traffic';
import { edgeS } from './render';
import { G, UP } from './state';

const STEP = 0.02;

/** a headless world with no AI traffic or incidents, and a starter rig at Harbor Prime that has accepted a Glacier Outpost contract */
function contractWorld() {
  vi.stubGlobal('window', {});
  vi.spyOn(Math, 'random').mockReturnValue(0.99); // no remote pickups on the board
  const scene = new WorldScene(), net = new Network();
  scene.net = net;
  scene.traffic = new Traffic(net, scene);
  scene.traffic.localT = Infinity; scene.traffic.spawnT.fill(Infinity);
  scene.inc = { update() {}, hazardAhead: () => null, playerIncident: () => null, laneBlockedAhead: () => false, inSlowZone: () => false } as any;
  (scene as any).favours = { onExit() {}, onDocked() {}, prompt: () => '' };
  vi.spyOn(scene as any, 'drawRoute').mockImplementation(() => {});
  vi.spyOn(scene as any, 'buildUnits').mockImplementation(() => {});
  for (const st of net.stations) for (const seg of st.arr) scene.dockS.set(seg, edgeS(seg, st, STATION_R, true) - 70);
  const harbor = net.byId.harbor, glacier = net.byId.glacier;
  scene.player = scene.traffic.add('player', harbor.dep[0], 150, harbor.dep[0].lanes - 1, 0);
  scene.traffic.player = scene.player;
  scene.player.gfx = {};
  scene.baseAMax = scene.player.aMax;
  scene.station = harbor;
  (scene as any).computeCosts();
  G.deliveries = 1; G.earned = 0; G.money = 0; G.fuel = 1; G.pax = 0;
  const job = scene.makeJobs(harbor)[0];
  job.cls = 0;
  scene.acceptJob(job);
  return { scene, net, harbor, glacier, job };
}

/** drive at the posted limit until the contract is delivered, recording the roads driven */
function driveToDelivery(scene: WorldScene) {
  const p = scene.player, roads: string[] = [];
  let clock = 0;
  while (G.job && clock < 600) {
    for (const q of scene.pending) q.t -= STEP;
    const due = scene.pending.filter((q) => q.t <= 0);
    if (due.length) { scene.pending = scene.pending.filter((q) => q.t > 0); for (const q of due) q.fn(); }
    if (scene.pstate === 'drive' && G.mode === 'drive') {
      const ahead = scene.net.place(p.seg, p.s + 450);
      G.braking = false;
      G.speedSet = Math.min(p.seg.limitAt(p.s), ahead.seg.limitAt(ahead.s));
    }
    const prevS = p.s, prevSeg = p.seg;
    scene.traffic.update(STEP);
    if (G.job && G.mode === 'drive') { G.job.elapsed += STEP; clock = G.job.elapsed; }
    (scene as any).playerLogic(STEP, prevS, prevSeg);
    if (p.seg.kind === 'motorway' && roads[roads.length - 1] !== p.seg.road) roads.push(p.seg.road);
  }
  return roads;
}

afterEach(() => { G.job = null; G.mode = 'drive'; G.braking = false; G.speedSet = 0; G.deliveries = 0; UP.cab = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('route comparison in the headless world', () => {
  it('compares Polar Express with the Kestrel route against the contract deadline from the Harbor Prime gate', () => {
    const { scene, job } = contractWorld();
    const cmp = scene.routeComparison()!;
    expect(cmp.deadline).toBe(job.target);
    expect(cmp.options.map((o) => o.name)).toEqual(['Polar Express', 'Via Kestrel Station']);
    const [polar, kestrel] = cmp.options;
    // the legal arrival times: Polar is faster, and the deadline allows both an incident ahead
    expect(polar.eta).toBeGreaterThan(110); expect(polar.eta).toBeLessThan(118);
    expect(kestrel.eta).toBeGreaterThan(131); expect(kestrel.eta).toBeLessThan(139);
    expect(cmp.deadline).toBeCloseTo(171.3, 0);
    expect(polar.eta).toBeLessThan(cmp.deadline - 50);
    expect([polar.cameras.length, kestrel.cameras.length]).toEqual([2, 1]);
    expect(kestrel.facilities.map((f) => f.name)).toEqual(['Harbor Pumps', 'Frost Fuel']);
    expect(cmp.picked).toBe(-1);
  });

  it('follows the picked Kestrel route through the pass-through to delivery, then drops the choice', () => {
    const { scene, glacier } = contractWorld();
    expect(scene.player.seg.road).toBe('Polar Express');
    scene.pickRoute(1);
    expect(scene.routeComparison()!.picked).toBe(1);
    // the rig moves to the Harbor Run gate and the sat-nav leads it round by Kestrel Station
    expect(scene.player.seg.road).toBe('Harbor Run');
    expect(scene.player.route.some((t) => t.kind === 'dock')).toBe(true);
    // rerouting on the way keeps to the choice
    scene.computeRoute(false);
    expect(scene.player.route.map((t) => t.to.road)).not.toContain('Polar Express');
    const roads = driveToDelivery(scene);
    expect(roads).toEqual(['Harbor Run', 'Frost Line']);
    expect(scene.station).toBe(glacier);
    expect(scene.routeChoice).toBeNull();
  }, 30000);

  it('keeps the choice through a pass-through: leaving Kestrel Station never heads for Polar Express', () => {
    const { scene, net, glacier } = contractWorld();
    scene.pickRoute(1);
    const kestrel = net.byId.kestrel;
    scene.depart(kestrel, glacier.id, true);
    expect(scene.routeChoice).not.toBeNull();
    expect([scene.player.seg.road, ...scene.player.route.map((t) => t.to.road)]).not.toContain('Polar Express');
  });

  it('drops the choice when it is cancelled, going back to the fastest route', () => {
    const { scene, net, glacier } = contractWorld();
    scene.pickRoute(1);
    scene.clearRouteChoice();
    expect(scene.routeChoice).toBeNull();
    expect(scene.routeComparison()!.picked).toBe(-1);
    // still at the gate: cancelling puts the rig back on the fastest departure
    expect(scene.player.seg.road).toBe('Polar Express');
    const fastest = net.route(scene.player.seg, scene.player.s, net.stationGoals(glacier), 0, true)!;
    expect(scene.player.route).toEqual(fastest.trans);
  });

  it('keeps to Polar Express when the fastest route is picked', () => {
    const { scene } = contractWorld();
    scene.pickRoute(0);
    expect(scene.routeComparison()!.picked).toBe(0);
    expect(scene.player.seg.road).toBe('Polar Express');
    expect(scene.player.route.some((t) => t.kind === 'dock')).toBe(false);
  });

  it('has nothing to compare without a contract', () => {
    const { scene } = contractWorld();
    G.job = null;
    expect(scene.routeComparison()).toBeNull();
    scene.pickRoute(1);
    expect(scene.routeChoice).toBeNull();
  });
});
