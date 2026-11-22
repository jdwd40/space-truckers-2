import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} } }));
import { WorldScene } from './world';
import { Network } from './network';
import { Traffic } from './traffic';
import { G } from './state';

/** a headless world with the rig driving on M1 among real traffic, on a screen of the given size */
function drivingWorld(width = 1280, height = 720) {
  const scene = new WorldScene(), net = new Network();
  const seg = net.roads.find((r) => r.name === 'M1')!.f[1];
  scene.net = net;
  scene.traffic = new Traffic(net, scene);
  scene.player = scene.traffic.add('player', seg, 3000, seg.lanes - 1, 250);
  scene.traffic.player = scene.player;
  for (let i = 0; i < 6; i++) scene.traffic.add('van', seg, 3400 + i * 300, i % seg.lanes, 200);
  scene.pstate = 'drive';
  const cam = { width, height, zoom: 0.9, rotation: 1.2, midPoint: { x: scene.player.x, y: scene.player.y } };
  (scene as any).cameras = { main: cam };
  (scene as any).scale = { width, height };
  G.mode = 'drive';
  G.job = { from: 'terra', to: 'jove', stage: 'deliver', cls: 0, elapsed: 12.5 } as any;
  scene.after(3, () => {});
  return { scene, net, cam };
}

/** everything the simulation and camera move */
function snapshot(scene: WorldScene, cam: { zoom: number; rotation: number; midPoint: { x: number; y: number } }) {
  return {
    vehicles: scene.traffic.vs.map((v) => ({ seg: v.seg.id, s: v.s, v: v.v, lane: v.lane, lat: v.lat })),
    elapsed: G.job!.elapsed, fuel: G.fuel, clk: scene.clk, acc: scene.acc,
    pending: scene.pending.map((q) => q.t), pstate: scene.pstate,
    cam: { zoom: cam.zoom, rotation: cam.rotation, mid: { ...cam.midPoint } },
  };
}

afterEach(() => { G.paused = false; G.job = null; G.mode = 'title'; vi.restoreAllMocks(); });

describe('sector map in the headless world', () => {
  it('pauses the simulation and camera while open and resumes exactly where it was on close', () => {
    const { scene, cam } = drivingWorld();
    const before = snapshot(scene, cam);
    expect(scene.openSectorMap()).toBe(true);
    expect(scene.sectorOpen).toBe(true);
    expect(G.paused).toBe(true);
    for (let i = 0; i < 120; i++) scene.update(i * 16, 16);
    expect(snapshot(scene, cam)).toEqual(before);
    scene.closeSectorMap();
    expect(scene.sectorOpen).toBe(false);
    expect(G.paused).toBe(false);
    expect(snapshot(scene, cam)).toEqual(before);
  });

  it('toggles open and closed', () => {
    const { scene } = drivingWorld();
    scene.toggleSectorMap();
    expect(scene.sectorOpen).toBe(true);
    scene.toggleSectorMap();
    expect(scene.sectorOpen).toBe(false);
    expect(G.paused).toBe(false);
  });

  it('does not open over the pause menu, the job board or the title, so closing never unpauses them', () => {
    const { scene } = drivingWorld();
    G.paused = true;
    expect(scene.openSectorMap()).toBe(false);
    scene.closeSectorMap();
    expect(G.paused).toBe(true);
    G.paused = false;
    for (const mode of ['board', 'title'] as const) {
      G.mode = mode;
      expect(scene.openSectorMap()).toBe(false);
      expect(scene.sectorOpen).toBe(false);
    }
  });

  it.each([[1280, 720], [390, 844]])('first opens on the whole network at %sx%s, every station on screen', (width, height) => {
    const { scene, net } = drivingWorld(width, height);
    scene.openSectorMap();
    const view = scene.sectorView!;
    for (const st of net.stations) {
      const q = view.toScreen(st.x, st.y, width, height);
      expect(q.x, st.name).toBeGreaterThan(0); expect(q.x, st.name).toBeLessThan(width);
      expect(q.y, st.name).toBeGreaterThan(0); expect(q.y, st.name).toBeLessThan(height);
    }
  });

  it('fits the network below the map chrome along the top of the screen', () => {
    const { scene, net, cam } = drivingWorld(1280, 720);
    const shown: unknown[] = [];
    scene.sectorMap = { insetTop: 90, show: (v: unknown) => shown.push(v), hide() {} } as any;
    scene.openSectorMap();
    expect(shown).toEqual([scene.sectorView]);
    for (const st of net.stations) {
      const q = scene.sectorView!.toScreen(st.x, st.y);
      expect(q.y - 20, st.name).toBeGreaterThan(90); expect(q.y, st.name).toBeLessThan(cam.height);
    }
    // and the furthest road north too
    const top = Math.min(...net.segs.map((seg) => seg.path.minY));
    expect(scene.sectorView!.toScreen(0, top).y).toBeGreaterThan(90);
  });

  it('zooms about the pointer and keeps the pan and zoom for the rest of the session', () => {
    const { scene, net } = drivingWorld();
    scene.openSectorMap();
    const view = scene.sectorView!;
    const harbor = net.byId.harbor;
    const at = view.toScreen(harbor.x, harbor.y, 1280, 720);
    const z0 = view.zoom;
    view.zoomAt(at.x, at.y, 4, 1280, 720);
    expect(view.zoom).toBeCloseTo(z0 * 4, 9);
    // the point under the pointer stays under it
    const still = view.toScreen(harbor.x, harbor.y, 1280, 720);
    expect(still.x).toBeCloseTo(at.x, 6); expect(still.y).toBeCloseTo(at.y, 6);
    view.pan(120, -40);
    const kept = { cx: view.cx, cy: view.cy, zoom: view.zoom };
    scene.closeSectorMap();
    scene.openSectorMap();
    expect(scene.sectorView).toBe(view);
    expect({ cx: view.cx, cy: view.cy, zoom: view.zoom }).toEqual(kept);
  });

  it('cannot be panned or zoomed off the network', () => {
    const { scene, net } = drivingWorld(390, 844);
    scene.openSectorMap();
    const view = scene.sectorView!, b = net.bounds();
    view.pan(1e7, 1e7);
    expect(view.cx).toBeGreaterThanOrEqual(b.x0); expect(view.cx).toBeLessThanOrEqual(b.x1);
    expect(view.cy).toBeGreaterThanOrEqual(b.y0); expect(view.cy).toBeLessThanOrEqual(b.y1);
    const fit = view.minZoom;
    view.zoomAt(195, 422, 1e-6, 390, 844);
    expect(view.zoom).toBeCloseTo(fit, 9);
    view.zoomAt(195, 422, 1e6, 390, 844);
    // close up a lane (32 world units) is still several pixels wide
    expect(view.zoom * 32).toBeGreaterThan(8);
    expect(view.zoom).toBeLessThan(5);
  });
});
