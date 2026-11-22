import { describe, expect, it } from 'vitest';
import { Network, type Seg } from './network';

/** The Harbor Prime–Glacier Outpost corridor: Polar Express against Harbor Run, Kestrel Station and Frost Line. */
const net = new Network();
const road = (name: string) => net.roads.find((r) => r.name === name)!;
const carriageways = (name: string) => [road(name).f, road(name).r];
/** Distance of (seg, s) along its carriageway from the carriageway's start. */
const along = (chain: Seg[], seg: Seg, s: number) => chain.slice(0, chain.indexOf(seg)).reduce((d, x) => d + x.len, 0) + s;
const camerasOn = (chain: Seg[]) => net.cameras.filter((c) => chain.includes(c.seg));
const speedChecksOn = (chain: Seg[]) => net.signs.filter((sg) => chain.includes(sg.seg) && sg.panels.some((p) => p.title === 'Speed check'));

describe('Harbor Prime–Glacier Outpost corridor layout', () => {
  it('posts Harbor Run and Frost Line at limit 4 with signs, and keeps Polar Express at 5', () => {
    for (const name of ['Harbor Run', 'Frost Line']) for (const chain of carriageways(name)) {
      expect(Math.max(...chain.flatMap((seg) => [...seg.limits])), name).toBe(4);
      expect(net.limitSigns.some((sign) => chain.includes(sign.seg) && sign.limit === 4), `${name} limit 4 sign`).toBe(true);
      expect(net.limitSigns.some((sign) => chain.includes(sign.seg) && sign.limit === 5), `${name} limit 5 sign`).toBe(false);
    }
    for (const chain of carriageways('Polar Express')) {
      expect(Math.max(...chain.flatMap((seg) => [...seg.limits]))).toBe(5);
      expect(net.limitSigns.some((sign) => chain.includes(sign.seg) && sign.limit === 5)).toBe(true);
    }
  });

  it('puts two announced cameras on each Polar Express carriageway, one on each Harbor Run carriageway and none on Frost Line', () => {
    const expected: Record<string, number> = {
      'Polar Express': 2, 'Harbor Run': 1, 'Frost Line': 0,
      // unchanged elsewhere
      M1: 1, M2: 1, 'Aurora Way': 1, 'Ice Road': 1, 'Slag Highway': 1, 'Cinder Road': 1, 'Ore Road': 0, 'Ember Belt': 0,
    };
    for (const [name, n] of Object.entries(expected)) for (const chain of carriageways(name)) {
      const cams = camerasOn(chain), checks = speedChecksOn(chain);
      expect(cams, `${name} cameras`).toHaveLength(n);
      // every camera is announced by a speed check sign shortly before it, and no sign warns of a camera that is not there
      expect(checks, `${name} speed check signs`).toHaveLength(n);
      for (const cam of cams) {
        const at = along(chain, cam.seg, cam.s);
        expect(checks.some((sg) => at - along(chain, sg.seg, sg.s) > 500 && at - along(chain, sg.seg, sg.s) < 1100), `${name} camera at ${at | 0} announced`).toBe(true);
      }
    }
  });

  it('gives every camera a stable ID that is the same on every network build', () => {
    const ids = net.cameras.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Network().cameras.map((c) => c.id)).toEqual(ids);
    for (const chain of carriageways('Polar Express')) for (const cam of camerasOn(chain)) expect(cam.id).toMatch(/^cam-polar-express-[fr]-\d+$/);
  });

  it('gives Polar Express at least two lay-bys per carriageway and no fuel or repair facility', () => {
    for (const chain of carriageways('Polar Express')) {
      expect(net.laybys.filter((lb) => chain.includes(lb.seg)).length).toBeGreaterThanOrEqual(2);
      expect(net.services.filter((sv) => chain.includes(sv.host))).toHaveLength(0);
    }
  });
});
