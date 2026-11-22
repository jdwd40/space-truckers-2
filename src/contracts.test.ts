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
import before from './fixtures/deadlines-before-corridor.json';

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

  it('sets the Harbor Prime–Glacier Outpost deadline, both ways, at 1.15 times a legal Polar Express run plus 40 s for incidents', () => {
    const { contract, legal } = board();
    for (const [from, to] of [['Harbor Prime', 'Glacier Outpost'], ['Glacier Outpost', 'Harbor Prime']]) {
      // pulling away and docking take a loaded rig about 7 s beyond the legal time (measured in corridor-drive.test.ts:
      // a 114.1 s run on a 107.0 s route); breakdowns, accidents and roadworks ahead are allowed 40 s on top
      expect(contract(from, to).target, `${from} → ${to}`).toBeCloseTo(1.15 * (legal(from, to) + 7) + 40, 1);
    }
    expect(contract('Harbor Prime', 'Glacier Outpost').target).toBeCloseTo(171.3, 0);
  });

  it('keeps every other station pair on a deadline a legal run beats, no tighter than when routing first went by time', () => {
    const { contract, legal } = board();
    const corridor = (a: string, b: string) => [a, b].sort().join() === 'Glacier Outpost,Harbor Prime';
    const lines = ['| From | To | Legal time | Deadline (#21) | Deadline |', '|---|---|---|---|---|'];
    // `before` was recorded from the time-costed router of #21 (6537e74), whose deadline was 1.25 × legal time + 45 s
    expect(before).toHaveLength(42);
    for (const row of before) {
      const { from, to } = row, job = contract(from, to), time = legal(from, to);
      lines.push(`| ${from} | ${to} | ${time.toFixed(0)} s | ${row.deadline.toFixed(0)} s | ${job.target.toFixed(0)} s |`);
      if (corridor(from, to)) continue;
      expect(job.target, `${from} → ${to}`).toBeGreaterThan((time + 7) * 1.2);
      expect(job.target, `${from} → ${to}`).toBeGreaterThanOrEqual(row.deadline - 0.5);
      expect(job.target / row.deadline, `${from} → ${to}`).toBeLessThan(1.3);
    }
    console.log(lines.join('\n'));
  });
});
