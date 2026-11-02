import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} } }));
import { WorldScene } from './world';
import { Network } from './network';
import { Traffic, type PlayerCtl } from './traffic';
import { G } from './state';

function worldOnM1() {
  const scene = new WorldScene(), net = new Network();
  const seg = net.roads.find((r) => r.name === 'M1')!.f[1];
  const exit = seg.outs.find((t) => t.label === 'Meridian Bypass')!;
  scene.net = net;
  scene.traffic = new Traffic(net, scene);
  scene.player = scene.traffic.add('player', seg, exit.fromS - 1200, seg.lanes - 1, 150);
  scene.traffic.player = scene.player;
  scene.pstate = 'drive';
  G.job = { from: 'terra', to: 'jove', stage: 'deliver', cls: 0 } as any;
  vi.spyOn(scene as any, 'drawRoute').mockImplementation(() => {});
  return { scene, net, seg, exit };
}
afterEach(() => { G.job = null; vi.restoreAllMocks(); });

describe('live navigation integration', () => {
  it('routes the actual player around a closure and communicates the bypass in guidance', () => {
    const { scene, seg, exit } = worldOnM1();
    const mid = seg.path.nearest(0, 0).s;
    seg.blocks = Array.from({ length: seg.lanes }, (_, lane) => ({ lane, s0: mid - 600, s1: mid + 600, inc: null }));
    scene.computeRoute(false);
    expect(scene.player.route).toContain(exit);
    expect((scene as any).routeDiverted).toBe(true);
    scene.inc = { hazardAhead: () => null } as any;
    expect((scene as any).computeNav().sub).toContain('Diversion');
  });

  it('rechecks on a bounded interval and restores normal routing after the jam clears', () => {
    const { scene, net, seg, exit } = worldOnM1();
    const route = vi.spyOn(net, 'route');
    const mid = seg.path.nearest(0, 0).s;
    seg.blocks = Array.from({ length: seg.lanes }, (_, lane) => ({ lane, s0: mid - 600, s1: mid + 600, inc: null }));
    (scene as any).refreshNavigation(0.02);
    expect(scene.player.route).toContain(exit);
    const first = route.mock.calls.length;
    for (let i = 0; i < 100; i++) (scene as any).refreshNavigation(0.02);
    expect(route.mock.calls.length).toBe(first);
    // Move back from the imminent exit so the driver is not committed to a signposted slip lane.
    scene.player.s = exit.fromS - 3000;
    seg.blocks = [];
    (scene as any).refreshNavigation(5);
    expect(route.mock.calls.length).toBeGreaterThan(first);
    expect(scene.player.route).not.toContain(exit);
    expect((scene as any).routeDiverted).toBe(false);
  });

  it('keeps an imminent indicated diversion stable instead of switching at the slip lane', () => {
    const { scene, seg, exit } = worldOnM1();
    const mid = seg.path.nearest(0, 0).s;
    seg.blocks = Array.from({ length: seg.lanes }, (_, lane) => ({ lane, s0: mid - 600, s1: mid + 600, inc: null }));
    scene.computeRoute(false);
    seg.blocks = [];
    (scene as any).refreshNavigation(5);
    expect(scene.player.route).toContain(exit);
  });

  it('opts NPC routing into live traffic costs and spreads rechecks rather than searching every frame', () => {
    const { scene, net, seg, exit } = worldOnM1();
    const mid = seg.path.nearest(0, 0).s;
    seg.blocks = Array.from({ length: seg.lanes }, (_, lane) => ({ lane, s0: mid - 600, s1: mid + 600, inc: null }));
    const npc = scene.traffic.add('van', seg, exit.fromS - 2400, 0, 100);
    npc.dest = 'jove';
    scene.traffic.reroute(npc);
    expect(npc.route).toContain(exit);
    const route = vi.spyOn(scene.traffic, 'reroute');
    npc.routeRefresh = 0;
    scene.traffic.localT = 1e6;
    scene.traffic.spawnT.fill(1e6);
    scene.traffic.ctl = { desired: () => 150, extraGap: () => Infinity, obeySignal: () => false, brakeMin: () => null, onTrans() {}, onBlocked() {}, onRouteNeeded() {} } satisfies PlayerCtl;
    scene.traffic.update(0.02);
    expect(route).toHaveBeenCalledWith(npc);
    const first = route.mock.calls.length;
    for (let i = 0; i < 50; i++) scene.traffic.update(0.02);
    expect(route.mock.calls.length).toBe(first);
  });
});
