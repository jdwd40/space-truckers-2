import { describe, expect, it, vi } from 'vitest';
import { Network, Seg, LW } from './network';

/** Follow mandatory continuations rather than assuming the return is an optional slip. */
function returnMerge(seg: Seg) {
  const visited = new Set<Seg>();
  while (seg.endT?.type === 'end' && !visited.has(seg)) {
    visited.add(seg); seg = seg.endT.to;
  }
  expect(seg.endT?.type, `${seg.name} motorway return`).toBe('merge');
  return seg.endT!;
}

/** Connected end caps/taper share pavement; unrelated crossings never receive an exemption. */
function connectedEndCap(a: Seg, sa: number, b: Seg, sb: number) {
  const radius = (a.lanes + b.lanes) * LW / 2;
  return (a.endT?.type === 'end' && a.endT.to === b &&
    sa >= a.endT.fromS - radius && Math.abs(sb - a.endT.toS) <= radius) ||
    (b.endT?.type === 'end' && b.endT.to === a &&
    sb >= b.endT.fromS - radius && Math.abs(sa - b.endT.toS) <= radius);
}

const originalProfiles: Record<string, [number[], number[]]> = {
  M1: [[4, 5, 4], [4, 5, 4]], M2: [[4, 5, 4], [4, 5, 4]],
  'Ore Road': [[3, 2, 3], [3, 2, 3]],
  'Aurora Way': [[3, 4, 3], [3, 4, 3]], 'Harbor Run': [[3, 4], [4, 3]],
  'Frost Line': [[3, 2], [2, 3]], 'Ice Road': [[3, 2, 3], [2, 3]],
  'Slag Highway': [[4, 3, 4], [3, 4]], 'Cinder Road': [[3, 2], [2, 3]],
};

