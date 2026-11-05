import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Events: { EventEmitter: class { emit() {} } },
    Geom: { Point: class { constructor(public x: number, public y: number) {} } },
  },
}));

import { Network, type Seg } from './network';
import { Traffic, type PlayerCtl, type Veh } from './traffic';
import { Incidents, type Incident } from './incidents';

/** the cordon runs this far behind the rearmost casualty and ahead of the foremost one */
const CONES_BEHIND = 430, CONES_AHEAD = 170;
/** police and repair truck park this far ahead of the foremost casualty */
const POLICE_AHEAD = 52, TOW_AHEAD = 110;

function scene(roadName: string, side: 'f' | 'r', index: number) {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const net = new Network(), road = net.roads.find(r => r.name === roadName)!;
  const seg = road[side][index], next = seg.next!;
  const drive = { speed: 345 };
  const ctl: PlayerCtl = {
    desired: () => drive.speed, extraGap: () => Infinity, obeySignal: () => true,
    brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
  };
  const tr = new Traffic(net, ctl);
  tr.spawnT.fill(Infinity); tr.localT = Infinity;
  const inc = new Incidents(net, tr, { playerCrashed() {}, playerReleased() {}, bump() {} });
  const run = (seconds: number, until: () => boolean = () => false) => {
    for (let t = 0; t < seconds && !until(); t += 0.05) { tr.update(0.05); inc.update(0.05, false); }
  };
  const player = (section: Seg, s: number, lane: number, v: number) => {
    const p = tr.add('player', section, s, lane, v);
    p.setTrailers([50, 50]);
    tr.player = p;
    const at = section.path.at(s);
    tr.view = { x: at.x, y: at.y, r: 20000 };
    return p;
  };
  /** a stationary ship that still counts as moving traffic, so a collision makes it a casualty too */
  const standing = (section: Seg, s: number, lane: number) => {
    const v = tr.add('van', section, s, lane, 0);
    v.age = 8; v.vDes = 0;
    return v;
  };
  /** ordinary traffic that stays in its lane, whatever is ahead */
  const lanekeeper = (section: Seg, s: number, lane: number, v = 250) => {
    const o = tr.add('van', section, s, lane, v);
    o.age = 8; o.decideT = Infinity;
    return o;
  };
  return { net, road, seg, next, tr, inc, run, player, standing, lanekeeper, drive };
}
type Scene = ReturnType<typeof scene>;

/** the repro: the player coasts over the join and the van it hit stays behind it */
function straddle(w: Scene, lane = 0) {
  const { seg, next, inc, run } = w;
  const p = w.player(seg, seg.len - 20, lane, 345);
  const van = w.standing(seg, seg.len - 5, lane);
  run(1);
  const incident = inc.playerIncident()!;
  expect(incident.cas).toEqual([p, van]);
  expect(incident.phase).toBe('wait');
  expect(p.seg).toBe(next);
  expect(van.seg).toBe(seg);
  return { p, van, incident };
}

const blocksOf = (incident: Incident, section: Seg) => section.blocks.filter(b => b.inc === incident);
/** every closed stretch of one lane, in distance from the start of `from`, upstream first */
function closed(w: Scene, incident: Incident, from: Seg, lane: number) {
  const spans: [number, number][] = [];
  for (let seg: Seg | null = from, off = 0; seg; off += seg.len, seg = seg.next)
    for (const b of blocksOf(incident, seg)) if (b.lane === lane) spans.push([off + b.s0, off + b.s1]);
  return spans;
}
const expectCrewParked = (w: Scene, incident: Incident, crew: Veh, ahead: number) => {
  const want = w.net.place(incident.seg, incident.front + ahead);
  expect(crew.dead).toBe(false);
  expect(crew.seg).toBe(want.seg);
  expect(crew.v).toBeLessThan(3);
  expect(Math.abs(want.s - crew.s)).toBeLessThan(40);
};
const allBlocks = (net: Network) => net.segs.flatMap(s => s.blocks);

afterEach(() => { vi.restoreAllMocks(); });

const JOINS = [
  ['M1 eastbound gaining a lane', 'M1', 'f', 0],
  ['M1 eastbound dropping a lane', 'M1', 'f', 1],
  ['M1 westbound gaining a lane', 'M1', 'r', 0],
  ['M1 westbound dropping a lane', 'M1', 'r', 1],
  ['Ore Road dropping a lane', 'Ore Road', 'f', 0],
  ['Ore Road gaining a lane', 'Ore Road', 'r', 1],
] as const;

