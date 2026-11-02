import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network, LW, TAPER } from './network';
import { Traffic, type PlayerCtl } from './traffic';

// Traffic only needs speed constants; importing Phaser's browser state is not part of this simulation.
vi.mock('./state', () => ({ SPEEDS: [0, 90, 150, 215, 280, 345] }));
afterEach(() => vi.restoreAllMocks());

const ctl: PlayerCtl = {
  desired: () => 280, extraGap: () => Infinity, obeySignal: () => true,
  brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
};
function seed(value = 17) {
  vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  });
}
const cases = ['Meridian Bypass', 'Zenith Bypass'].flatMap(name =>
  (['f', 'r'] as const).flatMap(direction => [0, 1].map(lane => ({ name, direction, lane }))));

describe('mandatory bypass transit', () => {
  it.each(cases)('drives $name $direction lane $lane continuously back to the motorway', ({ name, direction, lane }) => {
    seed();
    const net = new Network();
    const bypass = net.roads.find(r => r.name === name)![direction][0];
    // Keep ambient generation out of this single-vehicle integration fixture, not movement/routing.
    net.spawnSegs = [];
    const tr = new Traffic(net, ctl);
    tr.localT = Infinity;
    tr.view.r = 50000;
    const v = tr.spawnNPC(bypass, 0, true, lane, 'taxi')!;
    expect(v).not.toBeNull();
    v.local = false; v.dest = 'vesta'; v.svcTarget = null;
    tr.reroute(v);
    let returned = false, sawTaperMerge = lane === 0, sawReturnRamp = false;
    let routeChecks = 0;
    for (let step = 0; step < 2400; step++) {
      // Check ALL destinations at every actual simulation position, including terminal/taper/merge.
      for (const st of net.stations) {
        expect(net.route(v.seg, v.s, net.stationGoals(st), v.lane < 0 ? -1 : v.lane >= v.seg.lanes ? 1 : 0),
          `${name} ${direction} lane ${lane} at ${v.seg.name}:${v.s} → ${st.name}`).not.toBeNull();
        routeChecks++;
      }
      const old = { seg: v.seg, s: v.s, lane: v.lane, lat: v.lat, x: v.x, y: v.y };
      tr.update(0.05);
      expect(v.dead, `${name} ${direction} lane ${lane} at ${old.s}`).toBe(false);
      // Ordinary motion may not hide an off-road teleport at either end of the return ramp.
      expect(Math.hypot(v.x - old.x, v.y - old.y)).toBeLessThanOrEqual(v.v * 0.05 + 4);
      if (v.seg === bypass && old.lane === 1 && v.lane === 0) {
        expect(old.s).toBeLessThan(bypass.len - TAPER);
        expect(Math.abs(v.lat - old.lat)).toBeLessThanOrEqual(55 * 0.05);
        sawTaperMerge = true;
      }
      if (old.seg === bypass && v.seg !== bypass) {
        expect(old.lane).toBe(0);
        expect(Math.abs(old.lat - bypass.laneLat(0))).toBeLessThan(0.1);
        expect(old.s).toBeGreaterThan(bypass.len - v.v * 0.05 - 1);
        expect(v.seg.kind).toBe('ramp');
        sawReturnRamp = true;
      }
      if (v.seg.kind === 'motorway' && v.seg !== bypass) {
        expect(v.seg.road).toBe(name === 'Meridian Bypass' ? 'M1' : 'M2');
        returned = true; break;
      }
    }
    expect(returned, `${name} ${direction} lane ${lane} stalled at ${v.seg.name}:${v.s}`).toBe(true);
    expect(sawTaperMerge).toBe(true);
    expect(sawReturnRamp).toBe(true);
    expect(routeChecks).toBeGreaterThan(7 * 100);
  }, 30000);

  it('signs the mandatory continuation as straight ahead and warns about the lane taper', () => {
    const net = new Network();
    for (const rd of net.roads.filter(r => r.name.includes('Bypass'))) for (const chain of [rd.f, rd.r]) {
      const end = chain[chain.length - 1];
      const sign = net.signs.find(s => s.seg === end && s.panels.some(p => p.sub?.includes('Return to motorway')))!;
      expect(sign).toBeDefined();
      expect(sign.s).toBeLessThan(end.len - TAPER);
      expect(sign.panels[0].arrow).toBe(0);
      expect(sign.panels[0].sub).toContain('Merge left');
    }
  });

  it('aligns the surviving median-side lane and return merge without auxiliary overlap warnings', () => {
    const warn = vi.spyOn(console, 'warn');
    const net = new Network();
    for (const rd of net.roads.filter(r => r.name.includes('Bypass'))) for (const chain of [rd.f, rd.r]) {
      const end = chain[chain.length - 1], t = end.endT!;
      expect(t?.type).toBe('end');
      expect(end.drop).toBe(1);
      expect(end.next).toBe(t.to);
      expect(t.to.prev).toBe(end);
      expect(t.latShift).toBe(LW / 2);
      expect(end.laneLat(0) + t.latShift).toBe(t.to.laneLat(0));
      const a = end.path.at(end.len, end.laneLat(0)), b = t.to.path.at(0);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.1);
      expect(Math.cos(a.h - b.h)).toBeGreaterThan(0.999);
      expect(end.level).toBe(t.to.level);
      const merge = t.to.endT!;
      expect(merge.type).toBe('merge');
      const p = t.to.path.at(t.to.len), q = net.auxPt(merge.to, merge.toS, merge.side);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.1);
      expect(Math.cos(p.h - q.h)).toBeGreaterThan(0.999);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
