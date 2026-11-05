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
