import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./test-phaser')).phaserStub);
import type { Seg, Station } from './network';
import { G } from './state';
import { headlessWorld, boardContract, holdLimit, tick } from './test-world';

/** A headless world with the real network and no AI traffic, and a loaded starter rig with a contract from `fromId` to `toId`. */
function world(fromId: string, toId: string) {
  const { scene, net, station: from } = headlessWorld(fromId);
  const to = net.byId[toId], kestrel = net.byId.kestrel;
  const job = boardContract(scene, from, to.id);
  const link = net.roads.find((r) => r.name === 'Kestrel Link')!;
  return { scene, net, from, to, kestrel, job, link };
}

/**
 * Drive a contract at the posted limit, leaving by `road` and passing through Kestrel Station. `toKestrel` steers the
 * sat-nav to Kestrel first (as a driver turning off for it would); `leaveBy` is the Kestrel gate the rig leaves by.
 * The driver takes each exit the sat-nav shows by moving over for it.
 */
function drive(w: ReturnType<typeof world>, road: string | null, opts: { toKestrel?: boolean; leaveBy?: Seg; waypoint?: { x: number; y: number } }) {
  const { scene, net, from, to, kestrel, job } = w;
  scene.acceptJob(job);
  if (road) scene.depart({ ...from, dep: [from.dep.find((seg) => seg.road === road)!] } as Station, to.id);
  if (opts.waypoint) expect(scene.setWaypoint(opts.waypoint.x, opts.waypoint.y)).toBe(true);
  const gate = scene.player.seg;
  const goals = opts.toKestrel ? vi.spyOn(scene as any, 'goals').mockImplementation(() => net.stationGoals(kestrel)) : null;
  if (goals) scene.computeRoute(false);
  if (opts.leaveBy) {
    const depart = scene.depart.bind(scene);
    vi.spyOn(scene, 'depart').mockImplementation((st, id, auto) => depart(st === kestrel ? ({ ...st, dep: [opts.leaveBy!] } as Station) : st, id, auto));
  }
  const p = scene.player, roads: string[] = [];
  let pulled = false, boards = 0, passedThrough = false, dockedBy: Seg | null = null;
  while (G.job && job.elapsed < 600) {
    tick(scene, () => {
      if (scene.station === kestrel && !passedThrough) { passedThrough = true; if (goals) { goals.mockRestore(); } }
      if (scene.pstate === 'drive' && G.mode === 'drive') {
        holdLimit(scene);
        const exit = p.route.find((t) => t.type === 'exit');
        if (exit && exit.from === p.seg && exit.aux && exit.fromS - p.s < 1100 && !scene.armed && p.lane >= 0 && p.lane < p.seg.lanes) scene.armed = exit.aux;
      }
    });
    if (scene.pstate === 'pulled') pulled = true;
    if (G.mode === 'board') { if (!boards) dockedBy = p.seg; boards++; }
    if (p.seg.kind === 'motorway' && roads[roads.length - 1] !== p.seg.road) roads.push(p.seg.road);
  }
  return { seconds: job.elapsed, roads, pulled, boards, passedThrough, docked: scene.station, gate, dockedBy };
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
    expect(run.seconds).toBeGreaterThan(POLAR_LEGAL + 20);
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
    expect(run.seconds).toBeGreaterThan(POLAR_LEGAL + 20);
  }, 30000);

  it('turns left off Polar Express west onto the link and docks at its gate to deliver to Kestrel Station', () => {
    const w = world('glacier', 'kestrel');
    const run = drive(w, 'Polar Express', {});
    expect(run.roads).toEqual(['Polar Express', 'Kestrel Link']);
    expect(run.docked).toBe(w.kestrel);
    expect(run.boards).toBe(1);
  }, 30000);

  it('docks at Kestrel Station through the link\'s own gate when a waypoint on the link leads there from Polar Express', () => {
    const w = world('harbor', 'kestrel');
    const run = drive(w, null, { waypoint: { x: 900, y: -18300 } });
    expect(run.gate.road).toBe('Polar Express');
    expect(run.roads).toEqual(['Polar Express', 'Kestrel Link']);
    expect(run.docked).toBe(w.kestrel);
    expect(run.dockedBy).toBe(w.link.r[0]);
    expect(w.kestrel.arr).toContain(run.dockedBy);
    expect(run.pulled).toBe(false);
  }, 30000);

  it('leaves Kestrel Station by the link\'s own gate when a waypoint is set on the link, and delivers to Harbor Prime by Polar Express', () => {
    const w = world('kestrel', 'harbor');
    // without the waypoint the rig would leave by Harbor Run
    w.scene.acceptJob(w.job);
    expect(w.scene.player.seg.road).toBe('Harbor Run');
    w.scene.station = w.from;
    const run = drive(w, null, { waypoint: { x: 900, y: -17600 } });
    expect(run.gate).toBe(w.link.f[0]);
    expect(w.kestrel.dep).toContain(run.gate);
    expect(run.roads).toEqual(['Kestrel Link', 'Polar Express']);
    expect(run.docked).toBe(w.to);
    expect(run.pulled).toBe(false);
  }, 30000);
});
