import Phaser from 'phaser';

/**
 * Soft glows and small lights drawn as pooled Images instead of Graphics.fillCircle. Every fillCircle is re-triangulated
 * into ~100 vertices each frame; a tinted quad from one 'glow' or 'dot' texture costs nothing. Call soft()/dot() each
 * frame while drawing, then end() once per frame to hide whatever was not used.
 */
export class GlowLayer {
  private pool: Phaser.GameObjects.Image[] = [];
  private n = 0;
  constructor(private scene: Phaser.Scene, private layer: Phaser.GameObjects.Layer, private depth: number) {}

  private next(key: string): Phaser.GameObjects.Image {
    let im = this.pool[this.n];
    if (!im) {
      im = this.scene.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth);
      this.layer.add(im);
      this.pool.push(im);
    } else {
      if (im.texture.key !== key) im.setTexture(key);
      if (!im.visible) im.setVisible(true);
    }
    this.n++;
    return im;
  }
  /** a soft radial glow of radius r (the gradient fades to nothing at the edge, so it reads a little wider than a disc) */
  soft(x: number, y: number, r: number, col: number, a: number) {
    this.next('glow').setPosition(x, y).setScale(r / 28).setRotation(0).setTint(col).setAlpha(a);
  }
  /** a soft glow stretched into an ellipse with radii rx, ry, turned by rot */
  softEllipse(x: number, y: number, rx: number, ry: number, rot: number, col: number, a: number) {
    this.next('glow').setPosition(x, y).setScale(rx / 28, ry / 28).setRotation(rot).setTint(col).setAlpha(a);
  }
  /** a solid anti-aliased disc of radius r: the lamp itself rather than its halo */
  dot(x: number, y: number, r: number, col: number, a: number) {
    this.next('dot').setPosition(x, y).setScale(r / 16).setTint(col).setAlpha(a);
  }
  /** hide the images that went unused this frame and start the next one */
  end() {
    for (let i = this.n; i < this.pool.length; i++) if (this.pool[i].visible) this.pool[i].setVisible(false);
    this.n = 0;
  }
  get size() { return this.pool.length; }
}

/** the two textures the layers draw with: a 64 px soft radial gradient and a 32 px hard disc */
export function makeGlowTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('glow')) return;
  const g = scene.textures.createCanvas('glow', 64, 64)!;
  const c = g.getContext();
  const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  // a soft-edged disc rather than a cone: the halos used to be flat fillCircles, so the core stays near full strength
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grad; c.fillRect(0, 0, 64, 64);
  g.refresh();
  const d = scene.textures.createCanvas('dot', 32, 32)!;
  const dc = d.getContext();
  dc.fillStyle = '#ffffff'; dc.beginPath(); dc.arc(16, 16, 15.5, 0, Math.PI * 2); dc.fill();
  d.refresh();
}
