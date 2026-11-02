import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Events: { EventEmitter: class { emit() {} } }, Scene: class {} },
}));

import { CLASSES } from './state';
import * as handling from './handling';

describe('payload handling', () => {
  it('scales manual and signal braking with payload and bounds late signal stops', () => {
    const profiles = [0, 6, 38].map((tonnes) => handling.calculateHandling(90, 1, tonnes));
    for (const distance of [undefined, 300, 1]) {
      const braking = profiles.map((profile) => handling.calculateServiceBrake(215, profile, distance)!);
      expect(braking[0]).toBeLessThan(braking[1]);
      expect(braking[1]).toBeLessThan(braking[2]);
      braking.forEach((brake, i) => {
        expect(brake).toBeGreaterThanOrEqual(-profiles[i].maxBrake);
        expect(brake).toBeLessThan(0);
      });
    }
    expect(handling.calculateServiceBrake(215, profiles[0])).toBe(-260);
    expect(handling.calculateServiceBrake(0, profiles[2])).toBeNull();
  });
  it('progressively lengthens acceleration and service stops without changing empty baselines', () => {
    const profiles = [0, ...CLASSES.map((c) => c.payloadTonnes)]
      .map((tonnes) => handling.calculateHandling(90, 1, tonnes));
    expect(profiles[0]).toEqual({ aMax: 90, bComf: 150, maxBrake: 380 });
    // Constant-force comparison at the same speed: time=v/a, distance=v²/(2a).
    for (let i = 1; i < profiles.length; i++) {
      const light = profiles[i - 1], heavy = profiles[i];
      expect(215 / heavy.aMax).toBeGreaterThan(215 / light.aMax);
      for (const channel of ['bComf', 'maxBrake'] as const) {
        expect(215 / heavy[channel]).toBeGreaterThan(215 / light[channel]);
        expect(215 ** 2 / (2 * heavy[channel])).toBeGreaterThan(215 ** 2 / (2 * light[channel]));
      }
    }
    expect(handling.calculateHandling(90, 1.8, 38).aMax / profiles[4].aMax).toBeCloseTo(1.8);
    expect(handling.calculateHandling(90, 1.8, 38).bComf).toBe(profiles[4].bComf);
  });
});

describe('haul payloads', () => {
  it('declares positive, progressively heavier payload tonnes for every haul class', () => {
    const weights = CLASSES.map((c) => c.payloadTonnes);
    expect(weights).toEqual([6, 14, 24, 38]);
  });
});
