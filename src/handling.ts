/** Load-dependent limits, recalculated from unmodified cab specifications on every refresh. */
export interface Handling { aMax: number; bComf: number; maxBrake: number }

export function calculateHandling(baseAcceleration: number, cabMultiplier: number, payloadTonnes: number): Handling {
  // Payload adds inertia; service brakes compensate somewhat better than the engine can.
  // At 38 t the rig has 44% of empty acceleration and 59% of empty service braking.
  const accelerationScale = 1 / (1 + Math.max(0, payloadTonnes) / 30);
  const brakeScale = 1 / (1 + Math.max(0, payloadTonnes) / 55);
  return { aMax: baseAcceleration * cabMultiplier * accelerationScale, bComf: 150 * brakeScale, maxBrake: 380 * brakeScale };
}

/** Ordinary pedal braking or a signal approach; crash braking is a separate emergency path. */
export function calculateServiceBrake(speed: number, limits: Pick<Handling, 'bComf' | 'maxBrake'>, signalDistance?: number): number | null {
  if (speed <= 0) return null;
  const scale = limits.bComf / 150;
  const requested = signalDistance === undefined ? -260 : Math.min(-30, -(speed * speed) / (2 * Math.max(30, signalDistance - 12)) * 0.6);
  return Math.max(-limits.maxBrake, requested * scale);
}

