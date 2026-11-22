import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./test-phaser')).phaserStub);
import type { Station } from './network';
import { G, UP } from './state';
import { headlessWorld, boardContract, holdLimit, tick } from './test-world';

/** a headless world with a loaded starter rig at Harbor Prime and a Glacier Outpost contract from the job board */
function corridorWorld() {
  const { scene, net, station: harbor } = headlessWorld('harbor');
  const glacier = net.byId.glacier;
  const job = boardContract(scene, harbor, glacier.id);
  return { scene, net, harbor, glacier, job };
}

/**
 * Drive a contract from `start` (a departure of Harbor Prime) to delivery, holding the posted limit, and leave the rest
 * (docking, pass-throughs) to the rig.
 */
function driveLegally(road: string) {
  const w = corridorWorld(), { scene, harbor, glacier, job } = w;
  const start = harbor.dep.find((seg) => seg.road === road)!;
  scene.acceptJob(job);
  // leave by the chosen road whatever the sat-nav would pick
  scene.depart({ ...harbor, dep: [start] } as Station, glacier.id);
  const p = scene.player, roads: string[] = [];
  let pulled = false, boards = 0;
  const paid = G.money;
  while (G.job && job.elapsed < 600) {
    tick(scene, () => { if (scene.pstate === 'drive' && G.mode === 'drive') holdLimit(scene); });
    if (scene.pstate === 'pulled') pulled = true;
    if (G.mode === 'board') boards++;
    if (p.seg.kind === 'motorway' && roads[roads.length - 1] !== p.seg.road) roads.push(p.seg.road);
  }
  return { ...w, seconds: job.elapsed, roads, pulled, boards, docked: scene.station, bonus: G.money - paid - job.pay, fuelUsed: 1 - G.fuel };
}

afterEach(() => { G.job = null; G.mode = 'drive'; G.braking = false; G.speedSet = 0; G.deliveries = 0; UP.cab = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('driving the Harbor Prime–Glacier Outpost corridor at the posted limit', () => {
  it('sends Harbor Prime to Glacier Outpost contracts via Polar Express by default', () => {
    const { scene, harbor, glacier } = corridorWorld();
    scene.depart(harbor, glacier.id);
    expect(scene.player.seg.road).toBe('Polar Express');
    expect(scene.player.route.some((t) => t.kind === 'dock')).toBe(false);
  });

  it('beats the deadline comfortably with a legal clear-road Polar Express run, on well under a tank', () => {
    const run = driveLegally('Polar Express');
    console.log(`legal Polar Express: ${run.seconds.toFixed(1)} s, deadline ${run.job.target.toFixed(1)} s, fuel ${(run.fuelUsed * 100).toFixed(0)}%`);
    expect(run.docked).toBe(run.glacier);
    expect(run.roads).toEqual(['Polar Express']);
    expect(run.pulled).toBe(false);
    // the deadline is 1.15 times this run plus 40 s for incidents ahead, so a clear road leaves about 57 s to spare
    expect(run.job.target - 1.15 * run.seconds).toBeCloseTo(40, 0);
    expect(run.seconds).toBeLessThan(run.job.target - 50);
    expect(run.bonus).toBe(Math.round(run.job.pay * 0.2));
    // a full tank covers Polar Express with a trailer: the road has no fuel stop
    expect(run.fuelUsed).toBeGreaterThan(0.3);
    expect(run.fuelUsed).toBeLessThan(0.6);
  }, 30000);

  it('is slower than Polar Express with a legal run via Kestrel Station, passing through without the job board', () => {
    const run = driveLegally('Harbor Run');
    console.log(`legal Kestrel route: ${run.seconds.toFixed(1)} s, deadline ${run.job.target.toFixed(1)} s, fuel ${(run.fuelUsed * 100).toFixed(0)}%`);
    expect(run.docked).toBe(run.glacier);
    expect(run.roads).toEqual(['Harbor Run', 'Frost Line']);
    expect(run.pulled).toBe(false);
    // only the delivery at Glacier Outpost opens the board
    expect(run.boards).toBe(1);
    // a legal Polar Express run takes about 114 s (above); on a clear road the Kestrel route still makes the deadline
    expect(run.seconds).toBeGreaterThan(130);
    expect(run.seconds).toBeLessThan(run.job.target);
  }, 30000);
});
