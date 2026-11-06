import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} },
}));

import { WorldScene } from './world';
import { G, UP, CLASSES, type Job } from './state';
import { Traffic, Veh } from './traffic';
import { Seg, type Network } from './network';
import { Path } from './geom';

function handlingScene() {
  const scene = new WorldScene();
  const seg = { laneLat: () => 0, path: { at: (s: number) => ({ x: s, y: 0, h: 0 }) }, stops: [], kind: 'motorway' } as unknown as Seg;
  scene.player = new Veh('player', seg, 1000, 0, 215);
  scene.player.gfx = {};
  scene.baseAMax = scene.player.aMax;
  vi.spyOn(scene as any, 'buildUnits').mockImplementation(() => {});
  return scene;
}

const job = (stage: Job['stage'], cls = 3) => ({ cls, stage }) as Job;
afterEach(() => { G.job = null; G.braking = false; G.speedSet = 0; UP.cab = 0; vi.restoreAllMocks(); });

function simulatedRig(cls: number, speed: number) {
  const scene = handlingScene();
  const seg = new Seg('handling road', new Path([{ x: 0, y: 0 }, { x: 100000, y: 0 }]), 3, 'motorway');
  const net = { segs: [seg], spawnSegs: [], stations: [], laybys: [], signals: [], services: [] } as unknown as Network;
  const traffic = new Traffic(net, scene);
  traffic.localT = 1e6; // no population/spawn randomness in the handling experiment
  scene.player = traffic.add('player', seg, 1000, 0, speed);
  scene.traffic = traffic; traffic.player = scene.player;
  scene.player.gfx = {};
  G.job = cls < 0 ? null : job('deliver', cls);
  scene.refreshPlayerVis();
  return scene;
}

describe('real traffic handling integration', () => {
  it('makes empty, light and heavy rigs pull away progressively more slowly', () => {
    G.speedSet = 5; G.braking = false;
    const results = [-1, 0, 3].map((cls) => {
      const scene = simulatedRig(cls, 0);
      for (let i = 0; i < 100; i++) scene.traffic.update(0.02);
      return { speed: scene.player.v, distance: scene.player.s - 1000 };
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i].speed).toBeLessThan(results[i - 1].speed);
      expect(results[i].distance).toBeLessThan(results[i - 1].distance);
    }
  });

  it.each(['manual', 'cruise'] as const)('takes longer and travels further to slow at equal initial speed under %s braking', (mode) => {
    G.speedSet = mode === 'manual' ? 5 : 0; G.braking = mode === 'manual';
    const results = [-1, 0, 3].map((cls) => {
      const scene = simulatedRig(cls, 215);
      let steps = 0;
      while (scene.player.v > 0 && steps < 2000) { scene.traffic.update(0.02); steps++; }
      expect(scene.player.v).toBe(0);
      return { seconds: steps * 0.02, distance: scene.player.s - 1000 };
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i].seconds).toBeGreaterThan(results[i - 1].seconds);
      expect(results[i].distance).toBeGreaterThan(results[i - 1].distance);
    }
  });

  it.each(['docking', 'following'] as const)('applies the load-scaled service cap to automatic %s stops', (mode) => {
    G.speedSet = 5; G.braking = false;
    const braking = [-1, 0, 3].map((cls) => {
      const scene = simulatedRig(cls, 215), p = scene.player;
      if (mode === 'docking') { scene.pstate = 'docking'; scene.dockS.set(p.seg, p.s + 120); }
      else {
        const blocker = scene.traffic.add('van', p.seg, p.s + 154, p.lane, 0);
        blocker.state = 'held';
      }
      scene.traffic.update(0.02);
      expect(p.acc).toBeLessThan(0);
      expect(p.acc).toBeGreaterThanOrEqual(-p.maxBrake);
      return p.acc;
    });
    expect(braking[0]).toBeLessThan(braking[1]);
    expect(braking[1]).toBeLessThan(braking[2]);
  });
});

