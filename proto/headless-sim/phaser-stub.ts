// PROTOTYPE: everything the simulation modules need from Phaser at run time when bundled for plain Node.
class EventEmitter {
  private subs = new Map<string, ((...a: any[]) => void)[]>();
  on(ev: string, fn: (...a: any[]) => void) { (this.subs.get(ev) ?? this.subs.set(ev, []).get(ev)!).push(fn); return this; }
  emit(ev: string, ...a: any[]) { for (const fn of this.subs.get(ev) ?? []) fn(...a); return true; }
}
export default { Events: { EventEmitter }, Geom: { Point: class { constructor(public x = 0, public y = 0) {} } } };
