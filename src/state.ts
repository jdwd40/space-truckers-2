import Phaser from 'phaser';

/** Cruise speeds (world units per second) for settings 0..5. */
export const SPEEDS = [0, 90, 150, 215, 280, 345];
export const KMH = 4.5; // display factor

export const bus = new Phaser.Events.EventEmitter();

export interface HaulClass { name: string; trailers: number[]; mult: number; rank: number; }
export const CLASSES: HaulClass[] = [
  { name: 'Small load', trailers: [38], mult: 1.0, rank: 0 },
  { name: 'Box trailer', trailers: [54], mult: 1.3, rank: 1 },
  { name: 'Long hauler', trailers: [72], mult: 1.7, rank: 2 },
  { name: 'Road train', trailers: [50, 50], mult: 2.3, rank: 3 },
];
export const RANKS = [
  { name: 'Rookie', at: 0 },
  { name: 'Hauler', at: 1200 },
  { name: 'Road Pro', at: 3500 },
  { name: 'Veteran', at: 7500 },
  { name: 'Legend', at: 15000 },
];

export interface Job {
  id: string; cargo: string; from: string; to: string; cls: number; pay: number; dist: number;
  stage: 'pickup' | 'deliver'; target: number; elapsed: number; locked?: boolean; remote?: boolean; delayed?: boolean;
}

export const FUEL_PRICE = 2.4; // credits per percent
/** Lay-by passengers: seats per trip and the fare each pays on arrival at the next station. */
export const PAX_MAX = 3;
export const PAX_PAY = 300;

/** Rig upgrades bought in the garage with earnings. Three kinds, three levels each. */
export type UpId = 'tank' | 'bumper' | 'cab';
export interface UpgradeDef { id: UpId; name: string; color: number; prices: number[]; now: string[]; }
export const UPGRADES: UpgradeDef[] = [
  { id: 'tank', name: 'Bigger fuel tank', color: 0x4fe08a, prices: [300, 800, 1700],
    now: ['Standard tank', 'Tank +35% — about 130 km per fill', 'Tank +70% — about 160 km per fill', 'Tank +110% — about 200 km per fill'] },
  { id: 'bumper', name: 'Sturdier bumpers', color: 0xffb03c, prices: [300, 700, 1500],
    now: ['Standard bumpers', 'Bump fees -25%, shrug off harder hits, repairs 15% quicker', 'Bump fees -45%, shrug off much harder hits, repairs 30% quicker', 'Bump fees -65%, only a real smash is an accident, repairs 45% quicker'] },
  { id: 'cab', name: 'Faster cab', color: 0x5ad8ff, prices: [400, 1000, 2000],
    now: ['Standard cab', 'Cruises 7% faster, pulls away 25% quicker', 'Cruises 14% faster, pulls away 50% quicker', 'Cruises 22% faster, pulls away 80% quicker'] },
];
export const UP: Record<UpId, number> = { tank: 0, bumper: 0, cab: 0 };
export const tankMult = () => [1, 1.35, 1.7, 2.1][UP.tank];
export const cabSpeed = () => [1, 1.07, 1.14, 1.22][UP.cab];
export const cabAccel = () => [1, 1.25, 1.5, 1.8][UP.cab];
export const bumperFee = () => [1, 0.75, 0.55, 0.35][UP.bumper];
export const bumperCrashAt = () => [62, 74, 88, 104][UP.bumper];
export const bumperRepair = () => [1, 0.85, 0.7, 0.55][UP.bumper];
export function nextUpgrade(u: UpgradeDef): { price: number; text: string } | null {
  const l = UP[u.id];
  return l >= 3 ? null : { price: u.prices[l], text: u.now[l + 1] };
}

export const G = {
  money: 250,
  earned: 0,
  deliveries: 0,
  fuel: 0.32,
  speedSet: 0,
  braking: true,
  job: null as Job | null,
  muted: false,
  mode: 'title' as 'title' | 'board' | 'drive',
  hintsSeen: {} as Record<string, boolean>,
  fines: 0,
  warned: false,
  /** passengers aboard this trip, picked up at lay-bys; paid out at the next station docked */
  pax: 0,
  paxFrom: '' as string,
};

export function rankOf(earned: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (earned >= RANKS[i].at) r = i;
  return r;
}

export function save(): void {
  try {
    localStorage.setItem('spacetrucker-v1', JSON.stringify({ money: G.money, earned: G.earned, deliveries: G.deliveries, hints: G.hintsSeen, up: UP }));
  } catch { /* ignore */ }
}
export function load(): void {
  try {
    const raw = localStorage.getItem('spacetrucker-v1');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (typeof d.money === 'number') G.money = d.money;
    if (typeof d.earned === 'number') G.earned = d.earned;
    if (typeof d.deliveries === 'number') G.deliveries = d.deliveries;
    if (d.hints) G.hintsSeen = d.hints;
    if (d.up) for (const k of ['tank', 'bumper', 'cab'] as UpId[]) if (typeof d.up[k] === 'number') UP[k] = Math.max(0, Math.min(3, Math.floor(d.up[k])));
  } catch { /* ignore */ }
}

export function toast(msg: string, color = '#ffffff', dur = 3200): void { bus.emit('toast', msg, color, dur); }
export function hint(key: string, msg: string): void {
  if (G.hintsSeen[key]) return;
  G.hintsSeen[key] = true;
  bus.emit('hint', msg);
  save();
}

export function money(n: number): string { return '¢' + Math.round(n).toLocaleString('en-US'); }
export function distTxt(d: number): string {
  if (d >= 1000) return (Math.round(d / 100) / 10).toFixed(1) + ' km';
  return Math.max(0, Math.round(d / 50) * 50) + ' m';
}
