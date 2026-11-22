import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Events: { EventEmitter: class { emit() {} } },
    Geom: { Point: class { constructor(public x: number, public y: number) {} } },
  },
}));

import { Network, type Seg } from './network';
import { Traffic, type PlayerCtl } from './traffic';
import { Incidents } from './incidents';
import { openLanes, Roadworks } from './roadworks';

afterEach(() => { vi.restoreAllMocks(); });

const net = new Network();
const road = (name: string) => net.roads.find((r) => r.name === name)!;
/** a point on the middle lane of a carriageway, `at` metres along that section */
const onLanes = (seg: Seg, at: number) => seg.path.at(at, 0);

describe('inspecting a road on the sector map', () => {
  it('names the road and carriageway under a point, with its posted limit and the cameras on that carriageway', () => {
    const f = road('Polar Express').f[0];
    const p = onLanes(f, f.len * 0.5);
    const info = net.inspect(p.x, p.y);
    expect(info?.kind).toBe('road');
    if (info?.kind !== 'road') return;
    expect(info.road).toBe('Polar Express');
    expect(info.towards).toBe('Glacier Outpost');
    expect(info.limit).toBe(5);
    expect(info.cameras).toHaveLength(2);
    expect(info.cameras.every((c) => c.seg.road === 'Polar Express' && road('Polar Express').f.includes(c.seg))).toBe(true);
  });

  it('gives the Kestrel route its lower limit and fewer cameras', () => {
    const hr = road('Harbor Run').r[0];
    const p = onLanes(hr, hr.len * 0.5);
    const info = net.inspect(p.x, p.y);
    expect(info).toMatchObject({ kind: 'road', road: 'Harbor Run', towards: 'Harbor Prime', limit: 4 });
    if (info?.kind === 'road') expect(info.cameras).toHaveLength(1);
    const fl = road('Frost Line').f[0];
    const q = onLanes(fl, 2000);
    const frost = net.inspect(q.x, q.y);
    expect(frost).toMatchObject({ kind: 'road', road: 'Frost Line', towards: 'Glacier Outpost' });
    if (frost?.kind === 'road') expect(frost.cameras).toHaveLength(0);
  });

  it('uses the carriageway name where the road has one', () => {
    const m1 = road('M1').f[0];
    const p = onLanes(m1, 4000);
    expect(net.inspect(p.x, p.y)).toMatchObject({ kind: 'road', road: 'M1', carriageway: 'M1 East', towards: 'Jove Gasport' });
  });

  it('finds a road within the tap radius but nothing in open space', () => {
    const f = road('Polar Express').f[0];
    const p = f.path.at(f.len * 0.5, 250);
    expect(net.inspect(p.x, p.y)).toBeNull();
    expect(net.inspect(p.x, p.y, 300)).toMatchObject({ kind: 'road', road: 'Polar Express' });
    expect(net.inspect(-8000, 8000, 300)).toBeNull();
  });
});

describe('inspecting a facility on the sector map', () => {
  it('names a Fuel & Repair facility and lists its pumps and repair bay', () => {
    const info = net.inspect(...xy('services:frost-fuel'));
    expect(info).toMatchObject({ kind: 'facility', id: 'services:frost-fuel', name: 'Frost Fuel', facility: 'fuel-repair' });
    if (info?.kind === 'facility') expect(info.services).toEqual(['Fuel · 2 pumps', 'Repair bay']);
  });

  it('names a plain fuel stop without a repair bay', () => {
    const info = net.inspect(...xy('services:icicle-stop'));
    expect(info).toMatchObject({ kind: 'facility', name: 'Icicle Stop', facility: 'fuel' });
    if (info?.kind === 'facility') expect(info.services).toEqual(['Fuel · 2 pumps']);
  });

  it('names a lay-by and what it offers, even when the tap lands on the carriageway beside it', () => {
    const lb = net.laybys.find((l) => l.seg.road === 'Polar Express')!;
    const beside = lb.seg.path.at(lb.seg.path.nearest(lb.x, lb.y).s, 0);
    const info = net.inspect(beside.x, beside.y, 120);
    expect(info).toMatchObject({ kind: 'facility', id: lb.id, name: lb.name, facility: 'layby' });
    if (info?.kind === 'facility') expect(info.services).toEqual(['Lay-by', 'Passengers']);
  });
});

