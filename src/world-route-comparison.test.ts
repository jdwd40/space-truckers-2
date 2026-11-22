import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./test-phaser')).phaserStub);
import type { WorldScene } from './world';
import { G, UP } from './state';
import { headlessWorld, boardContract, holdLimit, tick } from './test-world';

/** a headless world with no AI traffic or incidents, and a starter rig at Harbor Prime that has accepted a Glacier Outpost contract */
function contractWorld() {
  const { scene, net, station: harbor } = headlessWorld('harbor');
  const glacier = net.byId.glacier;
  const job = boardContract(scene, harbor, glacier.id);
  scene.acceptJob(job);
  return { scene, net, harbor, glacier, job };
}

/** drive at the posted limit until the contract is delivered, recording the roads driven */
function driveToDelivery(scene: WorldScene) {
  const p = scene.player, roads: string[] = [], job = G.job!;
  while (G.job && job.elapsed < 600) {
    tick(scene, () => { if (scene.pstate === 'drive' && G.mode === 'drive') holdLimit(scene); });
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
