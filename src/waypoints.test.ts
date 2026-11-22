import { describe, expect, it, vi } from 'vitest';
import { Network, type Route, type Seg } from './network';

vi.mock('./state', () => ({ SPEEDS: [0, 90, 150, 215, 280, 345] }));

const net = new Network();
const road = (name: string) => net.roads.find((r) => r.name === name)!;
const station = (id: string) => net.byId[id];
const roadsOf = (r: Route, start: Seg) => [start.road, ...r.trans.map((t) => t.to.road)];
/** a point a little to one side of a road's centre line, where a player might click on the map */
const onRoad = (name: string, f: number) => { const c = road(name).c, q = c.at(c.len * f); return { x: q.x + 20, y: q.y - 15 }; };
/** the fastest via-route from any of a station's departures */
function fromStation(id: string, wp: { x: number; y: number }, to: string | null) {
  const goals = to ? net.stationGoals(station(to)) : [];
  const via = net.waypointGoals(wp.x, wp.y);
  return station(id).dep.map((seg) => ({ seg, r: net.routeVia(seg, 100, via, goals) }))
    .filter((x) => x.r).sort((a, b) => a.r!.cost - b.r!.cost)[0];
}

describe('waypoint snapping', () => {
  it('snaps a map point to the nearest place on each nearby carriageway', () => {
    const wp = onRoad('Frost Line', 0.5);
    const via = net.waypointGoals(wp.x, wp.y);
    expect(new Set(via.map((g) => g.seg.road))).toEqual(new Set(['Frost Line']));
    // both carriageways, so the route may reach it in either direction
    expect(new Set(via.map((g) => g.seg.name))).toEqual(new Set(['Frost Line F', 'Frost Line R']));
    for (const g of via) { const q = g.seg.path.at(g.s); expect(Math.hypot(q.x - wp.x, q.y - wp.y)).toBeLessThan(150); }
  });

  it('finds nothing away from the roads', () => {
    expect(net.waypointGoals(-8000, -8000)).toEqual([]);
  });
});

describe('via-point routing', () => {
  it('passes through the waypoint and then reaches the goal', () => {
    const wp = onRoad('Frost Line', 0.5), { seg, r } = fromStation('harbor', wp, 'glacier')!;
    expect(r).not.toBeNull();
    const pts = net.routePoints(r!, seg, 100, 40);
    const near = Math.min(...pts.map((p) => Math.hypot(p.x - wp.x, p.y - wp.y)));
    expect(near).toBeLessThan(150);
    expect(r!.goal.seg.arrStation).toBe(station('glacier'));
    expect(net.waypointGoals(wp.x, wp.y)).toContainEqual(r!.via);
    // its cost is the two legs end to end: no cheaper than going straight there
    const direct = net.route(seg, 100, net.stationGoals(station('glacier')))!;
    expect(r!.cost).toBeGreaterThanOrEqual(direct.cost - 1e-6);
    expect(r!.distance).toBeGreaterThan(0);
  });

  it('makes a Harbor–Glacier route go via Kestrel when the waypoint is on Frost Line', () => {
    const { seg, r } = fromStation('harbor', onRoad('Frost Line', 0.4), 'glacier')!;
    const kestrel = station('kestrel');
    expect(r!.trans.some((t) => t.kind === 'dock' && t.from.arrStation === kestrel)).toBe(true);
    expect(roadsOf(r!, seg)).toContain('Frost Line');
    expect(roadsOf(r!, seg)).not.toContain('Polar Express');
  });

  it('makes a Harbor–Glacier route take Polar Express when the waypoint is on it', () => {
    const { seg, r } = fromStation('harbor', onRoad('Polar Express', 0.5), 'glacier')!;
    expect(roadsOf(r!, seg)).toContain('Polar Express');
    expect(r!.trans.some((t) => t.kind === 'dock' && t.from.arrStation === station('kestrel'))).toBe(false);
  });

  it('without a goal, routes to the waypoint and stops there', () => {
    const wp = onRoad('Frost Line', 0.5), { r } = fromStation('harbor', wp, null)!;
    expect(r!.goal).toEqual(r!.via);
    const q = r!.goal.seg.path.at(r!.goal.s);
    expect(Math.hypot(q.x - wp.x, q.y - wp.y)).toBeLessThan(150);
  });

  it('returns null with no waypoint candidates', () => {
    const seg = station('harbor').dep[0];
    expect(net.routeVia(seg, 100, [], net.stationGoals(station('glacier')))).toBeNull();
  });
});