describe('inspecting a lane closure on the sector map', () => {
  /** the first place on M2 South where the two left lanes may be closed */
  function roadworks() {
    const fresh = new Network(), works = new Roadworks(fresh);
    const m2 = fresh.roads.find((r) => r.name === 'M2')!;
    for (const seg of m2.f) for (let s0 = 1000; s0 + 1200 < seg.len; s0 += 100) {
      const lanes = [0, 1];
      if (openLanes(fresh, seg, s0, s0 + 1200, lanes)) return { net: fresh, seg, s0, site: works.add(seg, s0, s0 + 1200, lanes)! };
    }
    throw new Error('no roadworks layout on M2 South');
  }

  it('shows which lanes roadworks close, over the road under it', () => {
    const { net: n, seg, s0, site } = roadworks();
    const p = seg.path.at(s0 + 600, seg.laneLat(0));
    const info = n.inspect(p.x, p.y);
    expect(info).toMatchObject({ kind: 'roadworks', road: 'M2', carriageway: 'M2 South', lanes: seg.lanes, closed: site.lanes, open: site.open });
    if (info?.kind === 'roadworks') expect(info.status).toBe('2 left lanes closed · keep right');
    // the open lanes beside the barrier are part of the site too, and so is a finger's width either side of it
    const q = seg.path.at(s0 + 900, seg.laneLat(seg.lanes - 1));
    expect(n.inspect(q.x, q.y, 100)?.kind).toBe('roadworks');
    const past = seg.path.at(s0 + 1200 + 800, 0);
    expect(n.inspect(past.x, past.y)?.kind).toBe('road');
  });

  it('lists roadworks among the closures the map marks', () => {
    const { net: n, site } = roadworks();
    expect(n.closures()).toEqual([expect.objectContaining({ kind: 'roadworks', road: 'M2', closed: site.lanes })]);
  });

  /** the player breaks down in the right lane of M1 East among no other traffic */
  function breakdown() {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fresh = new Network(), seg = fresh.roads.find((r) => r.name === 'M1')!.f[0];
    const ctl: PlayerCtl = {
      desired: () => 0, extraGap: () => Infinity, obeySignal: () => true,
      brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
    };
    const tr = new Traffic(fresh, ctl);
    tr.spawnT.fill(Infinity); tr.localT = Infinity;
    const inc = new Incidents(fresh, tr, { playerCrashed() {}, playerReleased() {}, bump() {} });
    const s = 6000, lane = seg.lanes - 1;
    const p = tr.add('player', seg, s, lane, 0);
    tr.player = p;
    const at = seg.path.at(s);
    tr.view = { x: at.x, y: at.y, r: 20000 };
    const run = (seconds: number, until: () => boolean = () => false) => {
      for (let t = 0; t < seconds && !until(); t += 0.05) { tr.update(0.05); inc.update(0.05, false); }
    };
    const incident = inc.playerBreakdown()!;
    run(12, () => incident.phase !== 'stopping');
    return { net: fresh, seg, s, lane, incident, run, at: seg.path.at(s - 100, seg.laneLat(lane)) };
  }

  it('shows an active incident and the lane it closes', () => {
    const { net: n, seg, lane, incident, at } = breakdown();
    expect(incident.phase).toBe('wait');
    const info = n.inspect(at.x, at.y);
    expect(info).toMatchObject({ kind: 'incident', incident: 'breakdown', road: 'M1', carriageway: 'M1 East', lanes: seg.lanes, closed: [lane] });
    if (info?.kind === 'incident') expect(info.status).toBe('Right lane closed');
    expect(n.closures()).toEqual([expect.objectContaining({ kind: 'incident', incident: 'breakdown' })]);
  });

  it('forgets an incident once it is cleared', () => {
    const { net: n, incident, run, at } = breakdown();
    run(400, () => incident.done);
    expect(incident.done).toBe(true);
    expect(n.closures()).toEqual([]);
    expect(n.inspect(at.x, at.y)?.kind).toBe('road');
  });
});

describe('the next exit on a carriageway', () => {
  const m1 = road('M1').f;

  it('is the first exit ahead, with how far it is', () => {
    const next = net.nextExit(m1[0], 100);
    expect(next).toMatchObject({ label: 'Nebula Services', kind: 'services' });
    expect(next!.d).toBeCloseTo(5100, 0);
  });

  it('skips an exit too close to reach unless the rig is already in its exit lane', () => {
    expect(net.nextExit(m1[0], 5150)).toMatchObject({ label: 'Terra Nova', kind: 'uturn' });
    expect(net.nextExit(m1[0], 5150)!.d).toBeCloseTo(10200 - 5150, 0);
    expect(net.nextExit(m1[0], 5150, 1)).toMatchObject({ label: 'Nebula Services' });
  });

  it('looks on along the carriageway into the next section', () => {
    const next = net.nextExit(m1[0], 8000)!;
    expect(next).toMatchObject({ label: 'Terra Nova', kind: 'uturn' });
    expect(next.d).toBeCloseTo(2200, 0);
    // and it is drawn where the exit leaves the carriageway
    const p = next.trans.from.path.at(next.trans.fromS);
    expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeLessThan(150);
  });

  it('is the junction exit when that comes first', () => {
    expect(net.nextExit(m1[1], 12963 - m1[0].len - 2000)).toMatchObject({ label: 'Meridian Bypass', kind: 'jct' });
  });

  it('is nothing past the last exit before a station, or off the carriageway', () => {
    const last = m1[m1.length - 1];
    expect(net.nextExit(last, 22000 - m1[0].len - m1[1].len + 200)).toBeNull();
    const ramp = net.segs.find((s) => s.kind === 'ramp')!;
    expect(net.nextExit(ramp, 10)).toBeNull();
  });
});

function xy(id: string): [number, number] {
  const f = net.facility(id)!;
  return [f.x, f.y];
}
