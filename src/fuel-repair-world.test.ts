import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} } }));
import { WorldScene } from './world';
import { Network, type Services } from './network';
import { Traffic } from './traffic';
import { G, bus } from './state';

/** a headless world with a loaded rig on Harbor Run eastbound, 900 m before the named facility's exit */
function worldBefore(name: string, job = { from: 'harbor', to: 'glacier', stage: 'deliver', cls: 0 }) {
  vi.stubGlobal('window', {});
  const scene = new WorldScene(), net = new Network();
  const sv = net.services.find((s) => s.name === name)!;
  scene.net = net;
  scene.traffic = new Traffic(net, scene);
  scene.traffic.localT = 1e6; scene.traffic.spawnT.fill(1e6);
  const host = sv.host, at = net.place(host, sv.exit.fromS - 900);
  scene.player = scene.traffic.add('player', at.seg, at.s, at.seg.lanes - 1, 215);
  scene.player.setTrailers([50]);
  scene.traffic.player = scene.player;
  scene.pstate = 'drive';
  scene.inc = { hazardAhead: () => null, playerIncident: () => null, laneBlockedAhead: () => false, inSlowZone: () => false } as any;
  scene.favours = { prompt: () => '', onExit() {} } as any;
  G.mode = 'drive'; G.speedSet = 3; G.braking = false; G.fuel = 1;
  G.job = { ...job, elapsed: 0 } as any;
  vi.spyOn(scene as any, 'drawRoute').mockImplementation(() => {});
  scene.computeRoute(false);
  const p = scene.player;
  const step = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 0.02) {
      const prevS = p.s, prevSeg = p.seg;
      scene.traffic.update(0.02);
      (scene as any).playerLogic(0.02, prevS, prevSeg);
      if (until?.()) return true;
    }
    return false;
  };
  return { scene, net, sv, p, step };
}

/** move into the facility's exit lane and drive onto its entry road */
function takeExit(w: ReturnType<typeof worldBefore>) {
  w.scene.laneChange(1);
  expect(w.step(60, () => w.p.seg === w.sv.exit.to)).toBe(true);
}

afterEach(() => { G.job = null; G.mode = 'title'; G.speedSet = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Fuel & Repair in the world', () => {
  it.each([true, false])('stops in the repair bay with a "no damage" quote, and rejoins eastbound when it is answered (authorise: %s)', (authorise) => {
    const w = worldBefore('Harbor Pumps');
    const { scene, sv, p, step, net } = w;
    takeExit(w);
    scene.laneChange(1); // choose the repair bay at the fork
    expect(step(60, () => scene.pstate === 'repair')).toBe(true);
    expect(p.seg).toBe(sv.bay!.seg);
    expect(p.v).toBeLessThan(3);
    expect(scene.quote!.facility).toBe('Harbor Pumps');
    expect(scene.quote!.text.toLowerCase()).toContain('no damage to repair');
    expect(sv.pumps.every((pump) => pump.occ !== p)).toBe(true);
    // the rig stays put until the quote is answered
    step(3);
    expect(scene.pstate).toBe('repair');
    expect(p.seg).toBe(sv.bay!.seg);
    scene.answerQuote(authorise);
    expect(scene.pstate).toBe('drive');
    expect(scene.quote).toBeNull();
    // drives out and merges back onto Harbor Run eastbound, beyond the facility
    const rd = net.roads.find((r) => r.name === 'Harbor Run')!;
    const exitAt = sv.exit.fromS - net.chainStart(sv.host);
    expect(step(90, () => rd.f.includes(p.seg) && p.lane >= 0 && p.lane < p.seg.lanes)).toBe(true);
    expect(p.s - net.chainStart(p.seg)).toBeGreaterThan(exitAt);
    expect(p.route.length + (p.goal ? 1 : 0)).toBeGreaterThan(0);
  });

  it('ignores A and D while the rig waits in the repair bay for the quote', () => {
    const w = worldBefore('Harbor Pumps');
    const { scene, sv, p, step } = w;
    takeExit(w);
    scene.laneChange(1);
    expect(step(60, () => scene.pstate === 'repair')).toBe(true);
    const emit = vi.spyOn(bus, 'emit');
    const repairTarget = scene.repairTarget, lane = p.lane, pend = p.pend;
    scene.laneChange(-1);
    scene.laneChange(1);
    expect(emit).not.toHaveBeenCalled();
    expect(scene.repairTarget).toBe(repairTarget);
    expect([p.lane, p.pend]).toEqual([lane, pend]);
    expect(scene.pstate).toBe('repair');
    expect(p.seg).toBe(sv.bay!.seg);
  });

  it('carries on to the pumps when the bay is not chosen, and fills the tank as at any fuel stop', () => {
    const w = worldBefore('Frost Fuel', { from: 'kestrel', to: 'glacier', stage: 'deliver', cls: 0 });
    const { scene, sv, p, step } = w;
    G.fuel = 0.5;
    takeExit(w);
    expect(step(60, () => scene.pstate === 'fuel')).toBe(true);
    expect(p.seg).toBe(sv.seg);
    expect(step(30, () => G.fuel >= 0.999 && scene.pstate === 'drive')).toBe(true);
    const fl = w.net.roads.find((r) => r.name === 'Frost Line')!;
    expect(step(90, () => fl.f.includes(p.seg) && p.lane >= 0 && p.lane < p.seg.lanes)).toBe(true);
  });

  it('lets traffic use the pumps, never the bay, and merge back while the rig waits in the bay', () => {
    const w = worldBefore('Harbor Pumps');
    const { scene, sv, p, step, net } = w;
    const npc = scene.traffic.add('van', sv.host, sv.exit.fromS - 1400, sv.host.lanes - 1, 200);
    npc.svcTarget = sv; npc.dest = 'kestrel';
    scene.traffic.reroute(npc);
    takeExit(w);
    scene.laneChange(1);
    let inBay = false, pumped = false;
    expect(step(120, () => {
      if (npc.seg === sv.bay!.seg) inBay = true;
      if (npc.seg === sv.seg) pumped = true;
      return scene.pstate === 'repair' && pumped && net.roads.find((r) => r.name === 'Harbor Run')!.f.includes(npc.seg) && npc.s - net.chainStart(npc.seg) > sv.exit.fromS - net.chainStart(sv.host) && npc.lane < npc.seg.lanes;
    })).toBe(true);
    expect(inBay).toBe(false);
    expect(npc.dead).toBe(false);
    expect(p.seg).toBe(sv.bay!.seg);
  });

  it('sends a rig low on fuel to a Fuel & Repair facility ahead, as to any fuel stop', () => {
    const w = worldBefore('Harbor Pumps');
    const { scene, sv, step } = w;
    G.fuel = 0.2;
    step(0.1);
    expect(scene.fuelTarget as Services | null).toBe(sv);
    expect(scene.player.route[0]).toBe(sv.exit);
  });
});
