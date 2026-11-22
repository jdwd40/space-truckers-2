import { afterEach, describe, expect, it, vi } from 'vitest';

/** The job board shuffles its destinations; these tests put the destination they want first. */
let firstDest = '';
vi.mock('phaser', () => ({
  default: {
    Events: { EventEmitter: class { emit() {} } }, Scene: class {},
    Utils: { Array: { Shuffle: <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => Number(y.id === firstDest) - Number(x.id === firstDest)) } },
  },
}));
import { WorldScene, STATION_R } from './world';
import { Network, type Station } from './network';
import { Traffic } from './traffic';
import { edgeS } from './render';
import { G, UP } from './state';

const STEP = 0.02;

/**
 * A headless world with the real network, no AI traffic and no incidents, and a loaded starter rig (one small trailer,
 * no upgrades) with a Harbor Prime to Glacier Outpost contract from the job board.
 */
function corridorWorld() {
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
  firstDest = glacier.id;
  const job = scene.makeJobs(harbor)[0];
  job.cls = 0;
  return { scene, net, harbor, glacier, job };
}

/**
 * Drive a contract from `start` (a departure of Harbor Prime) to delivery, holding the posted limit: the driver picks the
 * speed setting for the lowest limit within braking distance ahead, and leaves the rest (docking, pass-throughs) to the rig.
 */
function driveLegally(road: string) {
  const w = corridorWorld(), { scene, harbor, glacier, job } = w;
  const start = harbor.dep.find((seg) => seg.road === road)!;
  scene.acceptJob(job);
  // leave by the chosen road whatever the sat-nav would pick
  scene.depart({ ...harbor, dep: [start] } as Station, glacier.id);
  const p = scene.player, roads: string[] = [];
  let clock = 0, pulled = false, boards = 0;
  const paid = G.money;
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
    if (scene.pstate === 'pulled') pulled = true;
    if (G.mode === 'board') boards++;
    if (p.seg.kind === 'motorway' && roads[roads.length - 1] !== p.seg.road) roads.push(p.seg.road);
  }
  return { ...w, seconds: clock, roads, pulled, boards, docked: scene.station, bonus: G.money - paid - job.pay, fuelUsed: 1 - G.fuel };
}

afterEach(() => { G.job = null; G.mode = 'drive'; G.braking = false; G.speedSet = 0; G.deliveries = 0; UP.cab = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('driving the Harbor Prime–Glacier Outpost corridor at the posted limit', () => {
  it('sends Harbor Prime to Glacier Outpost contracts via Polar Express by default', () => {
    const { scene, harbor, glacier } = corridorWorld();
    scene.depart(harbor, glacier.id);
    expect(scene.player.seg.road).toBe('Polar Express');
    expect(scene.player.route.some((t) => t.kind === 'dock')).toBe(false);
  });

  it('beats the deadline with a legal Polar Express run, which sets it at 1.15 times the run, on well under a tank', () => {
    const run = driveLegally('Polar Express');
    console.log(`legal Polar Express: ${run.seconds.toFixed(1)} s, deadline ${run.job.target.toFixed(1)} s, fuel ${(run.fuelUsed * 100).toFixed(0)}%`);
    expect(run.docked).toBe(run.glacier);
    expect(run.roads).toEqual(['Polar Express']);
    expect(run.pulled).toBe(false);
    expect(run.job.target / (1.15 * run.seconds)).toBeCloseTo(1, 2);
    expect(run.seconds).toBeLessThan(run.job.target);
    expect(run.bonus).toBe(Math.round(run.job.pay * 0.2));
    // a full tank covers Polar Express with a trailer: the road has no fuel stop
    expect(run.fuelUsed).toBeGreaterThan(0.3);
    expect(run.fuelUsed).toBeLessThan(0.6);
  }, 30000);

  it('misses the deadline narrowly with a legal run via Kestrel Station, passing through without the job board', () => {
    const run = driveLegally('Harbor Run');
    console.log(`legal Kestrel route: ${run.seconds.toFixed(1)} s, deadline ${run.job.target.toFixed(1)} s, fuel ${(run.fuelUsed * 100).toFixed(0)}%`);
    expect(run.docked).toBe(run.glacier);
    expect(run.roads).toEqual(['Harbor Run', 'Frost Line']);
    expect(run.pulled).toBe(false);
    // only the delivery at Glacier Outpost opens the board
    expect(run.boards).toBe(1);
    expect(run.seconds).toBeGreaterThan(run.job.target);
    expect(run.seconds).toBeLessThan(run.job.target * 1.1);
    expect(run.bonus).toBe(0);
  }, 30000);
});
