import Phaser from 'phaser';
import { WorldScene } from './world';
import { UIScene } from './ui';
import { G, load } from './state';

load();

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#070b1c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene: [WorldScene, UIScene],
  fps: { target: 60 },
});
(window as any).__game = game;
// dev only: poke the game state from the console, e.g. `G.fuel = 0.001` to test the out-of-fuel rescue
if (import.meta.env.DEV) (window as any).G = G;
