import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Events: { EventEmitter: class { emit() {} } } },
}));

import { Network } from './network';
import { Traffic, TRAFFIC_CFG, type PlayerCtl } from './traffic';
import { Incidents } from './incidents';

const config = { ...TRAFFIC_CFG };
afterEach(() => { Object.assign(TRAFFIC_CFG, config); vi.restoreAllMocks(); });
const ctl: PlayerCtl = {
  desired: () => 0, extraGap: () => Infinity, obeySignal: () => true,
  brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
};

describe('incident responder population lifecycle', () => {
  it.each(['mite', 'police', 'tow'] as const)('keeps released responders outside a full ordinary pool containing an ambient %s', type => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    TRAFFIC_CFG.maxVehicles = 1;
    const net = new Network(), seg = net.roads.find(r => r.name === 'M1')!.f[0];
    const tr = new Traffic(net, ctl);
    tr.localT = Infinity; tr.spawnT.fill(Infinity);
    const ordinary = tr.spawnNPC(seg, 7000, true, 2, type)!;
    expect(ordinary).not.toBeNull();
    ordinary.state = 'held';
    tr.player = tr.add('player', seg, 4000, 0, 0);
    tr.view = { x: tr.player.x, y: tr.player.y, r: 20000 };
    const released = vi.fn();
    const incidents = new Incidents(net, tr, { playerCrashed() {}, playerReleased: released, bump() {} });
    const incident = incidents.playerBreakdown()!;
    expect(incident).not.toBeNull();
    const phases = new Set<string>();
    // Real dispatch, travel, arrival, repair and release, not a fabricated responder or a private release() call.
    for (let i = 0; i < 4000 && incident.phase !== 'clear'; i++) {
      tr.update(0.05); incidents.update(0.05, false);
      phases.add(incident.phase);
      expect(tr.spawnNPC(seg, 7500, true, 2, 'van')).toBeNull();
    }
    expect([...phases]).toEqual(['wait', 'repair', 'clear']);
    expect(incident.policeHere && incident.towHere).toBe(true);
    expect(released).toHaveBeenCalledOnce();
    const responders = [incident.police!, incident.tow!];
    expect(responders.every(v => !v.dead && !v.emergency && v.resp === null && v.state === 'drive')).toBe(true);
    expect(responders.every(v => v.incidentResponder)).toBe(true);
    expect(ordinary.incidentResponder).toBe(false);
    expect(tr.vs.filter(v => !v.dead && !v.isPlayer && !v.incidentResponder)).toHaveLength(1);
    expect(tr.vs).toHaveLength(4); // player, one ambient vehicle, two incident-only responders
    expect(tr.spawnNPC(seg, 7500, true, 2, 'van')).toBeNull();
    ordinary.dead = true;
    tr.update(0);
    // Released crews must not consume the newly vacated ordinary slot.
    const replacement = tr.spawnNPC(seg, 7500, true, 2, type);
    expect(replacement).not.toBeNull();
    expect(tr.spawnNPC(seg, 8000, true, 2, 'van')).toBeNull();
    incidents.update(incident.clearT, false);
    expect(incidents.list).toHaveLength(0);
    replacement!.dead = true;
    tr.update(0);
    expect(tr.spawnNPC(seg, 8000, true, 2, type)).not.toBeNull();
    expect(tr.spawnNPC(seg, 8500, true, 2, 'van')).toBeNull();
  });
});