describe.each(JOINS)('incident straddling a section join: %s', (_label, roadName, side, index) => {
  it('measures the casualties along one road distance and cones only their surroundings', () => {
    const w = scene(roadName, side, index), { seg, next, road } = w;
    expect(seg.lanes).not.toBe(next.lanes);
    const { p, van, incident } = straddle(w);
    expect(incident.seg).toBe(seg);
    const nose = seg.len + p.s, tail = Math.min(van.s - van.totLen, seg.len + p.s - p.totLen);
    expect(incident.front).toBeCloseTo(nose, 6);
    expect(incident.rear).toBeCloseTo(tail, 6);
    expect(incident.front - incident.rear).toBeLessThan(300);
    // the closure is one continuous stretch across the join, on both sections and nowhere else
    const [upstream, downstream] = closed(w, incident, seg, 0);
    expect(upstream[0]).toBeCloseTo(tail - CONES_BEHIND, 6);
    expect(upstream[1]).toBeCloseTo(seg.len, 6);
    expect(downstream[0]).toBeCloseTo(seg.len, 6);
    expect(downstream[1]).toBeCloseTo(nose + CONES_AHEAD, 6);
    expect(blocksOf(incident, seg)).toHaveLength(1);
    expect(blocksOf(incident, next)).toHaveLength(1);
    expect(allBlocks(w.net)).toHaveLength(2);
    for (const b of [...seg.blocks]) { expect(b.s0).toBeGreaterThanOrEqual(0); expect(b.s1).toBeLessThanOrEqual(seg.len); }
    const other = side === 'f' ? road.r : road.f;
    expect(other.flatMap(s => s.blocks)).toEqual([]);
  });

  it('holds approaching traffic behind the cones, and lets it use the open lanes across the join', () => {
    const w = scene(roadName, side, index), { seg, next, tr } = w;
    const { incident } = straddle(w);
    const start = seg.blocks[0].s0;
    const held = w.lanekeeper(seg, start - 900, 0);
    const behind = w.lanekeeper(seg, start - 1100, 0);
    const passing = w.lanekeeper(seg, start - 900, 1);
    const away = w.lanekeeper(next, incident.front - seg.len + CONES_AHEAD + 300, 0);
    const before = away.s;
    w.run(14);
    expect(held.seg).toBe(seg);
    expect(held.s).toBeLessThanOrEqual(start + 1);
    expect(held.s).toBeGreaterThan(start - 60);
    expect(held.v).toBeLessThan(1);
    expect(behind.s).toBeLessThan(held.s - held.totLen);
    expect(behind.v).toBeLessThan(2);
    expect(passing.seg).toBe(next);
    expect(passing.v).toBeGreaterThan(30);
    expect(away.s).toBeGreaterThan(before + 300);
    expect(tr.laneClosed(seg, 0, start - 100)).toBe(true);
    expect(tr.laneClosed(next, 1, 0)).toBe(false);
  });

  it('sends the crews over the join to park ahead of the casualties, then clears every section', () => {
    const w = scene(roadName, side, index), { seg, next, inc, net, run } = w;
    const { p, van, incident } = straddle(w);
    run(90, () => incident.phase === 'repair');
    expect(incident.phase).toBe('repair');
    expect(incident.policeHere && incident.towHere).toBe(true);
    const police = incident.police!, tow = incident.tow!;
    expect(police.seg).toBe(next);
    expectCrewParked(w, incident, police, POLICE_AHEAD);
    expectCrewParked(w, incident, tow, TOW_AHEAD);
    // nose to tail in the closed lane, clear of the wreck
    for (const crew of [police, tow]) { expect(crew.lane).toBe(0); expect(crew.s - crew.totLen).toBeGreaterThan(p.s); }
    expect(tow.s - tow.totLen).toBeGreaterThanOrEqual(police.s - 40);
    run(40, () => incident.phase === 'clear');
    expect(incident.phase).toBe('clear');
    expect(p.state).toBe('drive');
    expect(['leave', 'drive']).toContain(van.state);
    expect(seg.blocks.length + next.blocks.length).toBe(2);
    const parked = [police.s, tow.s];
    run(12, () => incident.done);
    expect(incident.done).toBe(true);
    expect(inc.list).toEqual([]);
    expect(allBlocks(net)).toEqual([]);
    for (const crew of [police, tow]) {
      expect(crew.emergency || crew.siren || crew.ignoreBlock).toBe(false);
      expect(crew.resp).toBeNull();
      expect(crew.stopAt).toBeNull();
    }
    expect(police.seg === next ? police.s : Infinity).toBeGreaterThan(parked[0] + 100);
    expect(tow.seg === next ? tow.s : Infinity).toBeGreaterThan(parked[1] + 100);
    expect(van.v).toBeGreaterThan(0);
  });
});

