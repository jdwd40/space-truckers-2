import { clamp, type Pt } from './geom';

export interface CameraInput {
  width: number; height: number; speed: number; heading: number;
  front: Pt; rigCenter: Pt; rigLength: number; currentZoom: number; overview: number;
  scenePoints?: Pt[];
}

/** Frame-rate-independent easing; dt=0 keeps an interrupted transition frozen while paused. */
export function advanceCameraOverview(current: number, active: boolean, dt: number): number {
  const target = active ? 1 : 0;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) * (active ? 2.2 : 1.6)));
}

/** Main-camera targets only: screen-space HUD/minimap cameras are deliberately unaffected. */
export function calculateCameraTargets(input: CameraInput): { x: number; y: number; zoom: number } {
  const { width, height, speed, heading, front, rigCenter, rigLength, currentZoom, scenePoints } = input;
  const base = clamp(Math.min(width, height) / 720, 0.5, 1.6);
  const drivingZoom = base * (1.1 - 0.3 * clamp(speed / 345, 0, 1));
  const blend = clamp(input.overview, 0, 1), ch = Math.cos(heading), sh = Math.sin(heading);
  // Keep the rig at the centre, rather than centring the longer asymmetric cone/queue envelope.
  // Fit that envelope symmetrically around the rig with space for the unscaled HUD at the edges.
  let across = scenePoints?.length ? 1 : 320;
  let along = scenePoints?.length ? rigLength / 2 : rigLength / 2 + 850;
  for (const point of scenePoints ?? []) {
    const dx = point.x - rigCenter.x, dy = point.y - rigCenter.y;
    across = Math.max(across, Math.abs(-sh * dx + ch * dy));
    along = Math.max(along, Math.abs(ch * dx + sh * dy));
  }
  const overviewZoom = Math.min(drivingZoom * 0.72, width * 0.35 / across, height * 0.3 / along);
  const ahead = height * 0.2 / currentZoom;
  return {
    x: (front.x + ch * ahead) * (1 - blend) + rigCenter.x * blend,
    y: (front.y + sh * ahead) * (1 - blend) + rigCenter.y * blend,
    zoom: drivingZoom + (overviewZoom - drivingZoom) * blend,
  };
}
