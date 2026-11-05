import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} },
}));

import { WorldScene } from './world';
import { Traffic, Veh, type PlayerCtl } from './traffic';
import { G } from './state';
import { Network, type Seg } from './network';
import { Incidents, type Incident } from './incidents';

function cameraScene(width = 1280, height = 720, heading = 0) {
  const scene = new WorldScene();
  const seg = { lanes: 3, laneLat: () => 0, path: { at: (s: number, lat = 0) => ({ x: Math.cos(heading) * s - Math.sin(heading) * lat, y: Math.sin(heading) * s + Math.cos(heading) * lat, h: heading }) } } as unknown as Seg;
  scene.player = new Veh('player', seg, 2000, 0, 0);
  scene.player.setTrailers([50, 50]);
  const cam = { width, height, zoom: 1.1, rotation: 0, midPoint: { x: 0, y: 0 }, scrollX: 0, scrollY: 0,
    setZoom(z: number) { this.zoom = z; }, setRotation(r: number) { this.rotation = r; },
    centerOn(x: number, y: number) { this.midPoint = { x, y }; } };
  (scene as any).cameras = { main: cam };
  scene.camH = heading; scene.zoomCur = 1.1;
  scene.net = { stations: [], roads: [] } as any;
  scene.stars = { setScale() {}, tilePositionX: 0, tilePositionY: 0 } as any;
  scene.wash = { setScale() {} } as any;
  scene.baker = { sweep() {} } as any;
  const incident = { phase: 'stopping', seg, front: 0, rear: 0, cas: [scene.player], withPlayer: true } as Incident;
  scene.inc = { playerIncident: () => incident } as any;
  const step = (seconds = 0.05) => (scene as any).updateCamera(seconds);
  const settle = () => { for (let i = 0; i < 240; i++) step(); };
  return { scene, cam, incident, step, settle };
}

function collisionScene(crossBoundary: boolean, width: number, height: number) {
  const fixture = cameraScene(width, height);
  const { scene } = fixture;
  const net = new Network(), seg = net.roads.find(r => r.name === 'M1')!.f[0];
  const ctl: PlayerCtl = {
    desired: () => 345, extraGap: () => Infinity, obeySignal: () => true,
    brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
  };
  const tr = new Traffic(net, ctl);
  tr.spawnT.fill(Infinity); tr.localT = Infinity; tr.view.r = 20000;
  const p = tr.add('player', seg, crossBoundary ? seg.len - 20 : 4000, 0, 345);
  p.setTrailers([50, 50]);
  const van = tr.add('van', seg, p.s + 15, 0, 0);
  van.age = 8; van.vDes = 0; van.aMax = 0; // stationary, but an ordinary drive-state collision casualty
  const inc = new Incidents(net, tr, { playerCrashed() {}, playerReleased() {}, bump() {} });
  scene.net = net; scene.traffic = tr; scene.inc = inc; scene.player = tr.player = p;
  scene.camH = p.h;
  for (let i = 0; i < 50; i++) { tr.update(0.02); inc.update(0.02, false); }
  expect(p.state).toBe('crashed');
  const incident = inc.playerIncident()!;
  expect(incident.cas).toEqual([p, van]);
  expect(incident.phase).toBe('wait');
  if (crossBoundary) {
    expect(p.seg).toBe(seg.next);
    expect(van.seg).toBe(seg);
    expect(Math.hypot(p.x - van.x, p.y - van.y)).toBeLessThan(200);
  } else expect(p.seg).toBe(van.seg);
  return { ...fixture, incident, tr, inc, van };
}

function expectInOverview(cam: ReturnType<typeof cameraScene>['cam'], point: { x: number; y: number }) {
  const dx = point.x - cam.midPoint.x, dy = point.y - cam.midPoint.y;
  const x = cam.width / 2 + (Math.cos(cam.rotation) * dx - Math.sin(cam.rotation) * dy) * cam.zoom;
  const y = cam.height / 2 + (Math.sin(cam.rotation) * dx + Math.cos(cam.rotation) * dy) * cam.zoom;
  expect(x).toBeGreaterThan(cam.width * 0.15);
  expect(x).toBeLessThan(cam.width * 0.85);
  expect(y).toBeGreaterThan(cam.height * 0.2);
  expect(y).toBeLessThan(cam.height * 0.8);
}

afterEach(() => { G.paused = false; vi.restoreAllMocks(); });