describe('casualties in a lane that ends at the join', () => {
  it.each([['M1', 'f', 1], ['M1', 'r', 1]] as const)('closes only lanes that exist on each section of %s %s', (roadName, side, index) => {
    const w = scene(roadName, side, index), { seg, next, run } = w;
    const outer = seg.lanes - 1;
    expect(next.lanes).toBe(outer);
    const { p, incident } = straddle(w, outer);
    expect(p.lane).toBe(outer - 1); // the rig slid across to the nearest lane that carries on
    expect(incident.lanes).toEqual([outer - 1, outer]);
    expect(seg.blocks.map(b => b.lane).sort()).toEqual([outer - 1, outer]);
    expect(next.blocks.map(b => b.lane)).toEqual([outer - 1]);
    run(90, () => incident.phase === 'repair');
    expect(incident.policeHere && incident.towHere).toBe(true);
    for (const crew of [incident.police!, incident.tow!]) expect(crew.lane).toBeLessThan(next.lanes);
    expectCrewParked(w, incident, incident.police!, POLICE_AHEAD);
    expectCrewParked(w, incident, incident.tow!, TOW_AHEAD);
  });
});

describe('a crash inside the taper of a lane that ends', () => {
  it.each(['f', 'r'] as const)('parks the crews on their marks on M1 %s, not at the head of the merge queue', side => {
    const w = scene('M1', side, 1), { seg, run } = w;
    const lane = seg.lanes - 1;
    w.player(seg, seg.len - 300, lane, 345);
    w.standing(seg, seg.len - 285, lane);
    run(1);
    const incident = w.inc.playerIncident()!;
    expect(incident.lanes).toEqual([lane]);
    run(90, () => incident.phase === 'repair');
    expect(incident.policeHere && incident.towHere).toBe(true);
    run(2);
    for (const [crew, ahead] of [[incident.police!, POLICE_AHEAD], [incident.tow!, TOW_AHEAD]] as const) {
      expect(crew.s).toBeGreaterThan(incident.front + ahead - 12);
      expect(crew.s).toBeLessThan(incident.front + ahead + 1);
    }
  });
});

describe('a cordon that reaches a join without a casualty on the far side', () => {
  it('extends upstream onto the previous section for a rig whose tail is still on it', () => {
    const w = scene('M1', 'f', 0), { seg, next, inc, run } = w;
    const p = w.player(next, 40, 0, 0);
    const incident = inc.playerBreakdown()!;
    run(0.2);
    expect(incident.seg).toBe(next);
    expect(incident.front).toBeCloseTo(40, 6);
    expect(incident.rear).toBeCloseTo(40 - p.totLen, 6);
    const [up] = blocksOf(incident, seg), [down] = blocksOf(incident, next);
    expect(up.s0).toBeCloseTo(seg.len + 40 - p.totLen - CONES_BEHIND, 6);
    expect(up.s1).toBeCloseTo(seg.len, 6);
    expect(down.s0).toBe(0);
    expect(down.s1).toBeCloseTo(40 + CONES_AHEAD, 6);
    run(90, () => incident.phase === 'repair');
    expectCrewParked(w, incident, incident.police!, POLICE_AHEAD);
    expectCrewParked(w, incident, incident.tow!, TOW_AHEAD);
  });

  it('queues traffic on the near side of the join for cones that begin just beyond it', () => {
    const w = scene('M1', 'r', 0), { seg, next, inc, tr, run } = w;
    const start = 30;
    const p = w.player(next, start + CONES_BEHIND + 134, 0, 0);
    expect(p.totLen).toBe(134);
    const incident = inc.playerBreakdown()!;
    run(0.2);
    expect(seg.blocks).toEqual([]);
    expect(next.blocks[0].s0).toBeCloseTo(start, 6);
    // warned, and shown the lane as closed, before reaching the join
    expect(tr.laneClosed(seg, 0, seg.len - 800)).toBe(true);
    expect(tr.laneClosed(seg, 1, seg.len - 800)).toBe(false);
    expect(inc.hazardAhead(seg, seg.len - 800)?.inc).toBe(incident);
    expect(inc.hazardAhead(seg, seg.len - 800)?.d).toBeCloseTo(800 + start, 6);
    expect(inc.laneBlockedAhead(seg, 0, seg.len - 800, 2000)?.d).toBeCloseTo(800 + start, 6);
    expect(inc.laneBlockedAhead(seg, 1, seg.len - 800, 2000)).toBeNull();
    expect(inc.inSlowZone(seg, seg.len - 100)).toBe(true);
    expect(inc.inSlowZone(seg, seg.len - 300)).toBe(false);
    const first = w.lanekeeper(seg, seg.len - 700, 0);
    const second = w.lanekeeper(seg, seg.len - 900, 0);
    run(9);
    const distance = (v: Veh) => v.seg === next ? v.s : v.s - seg.len;
    expect(distance(first)).toBeLessThanOrEqual(start + 1);
    expect(first.v).toBeLessThan(1);
    expect(distance(second)).toBeLessThan(distance(first) - first.totLen);
    expect(second.seg).toBe(seg);
    expect(second.v).toBeLessThan(2);
  });

  it('steers traffic out of the closed lane before the join', () => {
    const w = scene('M1', 'f', 1), { seg, next, inc, run } = w;
    w.player(next, 30 + CONES_BEHIND + 134, 0, 0);
    inc.playerBreakdown();
    run(0.2);
    const car = w.lanekeeper(seg, seg.len - 1300, 0);
    car.decideT = 0;
    run(3);
    expect(car.seg).toBe(seg);
    expect(car.lane).toBe(1);
  });

  it('keeps ordinary spawns out of a lane closed just past the join', () => {
    const w = scene('M1', 'f', 0), { seg, next, inc, tr, run } = w;
    w.player(next, 30 + CONES_BEHIND + 134, 0, 0);
    inc.playerBreakdown();
    run(0.2);
    expect(tr.spawnNPC(seg, seg.len - 100, true, 0, 'van')).toBeNull();
    expect(tr.spawnNPC(seg, seg.len - 100, true, 1, 'van')).not.toBeNull();
  });
});

