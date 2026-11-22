import { describe, expect, it } from 'vitest';
import { Network } from './network';

/** Route comparison on the Harbor Prime–Glacier Outpost corridor: Polar Express against the Kestrel route. */
const net = new Network();
const harbor = net.byId.harbor, glacier = net.byId.glacier;
const fromHarbor = harbor.dep.map((seg) => ({ seg, s: 150 }));

describe('comparing routes for a contract', () => {
  it('offers the fastest route and the fastest one avoiding its main road: Polar Express against the Kestrel route', () => {
    const [fast, alt, ...rest] = net.compareRoutes(fromHarbor, net.stationGoals(glacier));
    expect(rest).toHaveLength(0);
    expect(fast.mainRoad).toBe('Polar Express');
    expect(fast.passThrough).toEqual([]);
    // the alternative never touches Polar Express, even where a link road could join it part-way
    expect(alt.mainRoad).not.toBe('Polar Express');
    expect(alt.roads).not.toContain('Polar Express');
    expect(alt.roads.slice(0, 1)).toEqual(['Harbor Run']);
    expect(alt.roads[alt.roads.length - 1]).toBe('Frost Line');
    expect(alt.passThrough.map((st) => st.name)).toEqual(['Kestrel Station']);
    expect(alt.name).toBe('Via Kestrel Station');
    expect(fast.name).toBe('Polar Express');
  });

  it('gives each route its legal time, the cameras it passes and the fuel and repair facilities along it', () => {
    const [fast, alt] = net.compareRoutes(fromHarbor, net.stationGoals(glacier));
    // legal Polar Express is faster even though it is about 8 km longer (ADR 0001)
    expect(fast.route.cost).toBeGreaterThan(100);
    expect(fast.route.cost).toBeLessThan(alt.route.cost);
    expect(alt.route.cost - fast.route.cost).toBeGreaterThan(15);
    expect(fast.route.distance).toBeGreaterThan(alt.route.distance + 5000);
    // Polar Express eastbound has two cameras; the Kestrel route only the one on Harbor Run eastbound
    expect(fast.cameras.map((c) => c.id)).toHaveLength(2);
    for (const c of fast.cameras) expect(c.id).toMatch(/^cam-polar-express-f-\d+$/);
    expect(alt.cameras.map((c) => c.id)).toHaveLength(1);
    expect(alt.cameras[0].id).toMatch(/^cam-harbor-run-f-\d+$/);
    // Polar Express has no fuel; the Kestrel route passes both Fuel & Repair facilities
    expect(fast.facilities).toEqual([]);
    expect(alt.facilities.map((f) => [f.id, f.kind])).toEqual([
      ['services:harbor-pumps', 'fuel-repair'],
      ['services:frost-fuel', 'fuel-repair'],
    ]);
    expect(alt.facilities.map((f) => net.facility(f.id))).toEqual(alt.facilities);
  });

  it('starts each route from the departure it leaves by', () => {
    const [fast, alt] = net.compareRoutes(fromHarbor, net.stationGoals(glacier));
    expect(fast.start.seg.road).toBe('Polar Express');
    expect(alt.start.seg.road).toBe('Harbor Run');
    expect(harbor.dep).toContain(fast.start.seg);
    expect(harbor.dep).toContain(alt.start.seg);
  });

  it('routes around a road it is told to avoid, or not at all when there is no way round', () => {
    const polarStart = harbor.dep.find((seg) => seg.road === 'Polar Express')!;
    const avoidPolar = new Set(['Polar Express']);
    expect(net.route(polarStart, 150, net.stationGoals(glacier), 0, false, avoidPolar)).toBeNull();
    const runStart = harbor.dep.find((seg) => seg.road === 'Harbor Run')!;
    const r = net.route(runStart, 150, net.stationGoals(glacier), 0, false, avoidPolar)!;
    expect(r.trans.map((t) => t.to.road)).not.toContain('Polar Express');
  });

  it('offers only one route when nothing avoids the main road', () => {
    // mid-way along Polar Express, every route to Glacier Outpost stays on Polar Express
    const seg = net.roads.find((rd) => rd.name === 'Polar Express')!.f;
    const last = seg[seg.length - 1];
    const options = net.compareRoutes([{ seg: last, s: 100 }], net.stationGoals(glacier));
    expect(options).toHaveLength(1);
    expect(options[0].mainRoad).toBe('Polar Express');
  });
});
