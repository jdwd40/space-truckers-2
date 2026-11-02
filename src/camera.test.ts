import { describe, expect, it } from 'vitest';
import * as camera from './camera';

const base = { width: 1280, height: 720, speed: 0, heading: 0, front: { x: 1000, y: 500 }, rigCenter: { x: 933, y: 500 }, rigLength: 134, currentZoom: 1, overview: 1 };

describe('accident camera targets', () => {
  it('blends in, holds, freezes when paused and smoothly restores independently of frame rate', () => {
    const first = camera.advanceCameraOverview(0, true, 1 / 60);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.1);
    let sixtyHz = 0, twentyHz = 0;
    for (let i = 0; i < 180; i++) sixtyHz = camera.advanceCameraOverview(sixtyHz, true, 1 / 60);
    for (let i = 0; i < 60; i++) twentyHz = camera.advanceCameraOverview(twentyHz, true, 0.05);
    expect(sixtyHz).toBeCloseTo(twentyHz, 12);
    expect(sixtyHz).toBeGreaterThan(0.99);
    expect(camera.advanceCameraOverview(sixtyHz, true, 0)).toBe(sixtyHz);
    expect(camera.advanceCameraOverview(1, true, 1)).toBe(1);
    const released = camera.advanceCameraOverview(sixtyHz, false, 1 / 60);
    expect(released).toBeGreaterThan(0.9);
    expect(released).toBeLessThan(sixtyHz);
    expect(camera.advanceCameraOverview(released, false, 6)).toBeLessThan(0.001);
    const partial = camera.calculateCameraTargets({ ...base, overview: first });
    const driving = camera.calculateCameraTargets({ ...base, overview: 0 });
    expect(partial.x).toBeLessThan(driving.x);
    expect(partial.x).toBeGreaterThan(base.rigCenter.x);
    expect(driving.x).toBe(base.front.x + base.height * 0.2 / base.currentZoom);
  });
  it.each([[1280, 720], [390, 844], [667, 375]])('centres the whole rig and fits crews, cones and an upstream queue at %sx%s', (width, height) => {
    for (const heading of [0, Math.PI / 2, 2.4]) {
      const along = (d: number, side = 0) => ({ x: base.rigCenter.x + Math.cos(heading) * d - Math.sin(heading) * side, y: base.rigCenter.y + Math.sin(heading) * d + Math.cos(heading) * side });
      const scenePoints = [along(237), along(-1050), along(0, 320), along(0, -320)];
      const result = camera.calculateCameraTargets({ ...base, width, height, heading, scenePoints });
      expect(result.x).toBe(base.rigCenter.x);
      expect(result.y).toBe(base.rigCenter.y);
      const driving = camera.calculateCameraTargets({ ...base, width, height, heading, overview: 0 });
      expect(result.zoom).toBeLessThan(driving.zoom);
      const rotation = -Math.PI / 2 - heading;
      for (const p of scenePoints) {
        const dx = p.x - result.x, dy = p.y - result.y;
        const screenX = width / 2 + (Math.cos(rotation) * dx - Math.sin(rotation) * dy) * result.zoom;
        const screenY = height / 2 + (Math.sin(rotation) * dx + Math.cos(rotation) * dy) * result.zoom;
        // Leave the existing screen-space HUD readable and reserve edges for controls.
        expect(screenX).toBeGreaterThanOrEqual(width * 0.15 - 1e-6);
        expect(screenX).toBeLessThanOrEqual(width * 0.85 + 1e-6);
        expect(screenY).toBeGreaterThanOrEqual(height * 0.2 - 1e-6);
        expect(screenY).toBeLessThanOrEqual(height * 0.8 + 1e-6);
      }
    }
  });
});