describe('world load lifecycle', () => {
  it('uses load-scaled manual and signal stops but retains crash emergency braking', () => {
    const scene = handlingScene(), p = scene.player;
    G.braking = true;
    const brakes: number[][] = [];
    for (const cls of [-1, 0, 3]) {
      G.job = cls < 0 ? null : job('deliver', cls);
      scene.refreshPlayerVis();
      p.seg.stops = [];
      const manual = scene.brakeMin(p)!;
      p.seg.stops = [{ s: p.s + 300, group: 0, sig: { state: () => 'R' } } as any];
      const signal = scene.brakeMin(p)!;
      p.seg.stops[0].s = p.s + 1;
      const lateSignal = scene.brakeMin(p)!;
      expect(lateSignal).toBeGreaterThanOrEqual(-p.maxBrake);
      brakes.push([manual, signal]);
    }
    for (const channel of [0, 1]) {
      expect(brakes[0][channel]).toBeLessThan(brakes[1][channel]);
      expect(brakes[1][channel]).toBeLessThan(brakes[2][channel]);
    }
    G.braking = false;
    expect(scene.brakeMin(p)).toBeNull();
    p.state = 'crashed';
    expect(scene.brakeMin(p)).toBe(-430);
    p.v = 0;
    expect(scene.brakeMin(p)).toBeNull();
  });
  it('immediately reapplies non-compounding handling on pickup, loading, upgrades and unloading', () => {
    const scene = handlingScene(), p = scene.player;
    G.job = job('pickup');
    scene.refreshPlayerVis();
    const empty = { aMax: p.aMax, bComf: p.bComf, maxBrake: p.maxBrake };
    expect(empty).toEqual({ aMax: 90, bComf: 150, maxBrake: 380 });
    expect(p.trailers).toEqual([]);
    G.job.stage = 'deliver';
    scene.refreshPlayerVis();
    expect(p.trailers).toEqual(CLASSES[3].trailers);
    expect(p.aMax).toBeLessThan(empty.aMax);
    expect(p.bComf).toBeLessThan(empty.bComf);
    expect(p.maxBrake).toBeLessThan(empty.maxBrake);
    const loadedAcceleration = p.aMax;
    scene.refreshPlayerVis();
    expect(p.aMax).toBe(loadedAcceleration);
    UP.cab = 3;
    scene.applyUpgrades();
    expect(p.aMax).toBeCloseTo(loadedAcceleration * 1.8);
    scene.applyUpgrades();
    expect(p.aMax).toBeCloseTo(loadedAcceleration * 1.8);
    G.job = null;
    scene.refreshPlayerVis();
    expect(p.trailers).toEqual([]);
    expect(p.aMax).toBe(90 * 1.8);
    expect(p.bComf).toBe(150);
    expect(p.maxBrake).toBe(380);
  });
});

describe('changing lane at a closure', () => {
  function closedScene() {
    const scene = simulatedRig(-1, 0);
    const p = scene.player, seg = p.seg;
    for (const lane of [1, 2]) seg.blocks.push({ lane, s0: 1012, s1: 2000, inc: null, warn: 2200 });
    G.mode = 'drive';
    return { scene, p, seg };
  }
  it('takes the player out of the far lane of a two-lane closure, one lane at a time', () => {
    const { scene, p, seg } = closedScene();
    p.lane = 2; p.lat = seg.laneLat(2);
    scene.laneChange(-1);
    expect(p.pend).toBe(1);
  });
  it('shows closed lanes on the sat-nav without a job as well', () => {
    const { scene } = closedScene();
    expect((scene as any).computeNav().lanes).toEqual([true, false, false]);
  });
  it('still refuses a move further into the closure', () => {
    const { scene, p, seg } = closedScene();
    p.lane = 1; p.lat = seg.laneLat(1);
    scene.laneChange(1);
    expect(p.pend).toBeNull();
    p.lane = 0; p.lat = seg.laneLat(0);
    scene.laneChange(1);
    expect(p.pend).toBeNull();
  });
});
