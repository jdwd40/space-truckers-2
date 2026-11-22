import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} } }));
import { WorldScene } from './world';
import { Network } from './network';
import { Traffic } from './traffic';
import { G, save } from './state';

/** a headless world with a rig on Harbor Run eastbound, 1 km from its start, hauling Harbor Prime to Glacier Outpost */
function worldOnHarborRun(job: object | null = { from: 'harbor', to: 'glacier', stage: 'deliver', cls: 0 }) {
  vi.stubGlobal('window', {});
  const scene = new WorldScene(), net = new Network();
  const rd = net.roads.find((r) => r.name === 'Harbor Run')!, seg = rd.f[0];
  scene.net = net;
  scene.traffic = new Traffic(net, scene);
  scene.traffic.localT = 1e6; scene.traffic.spawnT.fill(1e6);
  scene.player = scene.traffic.add('player', seg, 1000, 1, 215);
  scene.traffic.player = scene.player;
  scene.pstate = 'drive';
  scene.inc = { hazardAhead: () => null, playerIncident: () => null, laneBlockedAhead: () => false, inSlowZone: () => false } as any;
  scene.favours = { prompt: () => '', onExit() {} } as any;
  G.mode = 'drive'; G.speedSet = 3; G.braking = false; G.fuel = 1;
  G.job = job ? { ...job, elapsed: 0 } as any : null;
  vi.spyOn(scene as any, 'drawRoute').mockImplementation(() => {});
  scene.computeRoute(false);
  const p = scene.player;
  const step = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 0.02) {
      const prevS = p.s, prevSeg = p.seg;
      scene.traffic.update(0.02);
      (scene as any).playerLogic(0.02, prevS, prevSeg);
      if (until?.()) return true;
    }
    return false;
  };
  /** a map point just beside a road's centre line */
  const onRoad = (name: string, f: number) => { const c = net.roads.find((r) => r.name === name)!.c, q = c.at(c.len * f); return { x: q.x + 20, y: q.y + 10 }; };
  return { scene, net, seg, p, step, onRoad };
}
const roadsOn = (scene: WorldScene) => [scene.player.seg.road, ...scene.player.route.map((t) => t.to.road)];
/** the distance from a world point to the player's planned route line */
function routeMiss(scene: WorldScene, at: { x: number; y: number }) {
  const p = scene.player, pts = scene.net.routePoints({ trans: p.route, goal: p.goal! }, p.seg, p.s, 40);
  return Math.min(...pts.map((q) => Math.hypot(q.x - at.x, q.y - at.y)));
}

