import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {}, Events: { EventEmitter: class { emit() {} } } } }));
import { Network, type PoliceHQ, type Route, type Seg } from './network';
import { mapFeatures } from './sectormap';
import { describe as describeInspection } from './mapinspect';

/** Police HQ: a facility on a short dead-end spur off Kestrel Link. */
const net = new Network();
const road = (name: string) => net.roads.find((r) => r.name === name)!;
const link = road('Kestrel Link');
const hq = () => net.facility('hq:kestrel') as PoliceHQ;
/** does the route drive on any of Police HQ's roads? */
const entersHQ = (r: Route) => r.trans.some((t) => t.to.hq || t.from.hq) || !!r.goal.seg.hq;
const hqGoal = () => [{ seg: hq().yard, s: hq().stopS }];

describe('Police HQ', () => {
  it('has a stable ID and is called Police HQ', () => {
    expect(hq()).toBeDefined();
    expect(hq()).toMatchObject({ id: 'hq:kestrel', kind: 'police-hq', name: 'Police HQ' });
    expect(new Network().facility('hq:kestrel')).toMatchObject({ id: 'hq:kestrel', x: hq().x, y: hq().y });
  });

  it('is reachable from both carriageways of Kestrel Link, by its own exit from each', () => {
    const north = link.f[0], south = link.r[0];
    const entries = new Set<Seg>();
    for (const [seg, s] of [[north, 150], [south, 200]] as const) {
      const r = net.route(seg, s, hqGoal());
      expect(r, seg.name).not.toBeNull();
      const exit = r!.trans[0];
      expect(exit.type, seg.name).toBe('exit');
      expect(exit.from, seg.name).toBe(seg);
      expect(r!.trans.some((t) => t.kind === 'uturn' || t.kind === 'dock'), seg.name).toBe(false);
      expect(r!.distance, seg.name).toBeLessThan(2500);
      entries.add(exit.to);
    }
    expect(entries.size).toBe(2);
  });

  it('fits around the link\'s own exits, merges and lane changes', () => {
    const warn = vi.spyOn(console, 'warn');
    new Network();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is grade-separated: wherever one of its roads crosses a carriageway or another slip road it is on its own deck', () => {
    const crossesAt = (a: Seg, b: Seg) => {
      // points of a's path within b's paved width, away from where a joins or leaves anything
      const half = (b.lanes * b.laneW) / 2 + 10, a0 = a.path.at(0), a1 = a.path.at(a.len);
      return a.path.pts(0, a.len, 0, 20).some((p) => {
        const n = b.path.nearest(p.x, p.y);
        return n.d < half && n.s > 30 && n.s < b.len - 30 && Math.hypot(p.x - a0.x, p.y - a0.y) > 120 && Math.hypot(p.x - a1.x, p.y - a1.y) > 120;
      });
    };
    const near = net.segs.filter((seg) => seg.path.maxX > -600 && seg.path.minX < 1600 && seg.path.maxY > -18400 && seg.path.minY < -17000);
    let crossings = 0;
    for (const a of hq().segs) for (const b of near) {
      if (a === b || !crossesAt(a, b)) continue;
      crossings++;
      expect(a.level, `${a.name} over ${b.name}`).not.toBe(b.level);
    }
    // the northbound way in crosses the southbound carriageway; the way out towards Polar Express crosses both
    expect(crossings).toBeGreaterThanOrEqual(3);
  });

  it('is signed on the approach from both directions, and the way out is signed at the loop', () => {
    for (const chain of [link.f, link.r]) {
      const exit = chain.flatMap((seg) => seg.outs).find((t) => t.type === 'exit' && t.to.hq)!;
      const before = net.signs.filter((sg) => sg.seg === exit.from && sg.s < exit.fromS && sg.panels.some((p) => p.title === 'Police HQ'));
      expect(before.length, chain[0].name).toBeGreaterThanOrEqual(1);
    }
    const out = net.signs.filter((sg) => sg.seg === hq().yard).flatMap((sg) => sg.panels.map((p) => p.title));
    expect(out).toEqual(expect.arrayContaining(['Polar Express', 'Kestrel Station']));
  });

  it('lets a driver leave towards Polar Express or towards Kestrel Station without turning back', () => {
    const polar = road('Polar Express'), kestrel = net.byId.kestrel;
    const yard = hq().yard, from = hq().stopS;
    const towardsPolar = net.route(yard, from, [{ seg: polar.f[0], s: polar.f[0].path.nearest(900, -19400).s + 3000 }]);
    const towardsKestrel = net.route(yard, from, net.stationGoals(kestrel));
    const ways = new Set<Seg>();
    for (const [what, r, onto] of [['Polar Express', towardsPolar, link.f], ['Kestrel Station', towardsKestrel, link.r]] as const) {
      expect(r, what).not.toBeNull();
      expect(r!.trans.some((t) => t.kind === 'uturn' || t.kind === 'dock'), what).toBe(false);
      // out of the yard and straight onto the link carriageway that goes there
      const join = r!.trans.find((t) => t.type === 'merge')!;
      expect(onto, what).toContain(join.to);
      expect(r!.trans.indexOf(join), what).toBeLessThanOrEqual(1);
      expect(r!.distance, what).toBeLessThan(6000);
      ways.add(join.from);
    }
    expect(ways.size).toBe(2);
  });
});

