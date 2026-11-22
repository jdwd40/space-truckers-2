import { afterEach, describe, expect, it, vi } from 'vitest';

/** The job board shuffles its destinations; tests put the destination they want first. */
let firstDest = '';
vi.mock('phaser', () => ({
  default: {
    Events: { EventEmitter: class { emit() {} } }, Scene: class {},
    Utils: { Array: { Shuffle: <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => Number(y.id === firstDest) - Number(x.id === firstDest)) } },
  },
}));
import { WorldScene } from './world';
import { Network } from './network';
import { G } from './state';
import baseline from './fixtures/fastest-routes-baseline.json';

function board() {
  const scene = new WorldScene(), net = new Network();
  scene.net = net;
  (scene as any).computeCosts();
  G.deliveries = 1; G.earned = 0;
  vi.spyOn(Math, 'random').mockReturnValue(0.99); // no remote pickups
  /** The first contract offered at `from`, delivering to `to`. */
  const contract = (from: string, to: string) => {
    firstDest = net.stations.find((s) => s.name === to)!.id;
    return scene.makeJobs(net.stations.find((s) => s.name === from)!)[0];
  };
  /** The legal travel time of the fastest route between two stations. */
  const legal = (from: string, to: string) => {
    const a = net.stations.find((s) => s.name === from)!, b = net.stations.find((s) => s.name === to)!;
    return Math.min(...a.dep.map((seg) => net.route(seg, 100, net.stationGoals(b))?.cost ?? Infinity));
  };
  return { contract, legal };
}
afterEach(() => { G.deliveries = 0; vi.restoreAllMocks(); });

describe('contract pay and deadlines', () => {
  it('pays by the physical distance of the fastest legal route', () => {
    const { contract } = board();
    // Polar Express, a pass-through at Glacier Outpost and Ice Road: 44.9 km. The pass-through adds time but no distance.
    const job = contract('Harbor Prime', 'Jove Gasport');
    expect(job.dist).toBeCloseTo(44877, -1);
    expect(job.pay).toBe(755);
  });

  it('keeps every station pair on a deadline that a legal run beats, never looser than the old one', () => {
    const { contract, legal } = board();
    const rows = baseline.map((row) => ({ ...row, job: contract(row.from, row.to), time: legal(row.from, row.to) }));
    const lines = ['| From | To | Legal time | Old deadline | New deadline |', '|---|---|---|---|---|'];
    for (const { from, to, job, time, deadline } of rows) {
      // pulling away and docking take a loaded rig about 7 s beyond the legal time (measured in corridor-drive.test.ts)
      expect(job.target, `${from} → ${to}`).toBeGreaterThan((time + 7) * 1.1);
      expect(job.target / deadline, `${from} → ${to}`).toBeGreaterThan(0.5);
      expect(job.target / deadline, `${from} → ${to}`).toBeLessThan(1.05);
      lines.push(`| ${from} | ${to} | ${time.toFixed(0)} s | ${deadline} s | ${job.target.toFixed(0)} s |`);
    }
    console.log(lines.join('\n'));
  });
});
