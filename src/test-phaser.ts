/**
 * The Phaser stand-in for headless world tests. Load it from a test file with
 * `vi.mock('phaser', async () => (await import('./test-phaser')).phaserStub)`.
 * The job board shuffles its destinations; the stub puts `board.first` (a station ID) first instead.
 */
export const board = { first: '' };
export const phaserStub = {
  default: {
    Events: { EventEmitter: class { emit() {} } }, Scene: class {},
    Utils: { Array: { Shuffle: <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => Number(y.id === board.first) - Number(x.id === board.first)) } },
  },
};
