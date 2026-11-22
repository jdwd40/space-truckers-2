import { describe, expect, it, vi } from 'vitest';
vi.mock('./state', () => ({ SPEEDS: [0, 90, 150, 215, 280, 345] }));
import { Network, PASS_THROUGH_TIME, type Route, type Seg, type Station } from './network';
import { Traffic, type PlayerCtl } from './traffic';

/** Kestrel Link: a link road from Kestrel Station north to a junction on Polar Express. */
const net = new Network();
const road = (name: string) => net.roads.find((r) => r.name === name)!;
const station = (name: string) => net.stations.find((s) => s.name === name)!;

describe('Kestrel Link', () => {
  it('is a 2-lane road posted at 4 that leaves and enters Kestrel Station by its own gates', () => {
    const link = road('Kestrel Link'), kestrel = station('Kestrel Station');
    expect(link).toBeDefined();
    expect(kestrel.dep).toContain(link.f[0]);
    expect(kestrel.arr).toContain(link.r[link.r.length - 1]);
    for (const chain of [link.f, link.r]) {
      expect(Math.max(...chain.map((seg) => seg.lanes))).toBe(2);
      expect(Math.max(...chain.flatMap((seg) => [...seg.limits]))).toBe(4);
      expect(net.limitSigns.some((sign) => chain.includes(sign.seg) && sign.limit === 4)).toBe(true);
    }
    // about 3 km north from the station gate onto Polar Express, near its middle (x≈900, y≈−19,400)
    const polar = road('Polar Express');
    const onto = net.route(link.f[0], 0, [{ seg: polar.f[0], s: polar.f[0].path.nearest(900, -19400).s + 2000 }])!;
    const join = onto.trans[onto.trans.length - 1];
    expect(onto.distance - (onto.goal.s - join.toS)).toBeGreaterThan(2500);
    expect(onto.distance - (onto.goal.s - join.toS)).toBeLessThan(3500);
    const at = join.to.path.at(join.toS);
    expect(Math.abs(at.x - 900)).toBeLessThan(2000);
    expect(Math.abs(at.y + 19400)).toBeLessThan(200);
  });

  /** the slip roads of the junction, keyed by turn: [from carriageway, to carriageway, route] */
  const turns = () => {
    const link = road('Kestrel Link'), polar = road('Polar Express');
    const mid = (seg: Seg) => seg.path.nearest(900, -19400).s;
    const east = polar.f[0], west = polar.r[0], north = link.f[0], south = link.r[0];
    const r = (seg: Seg, s: number, goal: Seg, gs: number) => net.route(seg, s, [{ seg: goal, s: gs }]);
    return {
      'north onto Polar Express east': r(north, 200, east, mid(east) + 3000),
      'north onto Polar Express west': r(north, 200, west, mid(west) + 3000),
      'Polar Express east onto south': r(east, mid(east) - 5000, south, south.len - 400),
      'Polar Express west onto south': r(west, mid(west) - 5000, south, south.len - 400),
    };
  };

  it('allows all four turns at the Polar Express junction, each by its own slip road and without a pass-through', () => {
    const ramps = new Set<Seg>();
    for (const [name, r] of Object.entries(turns())) {
      expect(r, name).not.toBeNull();
      expect(r!.trans.some((t) => t.kind === 'dock' || t.kind === 'uturn'), name).toBe(false);
      const slips = r!.trans.map((t) => t.to).filter((seg) => seg.kind === 'ramp');
      expect(slips, name).toHaveLength(1);
      ramps.add(slips[0]);
      // a few km at most: the turn is made at the junction, not by a detour
      expect(r!.distance, name).toBeLessThan(9000);
    }
    expect(ramps.size).toBe(4);
  });

  it('is grade-separated: wherever a slip road crosses another carriageway it is on its own deck', () => {
    const ramps = Object.values(turns()).map((r) => r!.trans.map((t) => t.to).find((seg) => seg.kind === 'ramp')!);
    const near = (a: Seg, b: Seg) => {
      // points of a's path within b's paved width, away from where a joins or leaves b
      const half = (b.lanes * b.laneW) / 2 + 10;
      return a.path.pts(0, a.len, 0, 40).some((p) => {
        const n = b.path.nearest(p.x, p.y);
        return n.d < half && n.s > 30 && n.s < b.len - 30 && Math.hypot(p.x - a.path.at(0).x, p.y - a.path.at(0).y) > 200 &&
          Math.hypot(p.x - a.path.at(a.len).x, p.y - a.path.at(a.len).y) > 200;
      });
    };
    const others = [...road('Polar Express').f, ...road('Polar Express').r, ...road('Kestrel Link').f, ...road('Kestrel Link').r, ...ramps];
    let crossings = 0;
    for (const a of ramps) for (const b of others) {
      if (a === b || !near(a, b)) continue;
      crossings++;
      expect(a.level, `${a.name} over ${b.name}`).not.toBe(b.level);
    }
    // both left turns cross Polar Express
    expect(crossings).toBeGreaterThanOrEqual(2);
  });

  it('signs every turn: gantries before each exit from Polar Express, and both destinations on the link', () => {
    const gantryText = (chain: Seg[]) => net.signs.filter((sg) => chain.includes(sg.seg) && sg.kind === 'gantry').flatMap((sg) => sg.panels.map((p) => `${p.title} ${p.sub ?? ''}`));
    const polar = road('Polar Express');
    for (const chain of [polar.f, polar.r]) {
      expect(gantryText(chain).filter((t) => t.includes('Kestrel Station') && t.includes('Kestrel Link')).length).toBeGreaterThanOrEqual(2);
    }
    const onLink = gantryText(road('Kestrel Link').f);
    expect(onLink.some((t) => t.includes('Harbor Prime'))).toBe(true);
    expect(onLink.some((t) => t.includes('Glacier Outpost'))).toBe(true);
  });
});

