import Phaser from 'phaser';
import { WorldScene } from './world';
import { UIScene } from './ui';
import { load } from './state';

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
