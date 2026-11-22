import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./test-phaser')).phaserStub);
import type { PoliceHQ, Seg } from './network';
import { G } from './state';
import { headlessWorld, boardContract, tick, STEP } from './test-world';

/**
 * A headless world with the real network and no AI traffic, and a loaded starter rig with a contract from `fromId` to
 * `toId`, put on Kestrel Link at s on `seg` in `lane`.
 */
function world(fromId: string, toId: string | null, at: (link: { f: Seg[]; r: Seg[] }) => [Seg, number, number]) {
  const { scene, net, station: from } = headlessWorld(fromId);
  if (toId) scene.acceptJob(boardContract(scene, from, toId));
  scene.station = null;
  const link = net.roads.find((r) => r.name === 'Kestrel Link')!;
  const [seg, s, lane] = at(link);
  const p = scene.player;
  p.seg.veh.splice(p.seg.veh.indexOf(p), 1);
  p.seg = seg; p.s = s; p.lane = lane; p.lat = seg.laneLat(lane); p.v = 200;
  seg.veh.push(p);
  scene.pstate = 'drive'; G.mode = 'drive'; G.braking = false; G.speedSet = 3;
  scene.computeRoute(false);
  const hq = net.facility('hq:kestrel') as PoliceHQ;
  return { scene, net, p, link, hq };
}

/** run the world for up to `seconds` until `until` holds, driving at the posted limit; false if it never does */
function step(w: ReturnType<typeof world>, seconds: number, until: () => boolean): boolean {
  const { scene, p } = w;
  for (let t = 0; t < seconds; t += STEP) {
    tick(scene, () => {
      if (scene.pstate === 'drive' && G.mode === 'drive') {
        G.braking = false;
        G.speedSet = Math.max(2, p.seg.limitAt(p.s));
      }
    });
    expect(scene.pstate).not.toBe('pulled');
    if (until()) return true;
  }
  return false;
}

afterEach(() => { G.job = null; G.mode = 'drive'; G.braking = false; G.speedSet = 0; G.deliveries = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** where each way into HQ starts: the northbound carriageway near the Kestrel gate, or the southbound one past the junction */
const ENTRIES = {
  northbound: { at: (l: { f: Seg[] }) => [l.f[0], 150, 0] as [Seg, number, number], turn: -1 },
  southbound: { at: (l: { r: Seg[] }) => [l.r[0], 600, 1] as [Seg, number, number], turn: 1 },
} as const;

describe('driving into and out of Police HQ', () => {
  it.each([
    ['northbound', 'towards Polar Express', 'glacier'],
    ['northbound', 'towards Kestrel Station', 'kestrel'],
    ['southbound', 'towards Polar Express', 'harbor'],
    ['southbound', 'towards Kestrel Station', 'kestrel'],
  ] as const)('turns off the %s carriageway into HQ, round the loop and out %s', (from, _towards, to) => {
    const entry = ENTRIES[from];
    const w = world(to === 'kestrel' ? 'glacier' : 'kestrel', to, entry.at as any);
    const { scene, p, link, hq } = w;
    scene.laneChange(entry.turn);
    expect(step(w, 60, () => !!p.seg.hq), 'turns off for HQ').toBe(true);
    // turning off the last stretch before the Kestrel gate is no longer docking there
    expect(scene.pstate).toBe('drive');
    expect(step(w, 90, () => p.seg === hq.yard && p.s > hq.stopS), 'drives round the loop').toBe(true);
    const out = to === 'kestrel' ? link.r : link.f;
    expect(step(w, 90, () => out.includes(p.seg) && p.lane >= 0 && p.lane < p.seg.lanes), 'back onto the link').toBe(true);
    if (to === 'kestrel') expect(step(w, 90, () => G.mode === 'board'), 'docks to deliver at Kestrel Station').toBe(true);
    else expect(step(w, 90, () => p.seg.road === 'Polar Express'), 'onto Polar Express').toBe(true);
  }, 30000);
});

describe('choosing the way out of Police HQ', () => {
  it.each([
    [-1, 'Polar Express', 'f'],
    [1, 'Kestrel Station', 'r'],
  ] as const)('with no contract, steers out of the loop the way the driver picks (%i: towards %s)', (d, _name, onto) => {
    const w = world('kestrel', null, (l) => [l.f[0], 150, 0]);
    const { scene, p, link, hq } = w;
    scene.laneChange(-1);
    expect(step(w, 60, () => p.seg === hq.yard)).toBe(true);
    scene.laneChange(d);
    expect(step(w, 90, () => link.f.includes(p.seg) || link.r.includes(p.seg))).toBe(true);
    expect(link[onto]).toContain(p.seg);
  }, 30000);

  it('lets a driver with a contract pick the other way out, and routes on from there', () => {
    const w = world('glacier', 'kestrel', (l) => [l.f[0], 150, 0]);
    const { scene, p, link, hq } = w;
    scene.laneChange(-1);
    expect(step(w, 60, () => p.seg === hq.yard)).toBe(true);
    scene.laneChange(-1);
    expect(step(w, 90, () => link.f.includes(p.seg) || link.r.includes(p.seg))).toBe(true);
    expect(link.f).toContain(p.seg);
    expect(p.goal).not.toBeNull();
  }, 30000);
});
