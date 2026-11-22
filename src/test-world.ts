import { vi } from 'vitest';
import { WorldScene, STATION_R } from './world';
import { Network, type Station } from './network';
import { Traffic } from './traffic';
import { edgeS } from './render';
import { G, type Job } from './state';
import { board } from './test-phaser';

/** the world's fixed simulation step, in seconds */
export const STEP = 0.02;

/**
 * A headless world for driving tests (with Phaser stubbed by `test-phaser`): the real network, no AI traffic and no
 * incidents, and a starter rig (one small trailer, no upgrades, a full tank) waiting at the first gate of station `at`.
 */
export function headlessWorld(at: string) {
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
  const station = net.byId[at];
  scene.player = scene.traffic.add('player', station.dep[0], 150, station.dep[0].lanes - 1, 0);
  scene.traffic.player = scene.player;
  scene.player.gfx = {};
  scene.baseAMax = scene.player.aMax;
  scene.station = station;
  (scene as any).computeCosts();
  G.deliveries = 1; G.earned = 0; G.money = 0; G.fuel = 1; G.pax = 0;
  return { scene, net, station };
}

/** the first contract the job board at `from` offers to deliver to station `toId`, in the starter rig's cargo class */
export function boardContract(scene: WorldScene, from: Station, toId: string): Job {
  board.first = toId;
  const job = scene.makeJobs(from)[0];
  job.cls = 0;
  return job;
}

/** drive at the posted limit: pick the speed setting for the lowest limit within braking distance ahead */
export function holdLimit(scene: WorldScene) {
  const p = scene.player, ahead = scene.net.place(p.seg, p.s + 450);
  G.braking = false;
  G.speedSet = Math.min(p.seg.limitAt(p.s), ahead.seg.limitAt(ahead.s));
}

/** one step of the world: due timers, then what the driver does (`drive`), the traffic, the contract clock and the rig */
export function tick(scene: WorldScene, drive: (scene: WorldScene) => void, dt = STEP) {
  for (const q of scene.pending) q.t -= dt;
  const due = scene.pending.filter((q) => q.t <= 0);
  if (due.length) { scene.pending = scene.pending.filter((q) => q.t > 0); for (const q of due) q.fn(); }
  drive(scene);
  const p = scene.player, prevS = p.s, prevSeg = p.seg;
  scene.traffic.update(dt);
  if (G.job && G.mode === 'drive') G.job.elapsed += dt;
  (scene as any).playerLogic(dt, prevS, prevSeg);
}
