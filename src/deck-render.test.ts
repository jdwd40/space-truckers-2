import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Events: { EventEmitter: class { emit() {} } }, Scene: class {}, BlendModes: { ADD: 1 },
    Geom: { Point: class { constructor(public x: number, public y: number) {} } },
  },
}));

import { WorldScene } from './world';
import { DEPTH } from './render';
import { Network, type Seg } from './network';
import { Traffic, type PlayerCtl } from './traffic';
import { Incidents } from './incidents';

const ctl: PlayerCtl = {
  desired: () => 0, extraGap: () => Infinity, obeySignal: () => true,
  brakeMin: () => null, onTrans: () => {}, onBlocked: () => {}, onRouteNeeded: () => {},
};
/** a stand-in for a Graphics or GlowLayer that counts every call made on it */
function recorder() {
  const rec = { calls: 0, depth: 0 };
  return new Proxy(rec as any, {
    get: (t, k) => (k in t ? t[k] : () => { t.calls++; }),
  });
}
const bypasses = (net: Network): Seg[] => ['Meridian Bypass', 'Zenith Bypass'].flatMap((name) => {
  const road = net.roads.find((r) => r.name === name)!;
  return [road.f[0], road.r[0]];
});

describe('vehicle effects on every deck', () => {
  function deckScene(net: Network) {
    const scene = new WorldScene();
    scene.net = net;
    (scene as any).layer = { add() {} };
    (scene as any).add = { graphics: () => { const g = { depth: 0, setDepth(d: number) { g.depth = d; return g; }, setBlendMode: () => g }; return g; } };
    (scene as any).buildDeckLayers();
    return scene;
  }

  it('gives each deck in the network effect layers above its road and below the top layer', () => {
    const net = new Network(), scene = deckScene(net);
    for (const seg of net.segs) {
      const g = scene.fx[seg.level];
      expect(g, `${seg.name} on deck ${seg.level}`).toBeDefined();
      expect(scene.glow[seg.level]).toBeDefined();
      expect(g.depth).toBeGreaterThan(DEPTH.road(seg.level));
      expect(g.depth).toBeGreaterThan(DEPTH.veh(seg.level));
      expect(g.depth).toBeLessThan(DEPTH.fxTop);
      const ig = scene.incG[seg.level];
      expect(ig, `incident layer for ${seg.name}`).toBeDefined();
      expect(ig.depth).toBeGreaterThan(DEPTH.road(seg.level));
      expect(ig.depth).toBeLessThan(DEPTH.road(seg.level + 1));
    }
  });

  it('draws a ship\'s lights on the deck it is driving on, in every bypass direction', () => {
    const net = new Network();
    expect(bypasses(net).map((seg) => seg.level)).toContain(4);
    const decks = [0, 1, 2, 3, 4];
    for (const seg of bypasses(net)) {
      const scene = new WorldScene();
      const tr = new Traffic(net, ctl);
      const v = tr.add('van', seg, seg.len / 2, 0, 100);
      v.alpha = 1; v.braking = true; v.hazard = true; v.gfx = { units: [undefined], shadows: [] };
      scene.traffic = tr;
      scene.fx = decks.map(() => recorder());
      scene.glow = decks.map(() => recorder());
      scene.fxTop = recorder(); scene.zoomCur = 1;
      (scene as any).cameras = { main: { width: 1280, height: 720, midPoint: { x: v.x, y: v.y } } };
      (scene as any).updateVisuals(0.016);
      const painted = scene.glow.flatMap((gl, l) => ((gl as any).calls > 0 ? [l] : []));
      expect(painted, seg.name).toEqual([seg.level]);
    }
  });
});

describe('incident scenes on every deck', () => {
  it('draws the closure, crew and lamps on the deck of the incident\'s own road', () => {
    const net = new Network();
    const m1 = net.roads.find((r) => r.name === 'M1')!.f[0];
    for (const seg of [m1, ...bypasses(net)]) {
      expect(seg.kind).toBe('motorway');
      const tr = new Traffic(net, ctl);
      const v = tr.add('van', seg, seg.len / 2, 0, 0);
      const inc = new Incidents(net, tr, { playerCrashed() {}, playerReleased() {}, bump() {} });
      const incident = (inc as any).create('accident', seg, [v], false);
      v.smoke = true;
      (inc as any).settle(incident);
      expect(incident.phase).toBe('wait');
      incident.policeHere = true; incident.towHere = true; incident.phase = 'repair';
      const decks = [0, 1, 2, 3, 4].map(() => recorder()), glows = decks.map(() => recorder());
      inc.draw(decks, glows, 1, v.x, v.y, 1000);
      // Graphics.clear() is called on every deck, so a scene costs a deck more than that one call
      expect(decks.flatMap((g, l) => (g.calls > 1 ? [l] : [])), seg.name).toEqual([seg.level]);
      expect(glows.flatMap((g, l) => (g.calls > 0 ? [l] : [])), seg.name).toEqual([seg.level]);
    }
  });
});
