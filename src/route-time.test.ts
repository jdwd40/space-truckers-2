import { describe, expect, it, vi } from 'vitest';
import { Network, type Route, type Seg } from './network';
import baseline from './fixtures/fastest-routes-baseline.json';
import { Traffic, type PlayerCtl } from './traffic';

vi.mock('./state', () => ({ SPEEDS: [0, 90, 150, 215, 280, 345] }));

/** Posted limit speeds in world units per second: limit 2 = 150, limit 3 = 215, limit 5 = 345. */
const net = new Network();
const road = (name: string) => net.roads.find((r) => r.name === name)!;
const station = (name: string) => net.stations.find((s) => s.name === name)!;

describe('routing by travel time at the posted limit', () => {
  it('costs a stretch of carriageway as seconds at its posted limit', () => {
    const host = road('Polar Express').f[0], s0 = Math.round(host.len / 2);
    // mid-Polar is far from any station or crossing, so it is posted at the top limit
    expect(net.route(host, s0, [{ seg: host, s: s0 + 3450 }])!.cost).toBeCloseTo(10, 6);
  });

  it('costs slip roads at their own lower limit', () => {
    const uturn = net.trans.find((t) => t.kind === 'uturn' && t.type === 'exit')!.to;
    expect(net.route(uturn, 0, [{ seg: uturn, s: 1500 }])!.cost).toBeCloseTo(10, 6);
  });

  it('adds time for a docking pass-through on top of the driving either side of it', () => {
    const kestrel = station('Kestrel Station'), arr = kestrel.arr[0], dep = kestrel.dep[0];
    const goal = [{ seg: dep, s: 2000 }];
    const through = net.route(arr, arr.len - 150, goal)!;
    expect(through.trans.map((t) => t.kind)).toEqual(['dock']);
    const extra = through.cost - net.route(dep, 150, goal)!.cost;
    // stopping at the dock, waiting for clearance and pulling away costs seconds, not a free U-turn
    expect(extra).toBeGreaterThan(20);
    expect(extra).toBeLessThan(35);
  });

  it('reports the physical length of a route separately from its time', () => {
    const harbor = station('Harbor Prime'), glacier = station('Glacier Outpost');
    const runs = harbor.dep.map((seg) => net.route(seg, 100, net.stationGoals(glacier))!).sort((a, b) => a.cost - b.cost);
    // Polar Express: about 34.0 km, driven in a couple of minutes
    expect(runs[0].distance).toBeCloseTo(33985, -1);
    expect(runs[0].cost).toBeGreaterThan(60);
    expect(runs[0].cost).toBeLessThan(200);
  });

  it('sends Harbor Prime to Glacier Outpost traffic via Polar Express, where the shorter Kestrel route is posted slower', () => {
    const harbor = station('Harbor Prime'), glacier = station('Glacier Outpost');
    const after = harbor.dep.map((seg) => ({ seg, r: net.route(seg, 100, net.stationGoals(glacier))! }))
      .sort((a, b) => a.r.cost - b.r.cost)[0];
    // the Kestrel route is 8 km shorter, but at posted limit 4 with a pass-through it is not the faster one
    expect(after.seg.road).toBe('Polar Express');
    expect(after.r.trans.some((t) => t.kind === 'dock')).toBe(false);

    // AI traffic leaving Harbor Prime for Glacier Outpost takes the same road
    const ctl: PlayerCtl = { desired: () => 345, extraGap: () => Infinity, obeySignal: () => true, brakeMin: () => null, onTrans() {}, onBlocked() {}, onRouteNeeded() {} };
    const traffic = new Traffic(net, ctl);
    const npc = traffic.add('van', after.seg, 100, 0, 100);
    npc.dest = glacier.id;
    traffic.reroute(npc);
    expect(npc.route).toEqual(after.r.trans);
    expect([after.seg.road, ...npc.route.map((t) => t.to.road)]).toContain('Polar Express');
  });

  it('prints the fastest route between every pair of stations, before and after routing by time', () => {
    const fresh = new Network();
    /** The roads a route drives, in order, with each docking pass-through between them. */
    const roads = (seg: Seg, r: Route) => {
      const out: string[] = [];
      const push = (n: string) => { if (n && out[out.length - 1] !== n) out.push(n); };
      push(seg.road);
      for (const t of r.trans) { if (t.kind === 'dock') push(`pass-through ${t.label}`); push(t.to.road); }
      return out;
    };
    const km = (d: number) => (d / 1000).toFixed(1);
    const lines = ['| From | To | Before (by distance) | km | After (by time) | km | Legal time |', '|---|---|---|---|---|---|---|'];
    // `baseline` was recorded from the distance-costed router on the integration branch before this change
    expect(baseline).toHaveLength(42);
    for (const row of baseline) {
      const a = fresh.stations.find((st) => st.name === row.from)!, b = fresh.stations.find((st) => st.name === row.to)!;
      const best = a.dep.map((seg) => ({ seg, r: fresh.route(seg, 100, fresh.stationGoals(b)) }))
        .filter((x): x is { seg: Seg; r: Route } => x.r !== null).sort((x, y) => x.r.cost - y.r.cost)[0];
      expect(best, `${row.from} → ${row.to}`).toBeDefined();
      const before = row.roads.join(' > '), after = roads(best.seg, best.r).join(' > ');
      lines.push(`| ${row.from} | ${row.to} | ${before} | ${km(row.distance)} | ${after === before ? 'unchanged' : after} | ${km(best.r.distance)} | ${best.r.cost.toFixed(0)} s |`);
    }
    console.log(lines.join('\n'));
  });
});