describe('a second incident over the join from the wreck it hit', () => {
  function wreckAtJoin() {
    const w = scene('M1', 'f', 0), { seg, tr, inc, run } = w;
    w.drive.speed = 0;
    const p = w.player(seg, seg.len - 5000, 1, 0);
    const wreck = tr.add('van', seg, seg.len - 5, 0, 0);
    wreck.age = 8; wreck.state = 'broken'; wreck.hazard = true;
    const first: Incident = (inc as any).create('breakdown', seg, [wreck], false);
    run(0.2);
    expect(first.phase).toBe('wait');
    const crash = () => {
      p.s = seg.len - 20; p.lane = 0; p.lat = seg.laneLat(0); p.v = 345; p.resetTrail();
      w.drive.speed = 345;
      run(1);
      const second = inc.playerIncident()!;
      expect(second.phase).toBe('wait');
      expect(second.cas).toEqual([p]);
      expect(p.seg).toBe(w.next);
      return second;
    };
    return { ...w, p, wreck, first, crash };
  }

  it('leaves the player waiting while police finish the scene they already attend', () => {
    const w = wreckAtJoin(), { seg, next, first, net, run, crash } = w;
    run(30, () => !!first.police);
    expect(first.police).not.toBeNull();
    const second = crash();
    expect(second.waitFor).toBe(first);
    expect(second.front - second.rear).toBeLessThan(200);
    run(120, () => first.phase === 'clear');
    expect(first.phase).toBe('clear');
    expect(second.police).toBeNull();
    expect(second.tow).toBeNull();
    run(10, () => first.done);
    expect(first.done).toBe(true);
    // the first scene takes down its own cones only
    expect(seg.blocks.every(b => b.inc === second)).toBe(true);
    expect(blocksOf(second, next)).toHaveLength(1);
    run(90, () => second.phase === 'repair');
    expect(second.waitFor).toBeNull();
    expectCrewParked(w, second, second.police!, POLICE_AHEAD);
    expectCrewParked(w, second, second.tow!, TOW_AHEAD);
    run(40, () => second.done);
    expect(second.done).toBe(true);
    expect(allBlocks(net)).toEqual([]);
  });

  it('puts the player first when no crew has reached the original scene yet', () => {
    const w = wreckAtJoin(), { first, net, run, crash } = w;
    const second = crash();
    expect(first.waitFor).toBe(second);
    run(120, () => second.phase === 'clear');
    expect(second.phase).toBe('clear');
    expect(first.police).toBeNull();
    expect(first.tow).toBeNull();
    run(120, () => first.done && second.done);
    expect(first.done && second.done).toBe(true);
    expect(first.policeHere && first.towHere).toBe(true);
    expect(allBlocks(net)).toEqual([]);
  });
});