describe('routing with Kestrel Link', () => {
  const harbor = station('Harbor Prime'), glacier = station('Glacier Outpost'), kestrel = station('Kestrel Station');
  const link = road('Kestrel Link');
  const uses = (r: Route, name: string) => r.trans.some((t) => t.to.road === name || t.from.road === name);
  const fastest = (from: Seg[], to: Station) => from.map((seg) => net.route(seg, 150, net.stationGoals(to))).filter((r): r is Route => r !== null).sort((a, b) => a.cost - b.cost)[0];

  it('does not give Harbor Prime–Glacier Outpost a faster legal route than Polar Express, either way', () => {
    for (const [a, b] of [[harbor, glacier], [glacier, harbor]]) {
      const best = fastest(a.dep, b);
      expect(uses(best, 'Kestrel Link'), `${a.name} → ${b.name}`).toBe(false);
      expect(best.trans.some((t) => t.kind === 'dock'), `${a.name} → ${b.name}`).toBe(false);
      // the two mixed routes, through Kestrel Station: Polar Express and the link one way, Harbor Run or Frost Line the other
      const polar = a.dep.find((seg) => seg.road === 'Polar Express')!;
      const kestrelRoad = a.dep.find((seg) => seg.road === 'Harbor Run' || seg.road === 'Frost Line')!;
      const polarToKestrel = net.route(polar, 150, net.stationGoals(kestrel))!;
      expect(uses(polarToKestrel, 'Kestrel Link'), 'Polar Express to Kestrel Station uses the link').toBe(true);
      const viaLinkFirst = polarToKestrel.cost + PASS_THROUGH_TIME + fastest(kestrel.dep.filter((seg) => seg !== link.f[0]), b).cost;
      const viaLinkLast = net.route(kestrelRoad, 150, net.stationGoals(kestrel))!.cost + PASS_THROUGH_TIME + net.route(link.f[0], 150, net.stationGoals(b))!.cost;
      console.log(`${a.name} → ${b.name}: Polar ${best.cost.toFixed(1)} s, Polar then link ${viaLinkFirst.toFixed(1)} s, link then Polar ${viaLinkLast.toFixed(1)} s`);
      expect(viaLinkFirst).toBeGreaterThan(best.cost * 1.15);
      expect(viaLinkLast).toBeGreaterThan(best.cost * 1.15);
    }
  });

  it('keeps every station reachable from every other', () => {
    for (const a of net.stations) for (const b of net.stations) if (a !== b) {
      expect(a.dep.some((seg) => net.route(seg, 150, net.stationGoals(b)) !== null), `${a.name} → ${b.name}`).toBe(true);
    }
  });

  it('sends AI traffic along the link: from Polar Express to Kestrel Station, and from the link gate onto Polar Express', () => {
    const ctl: PlayerCtl = { desired: () => 345, extraGap: () => Infinity, obeySignal: () => true, brakeMin: () => null, onTrans() {}, onBlocked() {}, onRouteNeeded() {} };
    const traffic = new Traffic(net, ctl);
    expect(net.spawnSegs.some((sp) => sp.seg === link.f[0])).toBe(true);
    for (const polar of [harbor, glacier].map((st) => st.dep.find((seg) => seg.road === 'Polar Express')!)) {
      const npc = traffic.add('van', polar, 2000, 0, 300);
      npc.dest = kestrel.id;
      traffic.reroute(npc);
      expect(npc.route.some((t) => t.to.road === 'Kestrel Link'), `${polar.name} to Kestrel`).toBe(true);
    }
    for (const dest of [harbor, glacier]) {
      const npc = traffic.add('rig', link.f[0], 300, 0, 200);
      npc.dest = dest.id;
      traffic.reroute(npc);
      expect(npc.goal, dest.name).not.toBeNull();
      expect(npc.route.some((t) => t.to.road === 'Polar Express'), dest.name).toBe(true);
    }
  });
});
