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
import { Network, type Seg, type Station } from './network';
import { Traffic } from './traffic';
import { edgeS } from './render';
import { G } from './state';

const STEP = 0.02;

/** A headless world with the real network and no AI traffic, and a loaded starter rig with a contract from `fromId` to `toId`. */
function world(fromId: string, toId: string) {
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
  const from = net.byId[fromId], to = net.byId[toId], kestrel = net.byId.kestrel;
  scene.player = scene.traffic.add('player', from.dep[0], 150, from.dep[0].lanes - 1, 0);
  scene.traffic.player = scene.player;
  scene.player.gfx = {};
  scene.baseAMax = scene.player.aMax;
  scene.station = from;
  (scene as any).computeCosts();
  G.deliveries = 1; G.earned = 0; G.money = 0; G.fuel = 1; G.pax = 0;
  firstDest = to.id;
  const job = scene.makeJobs(from)[0];
  job.cls = 0;
  const link = net.roads.find((r) => r.name === 'Kestrel Link')!;
  return { scene, net, from, to, kestrel, job, link };
}

/**
 * Drive a contract at the posted limit, leaving by `road` and passing through Kestrel Station. `toKestrel` steers the
 * sat-nav to Kestrel first (as a driver turning off for it would); `leaveBy` is the Kestrel gate the rig leaves by.
 * The driver takes each exit the sat-nav shows by moving over for it.
 */
function drive(w: ReturnType<typeof world>, road: string, opts: { toKestrel?: boolean; leaveBy?: Seg }) {
  const { scene, net, from, to, kestrel, job } = w;
  scene.acceptJob(job);
  scene.depart({ ...from, dep: [from.dep.find((seg) => seg.road === road)!] } as Station, to.id);
  const goals = opts.toKestrel ? vi.spyOn(scene as any, 'goals').mockImplementation(() => net.stationGoals(kestrel)) : null;
  if (goals) scene.computeRoute(false);
  if (opts.leaveBy) {
    const depart = scene.depart.bind(scene);
    vi.spyOn(scene, 'depart').mockImplementation((st, id, auto) => depart(st === kestrel ? ({ ...st, dep: [opts.leaveBy!] } as Station) : st, id, auto));
  }
  const p = scene.player, roads: string[] = [];
  let clock = 0, pulled = false, boards = 0, passedThrough = false;
  while (G.job && clock < 600) {
    for (const q of scene.pending) q.t -= STEP;
    const due = scene.pending.filter((q) => q.t <= 0);
    if (due.length) { scene.pending = scene.pending.filter((q) => q.t > 0); for (const q of due) q.fn(); }
    if (scene.station === kestrel && !passedThrough) { passedThrough = true; if (goals) { goals.mockRestore(); } }
    if (scene.pstate === 'drive' && G.mode === 'drive') {
      const ahead = scene.net.place(p.seg, p.s + 450);
      G.braking = false;
      G.speedSet = Math.min(p.seg.limitAt(p.s), ahead.seg.limitAt(ahead.s));
      const exit = p.route.find((t) => t.type === 'exit');
      if (exit && exit.from === p.seg && exit.aux && exit.fromS - p.s < 1100 && !scene.armed && p.lane >= 0 && p.lane < p.seg.lanes) scene.armed = exit.aux;
    }
    const prevS = p.s, prevSeg = p.seg;
    scene.traffic.update(STEP);
    if (G.job && G.mode === 'drive') { G.job.elapsed += STEP; clock = G.job.elapsed; }
    (scene as any).playerLogic(STEP, prevS, prevSeg);
    if (scene.pstate === 'pulled') pulled = true;
    if (G.mode === 'board') boards++;
    if (p.seg.kind === 'motorway' && roads[roads.length - 1] !== p.seg.road) roads.push(p.seg.road);
  }
  return { seconds: clock, roads, pulled, boards, passedThrough, docked: scene.station };
}

afterEach(() => { G.job = null; G.mode = 'drive'; G.braking = false; G.speedSet = 0; G.deliveries = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** The legal Polar Express time measured in corridor-drive.test.ts, in seconds. */
const POLAR_LEGAL = 114.1;

describe('driving between the routes by Kestrel Link', () => {
  it('drives Harbor Prime → Polar Express → Kestrel Link → Kestrel Station → Frost Line → Glacier Outpost, slower than Polar', () => {
    const w = world('harbor', 'glacier');
    const run = drive(w, 'Polar Express', { toKestrel: true });
    console.log(`Polar Express then Kestrel Link: ${run.seconds.toFixed(1)} s, deadline ${w.job.target.toFixed(1)} s`);
    expect(run.roads).toEqual(['Polar Express', 'Kestrel Link', 'Frost Line']);
    expect(run.passedThrough).toBe(true);
    expect(run.docked).toBe(w.to);
    expect(run.pulled).toBe(false);
    // the pass-through sends the rig on by itself: only the delivery opens the job board
    expect(run.boards).toBe(1);
    expect(run.seconds).toBeGreaterThan(POLAR_LEGAL);
    expect(run.seconds).toBeGreaterThan(w.job.target);
  }, 30000);

  it('drives the reverse: Glacier Outpost → Frost Line → Kestrel Station → Kestrel Link → Polar Express → Harbor Prime', () => {
    const w = world('glacier', 'harbor');
    const run = drive(w, 'Frost Line', { leaveBy: w.link.f[0] });
    console.log(`Kestrel Link then Polar Express: ${run.seconds.toFixed(1)} s, deadline ${w.job.target.toFixed(1)} s`);
    expect(run.roads).toEqual(['Frost Line', 'Kestrel Link', 'Polar Express']);
    expect(run.passedThrough).toBe(true);
    expect(run.docked).toBe(w.to);
    expect(run.pulled).toBe(false);
    expect(run.boards).toBe(1);
    expect(run.seconds).toBeGreaterThan(POLAR_LEGAL);
    expect(run.seconds).toBeGreaterThan(w.job.target);
  }, 30000);

  it('turns left off Polar Express west onto the link and docks at its gate to deliver to Kestrel Station', () => {
    const w = world('glacier', 'kestrel');
    const run = drive(w, 'Polar Express', {});
    expect(run.roads).toEqual(['Polar Express', 'Kestrel Link']);
    expect(run.docked).toBe(w.kestrel);
    expect(run.boards).toBe(1);
  }, 30000);
});