afterEach(() => { G.job = null; G.mode = 'title'; G.speedSet = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('waypoints in the world', () => {
  it('reroutes the player through a waypoint and then on to the contract goal', () => {
    const { scene, net, onRoad } = worldOnHarborRun();
    expect(roadsOn(scene)).not.toContain('M2');
    const wp = onRoad('M2', 0.12);
    expect(scene.setWaypoint(wp.x, wp.y)).toBe(true);
    expect(scene.waypoint).not.toBeNull();
    expect(roadsOn(scene)).toContain('M2');
    expect(routeMiss(scene, wp)).toBeLessThan(150);
    expect(scene.player.goal!.seg.arrStation).toBe(net.byId.glacier);
  });

  it('clears the waypoint on arrival and then routes normally', () => {
    const { scene, net, seg, p, step } = worldOnHarborRun();
    const normal = scene.player.route.slice();
    const q = seg.path.at(1900);
    scene.setWaypoint(q.x, q.y);
    expect(scene.waypoint).not.toBeNull();
    expect(step(30, () => !scene.waypoint)).toBe(true);
    expect(p.seg).toBe(seg);
    expect(p.s).toBeGreaterThan(1800);
    expect(p.s).toBeLessThan(2200);
    expect(p.route).toEqual(normal);
    expect(p.goal!.seg.arrStation).toBe(net.byId.glacier);
  });

  it('without a contract, routes to the waypoint and has no route once it is reached', () => {
    const { scene, seg, p, step } = worldOnHarborRun(null);
    expect(p.goal).toBeNull();
    const q = seg.path.at(1900);
    scene.setWaypoint(q.x, q.y);
    expect(p.goal!.seg).toBe(seg);
    expect(p.goal!.s).toBeCloseTo(1900, -1);
    expect(step(30, () => !scene.waypoint)).toBe(true);
    expect(p.goal).toBeNull();
    expect(p.route).toEqual([]);
  });

  it('can be moved and removed before it is reached', () => {
    const { scene, onRoad } = worldOnHarborRun();
    const normal = roadsOn(scene);
    const a = onRoad('M2', 0.12);
    scene.setWaypoint(a.x, a.y);
    expect(roadsOn(scene)).toContain('M2');
    // moving it: the route now passes the new place and not the old one
    const b = onRoad('Polar Express', 0.5);
    expect(scene.setWaypoint(b.x, b.y)).toBe(true);
    expect(roadsOn(scene)).toContain('Polar Express');
    expect(roadsOn(scene)).not.toContain('M2');
    expect(routeMiss(scene, b)).toBeLessThan(150);
    // the pin is on the carriageway the route passes it on
    expect(routeMiss(scene, scene.waypoint!)).toBeLessThan(25);
    scene.clearWaypoint();
    expect(scene.waypoint).toBeNull();
    expect(roadsOn(scene)).toEqual(normal);
  });

  it('refuses a waypoint away from any road, keeping the one it has', () => {
    const { scene, onRoad } = worldOnHarborRun();
    const a = onRoad('M2', 0.12);
    scene.setWaypoint(a.x, a.y);
    const kept = scene.waypoint;
    expect(scene.setWaypoint(-8000, -8000)).toBe(false);
    expect(scene.waypoint).toBe(kept);
  });

  it('is not written to the save', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const { scene, onRoad } = worldOnHarborRun();
    save();
    const before = [...store.entries()];
    const a = onRoad('M2', 0.12);
    scene.setWaypoint(a.x, a.y);
    save();
    expect([...store.entries()]).toEqual(before);
    expect([...store.values()].join()).not.toMatch(/waypoint|via/i);
  });

  it('routes a low-fuel detour straight to the pumps and keeps the waypoint for afterwards', () => {
    const { scene, net, onRoad } = worldOnHarborRun();
    const a = onRoad('M2', 0.12);
    scene.setWaypoint(a.x, a.y);
    const sv = net.services.find((s) => s.name === 'Harbor Pumps')!;
    (scene as any).fuelTarget = sv;
    scene.computeRoute(false);
    expect(scene.player.goal).toEqual({ seg: sv.seg, s: sv.pumpS });
    expect(scene.waypoint).not.toBeNull();
  });

  it('leaves a pass-through station by the gate that leads through the waypoint', () => {
    const { scene, net, p, onRoad } = worldOnHarborRun();
    scene.depart(net.byId.kestrel, 'glacier', true);
    expect(p.seg.road).toBe('Frost Line');
    const a = onRoad('M2', 0.12);
    scene.setWaypoint(a.x, a.y);
    scene.depart(net.byId.kestrel, 'glacier', true);
    expect(p.seg.road).toBe('M2');
    expect(routeMiss(scene, scene.waypoint!)).toBeLessThan(150);
  });

  it('replaces a route picked from the comparison, and is replaced by one', () => {
    const { scene, onRoad } = worldOnHarborRun();
    scene.pickRoute(0);
    expect(scene.routeChoice).not.toBeNull();
    const a = onRoad('M2', 0.12);
    scene.setWaypoint(a.x, a.y);
    expect(scene.routeChoice).toBeNull();
    expect(roadsOn(scene)).toContain('M2');
    scene.pickRoute(0);
    expect(scene.routeChoice).not.toBeNull();
    expect(scene.waypoint).toBeNull();
    expect(roadsOn(scene)).not.toContain('M2');
  });

  it('at the station gate, moves the rig to the departure that leads through the waypoint, and back when it is removed', () => {
    const { scene, net, p, onRoad } = worldOnHarborRun();
    scene.depart(net.byId.harbor, 'glacier');
    const fastest = p.seg;
    const a = onRoad('Frost Line', 0.4);
    scene.setWaypoint(a.x, a.y);
    // Harbor Run, a pass-through at Kestrel, then Frost Line: no doubling back along Frost Line from Glacier's end
    expect(p.seg.road).toBe('Harbor Run');
    expect(p.route.some((t) => t.kind === 'dock' && t.from.arrStation === net.byId.kestrel)).toBe(true);
    expect(routeMiss(scene, scene.waypoint!)).toBeLessThan(25);
    scene.clearWaypoint();
    expect(p.seg).toBe(fastest);
  });
});
