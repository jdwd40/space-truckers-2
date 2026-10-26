/**
 * Cosmetic regions along the route. Each zone tints the sky, adds a coloured fog and shifts the ambient pad; the
 * world scene crossfades between them as the rig drives from one anchor circle into another. Nothing here touches
 * gameplay.
 */
export type ZoneId = 'open' | 'belt' | 'nebula' | 'giant' | 'ice' | 'shipyard';

export interface ZoneDef {
  id: ZoneId; name: string; tagline: string;
  /** full-screen colour wash behind everything, and how strong it is */
  wash: number; washAlpha: number;
  /** tint applied to the star field */
  starTint: number;
  /** drifting fog puffs around the camera */
  fog: number; fogAlpha: number;
  /** ambient pad: lowpass cutoff (Hz) and gain */
  padCutoff: number; padGain: number;
  /** circles the zone covers; weight falls off linearly from the centre to the rim */
  anchors: { x: number; y: number; r: number }[];
}

export const ZONES: ZoneDef[] = [
  { id: 'open', name: 'Open Lanes', tagline: 'Nothing but stars and road', wash: 0x0a1030, washAlpha: 0, starTint: 0xffffff, fog: 0x3a5fd0, fogAlpha: 0, padCutoff: 900, padGain: 0.022, anchors: [] },
  { id: 'belt', name: 'Vesta Asteroid Belt', tagline: 'Mind the gravel', wash: 0x3a2a18, washAlpha: 0.18, starTint: 0xffe2c0, fog: 0x8a6a48, fogAlpha: 0.18, padCutoff: 600, padGain: 0.020,
    anchors: [{ x: 0, y: 16000, r: 5200 }, { x: 8200, y: 12900, r: 4200 }, { x: 13200, y: 6200, r: 3600 }] },
  { id: 'nebula', name: 'Violet Nebula', tagline: 'Visibility: gorgeous', wash: 0x3a1450, washAlpha: 0.28, starTint: 0xe0b8ff, fog: 0xb04aa8, fogAlpha: 0.35, padCutoff: 1400, padGain: 0.026,
    anchors: [{ x: -11000, y: 9000, r: 5500 }] },
  { id: 'giant', name: 'Jove Approach', tagline: 'Big planet, little truck', wash: 0x402010, washAlpha: 0.22, starTint: 0xffd0a0, fog: 0xffa45c, fogAlpha: 0.16, padCutoff: 500, padGain: 0.026,
    anchors: [{ x: 16000, y: -1000, r: 6500 }] },
  { id: 'ice', name: 'Glacier Ice Field', tagline: 'Frosty out there', wash: 0x10324a, washAlpha: 0.22, starTint: 0xc8f0ff, fog: 0x9be7ff, fogAlpha: 0.22, padCutoff: 1800, padGain: 0.018,
    anchors: [{ x: 15000, y: -14000, r: 5500 }, { x: 15500, y: -8000, r: 3500 }] },
  { id: 'shipyard', name: 'Kestrel Shipyards', tagline: 'Busy skies, slow down and enjoy it', wash: 0x0e2a3a, washAlpha: 0.16, starTint: 0xd8ecff, fog: 0x5ad8ff, fogAlpha: 0.12, padCutoff: 1100, padGain: 0.022,
    anchors: [{ x: 900, y: -16000, r: 5000 }, { x: -15000, y: -14500, r: 4500 }] },
];

export const ZONE_BY_ID: Record<ZoneId, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<ZoneId, ZoneDef>;

/** the zone whose anchor the point sits deepest inside; 'open' when it is outside every anchor */
export function zoneAt(x: number, y: number): ZoneDef {
  let best = ZONE_BY_ID.open, bw = 0;
  for (const z of ZONES) for (const a of z.anchors) {
    const w = 1 - Math.hypot(x - a.x, y - a.y) / a.r;
    if (w > bw) { bw = w; best = z; }
  }
  return best;
}

/** blend two 0xRRGGBB colours per channel */
export function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** the displayed (or target) look of a zone, as plain numbers so it can be lerped */
export interface ZoneLook { wash: number; washAlpha: number; starTint: number; fog: number; fogAlpha: number; padCutoff: number; padGain: number }
export function lookOf(z: ZoneDef): ZoneLook {
  return { wash: z.wash, washAlpha: z.washAlpha, starTint: z.starTint, fog: z.fog, fogAlpha: z.fogAlpha, padCutoff: z.padCutoff, padGain: z.padGain };
}
export function lerpLook(a: ZoneLook, b: ZoneLook, t: number): ZoneLook {
  return {
    wash: lerpColor(a.wash, b.wash, t), washAlpha: a.washAlpha + (b.washAlpha - a.washAlpha) * t,
    starTint: lerpColor(a.starTint, b.starTint, t),
    fog: lerpColor(a.fog, b.fog, t), fogAlpha: a.fogAlpha + (b.fogAlpha - a.fogAlpha) * t,
    padCutoff: a.padCutoff + (b.padCutoff - a.padCutoff) * t, padGain: a.padGain + (b.padGain - a.padGain) * t,
  };
}