describe('expanded haulage network', () => {
  it('always offers a mandatory motorway return after the last bypass slip opportunity', () => {
    const net = new Network();
    for (const rd of net.roads.filter((r) => r.name.includes('Bypass'))) for (const chain of [rd.f, rd.r]) {
      const end = chain[chain.length - 1];
      for (const s of [end.len - 389, end.len - 301, end.len - 299, end.len - 1, end.len]) {
        for (const station of net.stations) {
          const route = net.route(end, s, net.stationGoals(station));
          expect(route, `${end.name} at ${s} to ${station.name}`).not.toBeNull();
          expect(route!.trans[0].type).toBe('end');
        }
      }
      expect(end.endT?.type, end.name).toBe('end');
      expect(end.endT!.fromS).toBe(end.len);
      expect(end.endT!.to.endT?.type).toBe('merge');
    }
  });
  it('keeps the new interstation carriageways inside the existing sat-nav texture extent', () => {
    const net = new Network();
    const added = net.roads.filter((r) => r.f[0].depStation && !(r.name in originalProfiles));
    for (const rd of added) for (const seg of [...rd.f, ...rd.r]) {
      const half = seg.lanes * LW / 2;
      expect(seg.path.minX - half).toBeGreaterThan(-22000);
      expect(seg.path.maxX + half).toBeLessThan(22000);
      expect(seg.path.minY - half).toBeGreaterThan(-20000);
      expect(seg.path.maxY + half).toBeLessThan(20000);
    }
  });
  it('charges closures and jams only inside the traversed interval', () => {
    const net = new Network(), host = net.roads.find((r) => r.name === 'M1')!.f[1];
    const start = 3500, finish = 4200, goals = [{ seg: host, s: finish }];
    const baseline = net.route(host, start, goals)!.cost;
    const close = (s0: number, s1: number) => Array.from({ length: host.lanes }, (_, lane) => ({ lane, s0, s1, inc: null }));
    const queue = (s: number) => Array.from({ length: 24 }, (_, i) => ({ s: s + i, lane: i % host.lanes, v: 0, vDes: 260, state: 'drive', isPlayer: false }));
    host.blocks = [...close(start - 200, start), ...close(finish, finish + 200)];
    host.veh = [...queue(start - 100), ...queue(finish + 1)];
    expect(net.route(host, start, goals, 0, true)!.cost).toBe(baseline);
    host.blocks = close(start - 100, start + 100);
    host.veh = [];
    const partial = net.route(host, start, goals, 0, true)!;
    expect(partial.cost).toBe(baseline + 100 * 40);
    host.blocks.push(...host.blocks); // duplicate reports must not multiply a lane's closure.
    expect(net.route(host, start, goals, 0, true)!.cost).toBe(partial.cost);
    host.blocks = [];
    host.veh = queue(start + 100);
    expect(net.route(host, start, goals, 0, true)!.cost).toBeGreaterThan(baseline);
    // Services/lay-bys, player speed and vehicles already removed from the simulation are not jams.
    host.veh = [...queue(start + 100).map((v) => ({ ...v, state: 'parked' })),
      ...queue(start + 100).map((v) => ({ ...v, isPlayer: true })),
      ...queue(start + 100).map((v) => ({ ...v, lane: host.lanes })),
      ...queue(start + 100).map((v) => ({ ...v, dead: true }))];
    expect(net.route(host, start, goals, 0, true)!.cost).toBe(baseline);
  });
  it('retains a finite last-resort route and returns null for unreachable goals', () => {
    const net = new Network(), host = net.roads.find((r) => r.name === 'Polar Express')!.f[0];
    // A block beyond the final possible exit cannot force an impossible detour.
    const start = host.len - 500, finish = host.len - 200;
    host.blocks = Array.from({ length: host.lanes }, (_, lane) => ({ lane, s0: start, s1: finish, inc: null }));
    const route = net.route(host, start, [{ seg: host, s: finish }], 0, true)!;
    expect(route.trans).toEqual([]);
    expect(Number.isFinite(route.cost)).toBe(true);
    expect(route.cost).toBeGreaterThan(finish - start);
    expect(net.route(host, host.len, [{ seg: host, s: 0 }], 0, true)).toBeNull();
    expect(net.route(host, start, [], 0, true)).toBeNull();
  });
  it('grade-separates bypass slips that cross the opposite direction or the other bypass', () => {
    const net = new Network();
    const pieces = net.segs.filter((s) => s.name.includes('Bypass'));
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      if (a.level !== b.level) continue;
      for (let s = 0; s <= a.len; s += 35) {
        const p = a.path.at(s), nearest = b.path.nearest(p.x, p.y);
        if (connectedEndCap(a, s, b, nearest.s)) continue;
        expect(nearest.d, `${a.name} / ${b.name} at ${s}`).toBeGreaterThanOrEqual((a.lanes + b.lanes) * LW / 2 - 1.5);
      }
    }
  });
  it('keeps bypass slip roads outside the through carriageway surface', () => {
    const net = new Network();
    for (const bypass of net.roads.filter((r) => r.name.includes('Bypass'))) for (const chain of [bypass.f, bypass.r]) {
      const seg = chain[0];
      const ramps = net.trans.filter((t) => t.type === 'merge' && t.to === seg).map((t) => t.from)
        .concat(returnMerge(seg).from);
      expect(ramps).toHaveLength(2);
      for (const ramp of ramps) for (let s = 0; s <= ramp.len; s += 35) {
        const p = ramp.path.at(s), nearest = seg.path.nearest(p.x, p.y);
        if (connectedEndCap(ramp, s, seg, nearest.s)) continue;
        expect(nearest.d, `${seg.name} / ${ramp.name} at ${s}`).toBeGreaterThanOrEqual((seg.lanes + ramp.lanes) * LW / 2 - 1.5);
      }
    }
  });
  it('avoids substantial stopped traffic but not an isolated slow ship, then recovers', () => {
    const net = new Network();
    for (const rd of net.roads.filter((r) => ['M1', 'M2'].includes(r.name))) for (const chain of [rd.f, rd.r]) {
      const host = chain[1], entry = host.outs.find((t) => t.label.includes('Bypass'))!;
      const bypass = entry.to.endT!.to, merge = returnMerge(bypass);
      const start = entry.fromS - 1000, goals = [{ seg: host, s: merge.toS + 600 }];
      const middle = host.path.nearest(0, 0).s;
      const jam = Array.from({ length: 24 }, (_, i) => ({ s: middle - 200 + i * 20, lane: i % host.lanes, v: 5, vDes: 260, state: 'drive', isPlayer: false }));
      host.veh = jam.slice(0, 1);
      expect(net.route(host, start, goals, 0, true)!.trans).toEqual([]);
      host.veh = jam;
      expect(net.route(host, start, goals)!.trans).toEqual([]);
      const diversion = net.route(host, start, goals, 0, true)!;
      expect(diversion.trans).toContain(entry);
      expect(diversion.diverted).toBe(true);
      for (const v of jam) v.v = v.vDes;
      expect(net.route(host, start, goals, 0, true)!.trans).toEqual([]);
      host.veh = [];
    }
  });
  it('routes around blocked central intervals in every direction and recovers when cleared', () => {
    const net = new Network();
    for (const rd of net.roads.filter((r) => ['M1', 'M2'].includes(r.name))) for (const chain of [rd.f, rd.r]) {
      const host = chain[1];
      const entry = host.outs.find((t) => t.label.includes('Bypass'))!;
      const bypass = entry.to.endT!.to;
      const merge = returnMerge(bypass);
      const start = entry.fromS - 1000, goals = [{ seg: host, s: merge.toS + 600 }];
      const normal = net.route(host, start, goals)!;
      expect(normal.trans).toEqual([]);
      const middle = host.path.nearest(0, 0).s;
      host.blocks = Array.from({ length: host.lanes }, (_, lane) => ({ lane, s0: middle - 600, s1: middle + 600, inc: null }));
      // Distance mode remains the stable source for job prices.
      expect(net.route(host, start, goals)!.cost).toBe(normal.cost);
      const diversion = net.route(host, start, goals, 0, true)!;
      expect(diversion.trans.some((t) => t === entry), host.name).toBe(true);
      expect(diversion.trans.every((t) => t.kind !== 'dock')).toBe(true);
      expect(diversion.diverted).toBe(true);
      host.blocks = [];
      expect(net.route(host, start, goals, 0, true)!.trans).toEqual([]);
      expect(net.route(host, start, goals, 0, true)!.cost).toBe(normal.cost);
    }
  });
  it('provides signed bypass exits before the interchange and merges after it in all four directions', () => {
    const warn = vi.spyOn(console, 'warn');
    const net = new Network();
    const bypasses = net.roads.filter((r) => r.name.includes('Bypass'));
    expect(bypasses).toHaveLength(2);
    for (const name of ['M1', 'M2']) {
      const rd = net.roads.find((r) => r.name === name)!;
      for (const chain of [rd.f, rd.r]) {
        const exits = chain.flatMap((s) => s.outs).filter((t) => t.type === 'exit' && t.label.includes('Bypass'));
        expect(exits, `${name} ${chain[0].name}`).toHaveLength(1);
        const entry = exits[0];
        const bypass = entry.to.endT!.to;
        const merge = returnMerge(bypass);
        expect(chain).toContain(merge.to);
        const p = entry.from.path.at(entry.fromS), q = merge.to.path.at(merge.toS);
        const forward = name === 'M1' ? Math.cos(p.h) : Math.sin(p.h);
        expect((name === 'M1' ? p.x : p.y) * forward).toBeLessThan(-2000);
        expect((name === 'M1' ? q.x : q.y) * forward).toBeGreaterThan(2000);
        const route = net.route(entry.to, 0, [{ seg: merge.to, s: merge.toS + 100 }]);
        expect(route).not.toBeNull();
        expect(route!.trans.some((t) => t.to === bypass)).toBe(true);
        expect(route!.trans.every((t) => t.kind !== 'dock')).toBe(true);
        expect(net.signs.some((sign) => sign.seg === entry.from && sign.s < entry.fromS && sign.panels.some((p) => p.title.includes('Bypass')))).toBe(true);
        for (const t of [entry, entry.to.endT!, ...route!.trans]) {
          if (!t.aux) continue;
          const onHost = t.type === 'merge' ? net.auxPt(t.to, t.toS, t.side) : net.auxPt(t.from, t.fromS, t.side);
          const onRamp = t.type === 'merge' ? t.from.path.at(t.fromS) : t.to.path.at(t.toS);
          expect(Math.hypot(onHost.x - onRamp.x, onHost.y - onRamp.y)).toBeLessThan(0.1);
        }
        expect(bypass.level).toBeGreaterThan(0);
      }
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('adds two signed interstation roads with live gates and preserves every station pair', () => {
    const warn = vi.spyOn(console, 'warn');
    const net = new Network();
    const added = net.roads.filter((r) => r.f[0].depStation && !(r.name in originalProfiles));
    expect(added).toHaveLength(2);
    expect(new Set(added.map((r) => r.name)).size).toBe(2);
    expect(net.stations).toHaveLength(7);
    for (const rd of added) for (const chain of [rd.f, rd.r]) {
      const first = chain[0], last = chain[chain.length - 1];
      expect(first.depStation!.dep).toContain(first);
      expect(last.arrStation!.arr).toContain(last);
      expect(net.spawnSegs.some((sp) => sp.seg === first)).toBe(true);
      expect(net.signs.some((sign) => sign.seg === first && sign.panels.some((p) => p.sub?.includes(rd.name)))).toBe(true);
      const route = net.route(first, 150, net.stationGoals(last.arrStation!));
      expect(route).not.toBeNull();
      expect(route!.trans.every((t) => t.kind !== 'dock')).toBe(true);
    }
    for (const a of net.stations) for (const b of net.stations) if (a !== b) {
      const reachable = a.dep.some((seg) => net.route(seg, 150, net.stationGoals(b)) !== null);
      expect(reachable, `${a.name} → ${b.name}`).toBe(true);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('widens both directions of every original motorway without losing lane variation', () => {
    const net = new Network();
    for (const [name, profiles] of Object.entries(originalProfiles)) {
      const road = net.roads.find((r) => r.name === name)!;
      expect([road.f, road.r].map((ss) => ss.map((s) => s.lanes)), name)
        .toEqual(profiles.map((ns) => ns.map((n) => n + 1)));
      for (const chain of [road.f, road.r]) for (const seg of chain) if (seg.next) {
        const t = seg.endT!;
        // Median-side lane centres retain their world-space position at section joins.
        const a = seg.path.at(seg.len, seg.laneLat(0));
        const b = seg.next.path.at(0, seg.next.laneLat(0));
        expect(Math.hypot(a.x - b.x, a.y - b.y), name).toBeLessThan(1.5);
        expect(seg.laneLat(0) + t.latShift).toBe(seg.next.laneLat(0));
        expect(seg.next.prev).toBe(seg);
        expect(Math.max(seg.drop, seg.next.gain)).toBe(Math.abs(seg.lanes - seg.next.lanes));
      }
    }
  });
});