describe('routing past Police HQ', () => {
  it('never turns a rig round through HQ, even where that would be the quickest way back to Kestrel Station', () => {
    const kestrel = net.byId.kestrel;
    for (const s of [100, 300, 500]) {
      const r = net.route(link.f[0], s, net.stationGoals(kestrel));
      if (r) expect(entersHQ(r), `northbound at ${s}`).toBe(false);
    }
    for (const s of [100, 500, 900]) {
      const r = net.route(link.r[0], s, net.stationGoals(kestrel));
      expect(r && entersHQ(r), `southbound at ${s}`).toBe(false);
    }
  });

  it('never routes through HQ between stations, from anywhere on the link, in a route comparison or via a waypoint', () => {
    for (const a of net.stations) for (const b of net.stations) if (a !== b) for (const seg of a.dep) {
      const r = net.route(seg, 150, net.stationGoals(b));
      if (r) expect(entersHQ(r), `${a.name} → ${b.name} by ${seg.name}`).toBe(false);
      for (const opt of net.compareRoutes([{ seg, s: 150 }], net.stationGoals(b))) expect(entersHQ(opt.route), `compared ${a.name} → ${b.name}`).toBe(false);
    }
    for (const chain of [link.f, link.r]) for (const s of [50, 400, 800, 1200, 1600]) for (const st of net.stations) {
      const r = net.route(chain[0], s, net.stationGoals(st));
      if (r) expect(entersHQ(r), `${chain[0].name} ${s} → ${st.name}`).toBe(false);
    }
    // a waypoint on the link, either side of the spur
    for (const y of [-17300, -18200]) {
      const via = net.waypointGoals(900, y);
      for (const st of net.stations) for (const seg of net.byId.harbor.dep) {
        const r = net.routeVia(seg, 150, via, net.stationGoals(st));
        if (r) expect(entersHQ(r), `via ${y} → ${st.name}`).toBe(false);
      }
    }
  });

  it('does not take a waypoint set on HQ itself', () => {
    const via = net.waypointGoals(hq().x + 400, hq().y, 600);
    expect(via.length).toBeGreaterThan(0);
    expect(via.some((g) => g.seg.hq)).toBe(false);
  });
});

describe('Police HQ on the sector map', () => {
  it('is what inspection finds there, by its stable ID, and is described as Police HQ', () => {
    const info = net.inspect(hq().x, hq().y, 40);
    expect(info).toMatchObject({ kind: 'facility', id: 'hq:kestrel', name: 'Police HQ', facility: 'police-hq' });
    expect(describeInspection(info!)).toMatchObject({ title: 'Police HQ' });
  });

  it('is marked and labelled Police HQ', () => {
    expect(mapFeatures(net)).toContainEqual(expect.objectContaining({ id: 'hq:kestrel', kind: 'police-hq', name: 'Police HQ' }));
  });
});