describe('real cross-section incident camera', () => {
  it.each([[1280, 720], [390, 844], [667, 375]])('keeps a boundary crash as readable as an ordinary crash at %sx%s', (width, height) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ordinary = collisionScene(false, width, height);
    ordinary.settle();
    const crossing = collisionScene(true, width, height);
    crossing.settle();
    expect(crossing.cam.zoom).toBeGreaterThan(ordinary.cam.zoom * 0.75);
    expect(crossing.cam.zoom).toBeLessThan(ordinary.cam.zoom * 1.25);
    // Dispatch through the real incident lifecycle; place the crews at their real parking targets.
    for (const fixture of [ordinary, crossing]) {
      const { scene, cam, incident, inc, settle } = fixture;
      inc.update(incident.towAt, false);
      for (const crew of [incident.police!, incident.tow!]) {
        expect(crew).not.toBeNull();
        crew.s = crew.stopAt!; crew.v = 0; crew.resetTrail();
      }
      inc.update(0, false);
      expect(incident.phase).toBe('repair');
      settle();
      const centre = scene.player.back(scene.player.totLen / 2);
      expect(cam.midPoint.x).toBeCloseTo(centre.x, 3);
      expect(cam.midPoint.y).toBeCloseTo(centre.y, 3);
      for (const v of [...incident.cas, incident.police!, incident.tow!]) {
        expectInOverview(cam, v);
        expectInOverview(cam, v.back(v.totLen));
      }
      // The intended cone/queue envelope is local to each casualty, never a different section's s.
      for (const v of incident.cas) for (const distance of [430, 800])
        expectInOverview(cam, v.seg.path.at(v.s - v.totLen - distance));
      if (fixture === ordinary) {
        // Ordinary scenes also fit the actual arrow board, cone line and queue behind the closure.
        for (const block of incident.blocks) for (const s of [block.s0 - 14, incident.rear - 70, block.s0 - 400])
          expectInOverview(cam, incident.seg.path.at(s, incident.seg.laneLat(block.lane)));
      }
    }
    expect(crossing.cam.zoom).toBeGreaterThan(ordinary.cam.zoom * 0.75);
  });
});

describe('world incident camera wiring', () => {
  it.each([[1280, 720], [390, 844], [667, 375]])('preserves rotation and fits actual crew/cone/queue points after resizing to %sx%s', (width, height) => {
    const { scene, cam, settle } = cameraScene(1280, 720, 2.4);
    scene.player.state = 'crashed';
    settle();
    cam.width = width; cam.height = height;
    settle();
    const p = scene.player, centre = p.back(p.totLen / 2);
    expect(cam.rotation).toBeCloseTo(-Math.PI / 2 - 2.4, 12);
    expect(cam.midPoint.x).toBeCloseTo(centre.x, 3);
    expect(cam.midPoint.y).toBeCloseTo(centre.y, 3);
    for (const s of [p.s + 110, p.s - p.totLen - 430, p.s - p.totLen - 800]) {
      const point = p.seg.path.at(s);
      const dx = point.x - cam.midPoint.x, dy = point.y - cam.midPoint.y;
      const x = width / 2 + (Math.cos(cam.rotation) * dx - Math.sin(cam.rotation) * dy) * cam.zoom;
      const y = height / 2 + (Math.sin(cam.rotation) * dx + Math.cos(cam.rotation) * dy) * cam.zoom;
      expect(x).toBeGreaterThan(width * 0.15);
      expect(x).toBeLessThan(width * 0.85);
      expect(y).toBeGreaterThan(height * 0.2);
      expect(y).toBeLessThan(height * 0.8);
    }
  });

  it('does not advance an interrupted camera transition while the world is paused', () => {
    const { scene, cam, step } = cameraScene();
    scene.player.state = 'crashed';
    step();
    const state = { zoom: cam.zoom, centre: { ...cam.midPoint }, blend: scene.cameraOverview };
    G.paused = true;
    scene.update(1000, 1000);
    expect({ zoom: cam.zoom, centre: cam.midPoint, blend: scene.cameraOverview }).toEqual(state);
    G.paused = false;
    step();
    expect(scene.cameraOverview).toBeGreaterThan(state.blend);
  });
  it('eases into a rig-centred overview through stopping/wait/repair and restores on release even while clear remains', () => {
    const { scene, cam, incident, step, settle } = cameraScene();
    const p = scene.player, rigCenter = p.back(p.totLen / 2);
    step();
    const drivingX = cam.midPoint.x, drivingZoom = cam.zoom;
    p.state = 'crashed';
    step();
    expect(cam.midPoint.x).toBeLessThan(drivingX);
    expect(cam.midPoint.x).toBeGreaterThan(rigCenter.x);
    expect(cam.zoom).toBeLessThan(drivingZoom);
    settle();
    expect(cam.midPoint.x).toBeCloseTo(rigCenter.x, 3);
    for (const phase of ['wait', 'repair'] as const) {
      incident.phase = phase; incident.front = p.s; incident.rear = p.s - p.totLen;
      settle();
      expect(cam.midPoint.x).toBeCloseTo(rigCenter.x, 3);
      expect(cam.midPoint.y).toBeCloseTo(rigCenter.y, 3);
    }
    const overviewZoom = cam.zoom;
    incident.phase = 'clear'; p.state = 'drive';
    step();
    expect(cam.midPoint.x).toBeGreaterThan(rigCenter.x);
    expect(cam.midPoint.x).toBeLessThan(drivingX);
    expect(cam.zoom).toBeGreaterThan(overviewZoom);
    settle();
    expect(cam.midPoint.x).toBeCloseTo(drivingX, 3);
    expect(cam.zoom).toBeCloseTo(drivingZoom, 3);
  });
});
