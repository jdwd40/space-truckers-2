import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Events: { EventEmitter: class { emit() {} } } } }));
import { Network, type Road } from './network';
import { RoadLabels } from './maplabels';

const net = new Network(), labels = new RoadLabels(net);
/** a road name's size on screen in pixels, roughly as the sector map draws it */
const size = (rd: Road) => ({ w: rd.name.length * 7.5, h: 17 });
/** the zoom (screen px per world unit) at which the whole network fits a 1280 × 720 screen, as the map first opens */
const FIT = Math.min(1280 / net.bounds().w, (720 - 56) / net.bounds().h);

/** how far a point is from the edge of the nearest road other than `own` */
function otherRoadClearance(own: Road, x: number, y: number): number {
  let best = Infinity;
  for (const seg of net.segs) {
    if ((seg.kind !== 'motorway' && seg.kind !== 'avenue') || seg.road === own.name) continue;
    best = Math.min(best, seg.path.nearest(x, y).d - (seg.lanes * seg.laneW) / 2);
  }
  return best;
}

describe('road names on the sector map', () => {
  it.each([FIT, FIT * 3, 0.08, 0.3])('sit on their own road, clear of every other road, at zoom %s', (zoom) => {
    for (const rd of net.roads) {
      const { w, h } = size(rd);
      for (const spot of labels.spots(rd, zoom, w, h)) {
        // the whole name, end to end along its baseline, is closer to its own road than to any other
        for (const f of [-0.5, 0, 0.5]) {
          const x = spot.x + Math.cos(spot.rot) * f * w / zoom, y = spot.y + Math.sin(spot.rot) * f * w / zoom;
          expect(otherRoadClearance(rd, x, y), `${rd.name} at ${f}`).toBeGreaterThan((h / 2) / zoom);
        }
      }
    }
  });

  it('names M2 on the zoomed-out map, away from the interchange it shares with M1', () => {
    const m2 = net.roads.find((r) => r.name === 'M2')!;
    const spots = labels.spots(m2, FIT, size(m2).w, size(m2).h);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) expect(Math.hypot(s.x, s.y)).toBeGreaterThan(3000);
  });

  it('leaves the short crossing avenue and the bypass unnamed until they are big enough to carry a name', () => {
    for (const name of ['Dockside Avenue', 'Skyport Avenue', 'Meridian Bypass', 'Zenith Bypass']) {
      const rd = net.roads.find((r) => r.name === name)!;
      expect(labels.spots(rd, FIT, size(rd).w, size(rd).h), name).toEqual([]);
      expect(labels.spots(rd, 0.3, size(rd).w, size(rd).h).length, name).toBeGreaterThan(0);
    }
  });

  it('gives a long road more than one name once it is zoomed in', () => {
    const polar = net.roads.find((r) => r.name === 'Polar Express')!;
    expect(labels.spots(polar, FIT, size(polar).w, size(polar).h)).toHaveLength(1);
    expect(labels.spots(polar, 0.08, size(polar).w, size(polar).h).length).toBeGreaterThan(1);
  });
});
