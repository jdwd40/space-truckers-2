import { describe, expect, it, vi } from 'vitest';
import { Network, type Seg, type Services, type Trans } from './network';

const FUEL_REPAIR = { 'Harbor Pumps': 'Harbor Run', 'Frost Fuel': 'Frost Line' } as const;

/** where s on seg lies along its whole carriageway */
function along(net: Network, seg: Seg, s: number) { return s - net.chainStart(seg); }

/** follow a facility road's continuations until it merges back onto a carriageway */
function rejoin(seg: Seg): Trans {
  for (let i = 0; i < 6 && seg.endT?.type === 'end'; i++) seg = seg.endT.to;
  expect(seg.endT?.type, `${seg.name} rejoins`).toBe('merge');
  return seg.endT!;
}

function facility(net: Network, name: string): Services {
  const sv = net.services.find((s) => s.name === name);
  expect(sv, name).toBeDefined();
  return sv!;
}

describe('Fuel & Repair facilities', () => {
  it('puts pumps and a repair bay behind one exit at Harbor Pumps and Frost Fuel, both rejoining the same carriageway', () => {
    const warn = vi.spyOn(console, 'warn');
    const net = new Network();
    for (const [name, road] of Object.entries(FUEL_REPAIR)) {
      const sv = facility(net, name);
      const rd = net.roads.find((r) => r.name === road)!;
      expect(sv.kind).toBe('fuel-repair');
      expect(rd.f).toContain(sv.host);
      expect(sv.pumps.length).toBeGreaterThan(0);
      // one exit from the carriageway leads to the entry
      const exits = rd.f.flatMap((s) => s.outs).filter((t) => t.type === 'exit' && t.svc === sv);
      expect(exits).toEqual([sv.exit]);
      const entry = sv.exit.to;
      // the entry splits into the pumps and the repair bay
      const forks = entry.outs.filter((t) => t.type === 'end');
      expect(forks.map((t) => t.to).sort((a, b) => a.id - b.id)).toEqual([sv.seg, sv.bay!.seg].sort((a, b) => a.id - b.id));
      expect(sv.bay!.stopS).toBeGreaterThan(0);
      expect(sv.bay!.stopS).toBeLessThan(sv.bay!.seg.len);
      // both rejoin the same carriageway in the same direction, after the exit
      const exitAt = along(net, sv.host, sv.exit.fromS);
      for (const from of [sv.seg, sv.bay!.seg]) {
        const m = rejoin(from);
        expect(rd.f, `${name} ${from.name}`).toContain(m.to);
        expect(along(net, m.to, m.toS)).toBeGreaterThan(exitAt);
        const back = m.to.path.at(m.toS), out = m.from.path.at(m.fromS);
        expect(Math.cos(back.h - out.h)).toBeGreaterThan(0.9);
      }
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('announces both fuel and repair on the approach gantry', () => {
    const net = new Network();
    for (const name of Object.keys(FUEL_REPAIR)) {
      const sv = facility(net, name);
      const exitAt = along(net, sv.host, sv.exit.fromS);
      const approach = net.signs.filter((sign) => sign.kind === 'gantry' && sign.panels.some((p) => p.sub?.includes(name)));
      expect(approach.length, name).toBeGreaterThan(0);
      for (const sign of approach) {
        expect(sv.host.road).toBe(sign.seg.road);
        expect(along(net, sign.seg, sign.s)).toBeLessThan(exitAt);
        const text = sign.panels.map((p) => `${p.title} ${p.sub ?? ''}`).join(' ').toLowerCase();
        expect(text).toContain('fuel');
        expect(text).toContain('repair');
      }
    }
    // ordinary fuel stops do not promise a repair bay
    for (const sv of net.services.filter((s) => s.kind === 'fuel')) {
      expect(sv.bay).toBeNull();
      const text = net.signs.filter((sign) => sign.panels.some((p) => p.sub?.includes(sv.name))).flatMap((s) => s.panels.map((p) => p.title)).join(' ');
      expect(text.toLowerCase(), sv.name).not.toContain('repair');
    }
  });

  it('routes through a repair bay only when the bay is the goal', () => {
    const net = new Network();
    const bays = new Set(net.services.flatMap((s) => (s.bay ? [s.bay.seg] : [])));
    for (const a of net.stations) for (const b of net.stations) if (a !== b) for (const seg of a.dep) {
      const r = net.route(seg, 150, net.stationGoals(b));
      if (r) expect(r.trans.some((t) => bays.has(t.to)), `${a.name} → ${b.name}`).toBe(false);
    }
    for (const name of Object.keys(FUEL_REPAIR)) {
      const sv = facility(net, name), bay = sv.bay!;
      // from the entry road, the pumps are the way through; the bay is reachable when asked for
      const through = net.route(sv.exit.to, 0, net.stationGoals(net.byId.glacier))!;
      expect(through.trans[0].to).toBe(sv.seg);
      const toBay = net.route(sv.host, sv.exit.fromS - 800, [{ seg: bay.seg, s: bay.stopS }], 0)!;
      expect(toBay.trans.map((t) => t.to)).toEqual([sv.exit.to, bay.seg]);
    }
  });

  it('gives every facility an ID that is unique and the same on every network build', () => {
    const ids = (net: Network) => [...net.services.map((s) => s.id), ...net.services.flatMap((s) => (s.bay ? [s.bay.id] : [])), ...net.laybys.map((l) => l.id)];
    const a = ids(new Network()), b = ids(new Network());
    expect(a.length).toBeGreaterThan(40);
    expect(new Set(a).size).toBe(a.length);
    expect(b).toEqual(a);
    const net = new Network();
    expect(facility(net, 'Harbor Pumps').id).toBe('services:harbor-pumps');
    expect(facility(net, 'Frost Fuel').bay!.id).toBe('services:frost-fuel:bay');
    expect(net.laybys.find((l) => l.name === 'Harbor Run lay-by 1')!.id).toBe('layby:harbor-run-1');
    for (const id of a) expect(net.facility(id), id).toBeDefined();
  });
});