describe('drawing a scene over a join', () => {
  /** draw the scene and read back the cones and the waving officer, by the colour and size they are painted in */
  function render(w: Scene) {
    const cones: { x: number; y: number }[] = [], officers: { x: number; y: number }[] = [];
    let colour = 0;
    const deck = new Proxy({
      fillStyle(c: number) { colour = c; },
      fillCircle(x: number, y: number, r: number) {
        if (colour === 0xff7a1a && r === 6) cones.push({ x, y });
        if (colour === 0xffd23c && r === 8) officers.push({ x, y });
      },
    } as any, { get: (t, k) => t[k] ?? (() => {}) });
    const glow = new Proxy({}, { get: () => () => {} }) as any;
    w.inc.draw(Array(8).fill(deck), Array(8).fill(glow), 0, w.tr.view.x, w.tr.view.y, 20000);
    return { cones, officers };
  }
  const pointOn = (w: Scene, incident: Incident, s: number, lane: number) => {
    const at = w.net.place(incident.seg, s);
    return at.seg.path.at(at.s, at.seg.laneLat(lane));
  };
  const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it.each(['f', 'r'] as const)('lines the cones up to the casualties on both sections of M1 %s', side => {
    const w = scene('M1', side, 0), { seg, next, inc, run } = w;
    const p = w.player(next, 250 + 134, 0, 0);
    const incident = inc.playerBreakdown()!;
    run(0.2);
    expect(incident.rear).toBeCloseTo(250, 6);
    expect(blocksOf(incident, seg)).toHaveLength(1);
    const { cones } = render(w);
    const along = (c: { x: number; y: number }) => {
      const a = seg.path.nearest(c.x, c.y), b = next.path.nearest(c.x, c.y);
      return a.d < b.d ? a.s - seg.len : b.s;
    };
    const line = cones.map(along).sort((a, b) => a - b);
    expect(line[0]).toBeCloseTo(incident.rear - CONES_BEHIND + 24, -1);
    expect(line[line.length - 1]).toBeLessThan(incident.rear - 70 + 1);
    expect(line[line.length - 1]).toBeGreaterThan(incident.rear - 70 - 50);
    expect(line.some(s => s < 0) && line.some(s => s > 0)).toBe(true);
    for (let i = 1; i < line.length; i++) expect(line[i] - line[i - 1]).toBeLessThan(80);
    // each cone stands in the closed lane
    for (const c of cones) expect(gap(c, pointOn(w, incident, along(c), 0))).toBeLessThan(40);
    expect(p.seg).toBe(next);
  });

  it('keeps the cones behind casualties that stopped either side of the join, and the officer ahead of them', () => {
    const w = scene('M1', 'r', 1), { run } = w;
    const { incident } = straddle(w);
    const { cones } = render(w);
    expect(cones.length).toBeGreaterThan(5);
    for (const c of cones) {
      expect(gap(c, pointOn(w, incident, incident.rear, 0))).toBeGreaterThan(60);
      expect(gap(c, pointOn(w, incident, incident.rear, 0))).toBeLessThan(CONES_BEHIND);
    }
    run(90, () => incident.phase === 'repair');
    const { officers } = render(w);
    expect(officers).toHaveLength(1);
    expect(gap(officers[0], pointOn(w, incident, incident.front + 12, 0))).toBeLessThan(20);
  });
});

describe('an incident wholly inside one section', () => {
  it('keeps its plain section coordinates', () => {
    const w = scene('M1', 'f', 0), { seg, next, inc, run } = w;
    const p = w.player(seg, 4000, 1, 0);
    const incident = inc.playerBreakdown()!;
    run(0.2);
    expect(incident.front).toBeCloseTo(4000, 6);
    expect(incident.rear).toBeCloseTo(4000 - p.totLen, 6);
    expect(next.blocks).toEqual([]);
    expect(seg.blocks).toHaveLength(1);
    expect(seg.blocks[0].s0).toBeCloseTo(4000 - p.totLen - CONES_BEHIND, 6);
    expect(seg.blocks[0].s1).toBeCloseTo(4000 + CONES_AHEAD, 6);
    run(90, () => incident.phase === 'repair');
    expect(incident.police!.stopAt).toBeCloseTo(4000 + POLICE_AHEAD, 6);
    expect(incident.tow!.stopAt).toBeCloseTo(4000 + TOW_AHEAD, 6);
  });
});
