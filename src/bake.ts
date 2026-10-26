import Phaser from 'phaser';

/**
 * Bakes static Graphics (and sign Containers) into textures so Phaser stops re-triangulating their command lists every
 * frame. A baked item is shown through an Image; the source object is kept off the display list and only used to draw
 * the texture. Most items bake lazily the first time the cull loop makes them visible, and their textures are freed
 * again once the camera has moved well away, so VRAM stays bounded. Permanent items (the stations) bake at once and
 * drop their source.
 */
type Src = Phaser.GameObjects.Graphics | Phaser.GameObjects.Container;
/** bounds of the source's drawing in its own local space, before its rotation and scale */
export interface Box { x0: number; y0: number; x1: number; y1: number }

let nextKey = 1;

export class Baked {
  img: Phaser.GameObjects.Image | null = null;
  key = '';
  /** world position of the drawing's centre (road chunks draw world coordinates from a source at the origin): used by
   * the sweep that frees far-away textures */
  x: number; y: number;
  constructor(private baker: Baker, public src: Src | null, public box: Box, public scale: number, public depth: number, public permanent: boolean) {
    this.x = (src ? src.x : 0) + (box.x0 + box.x1) / 2; this.y = (src ? src.y : 0) + (box.y0 + box.y1) / 2;
  }
  /** the cull loop's hook: becoming visible bakes on demand */
  setVisible(v: boolean) {
    if (v) {
      if (!this.img) this.baker.bake(this);
      else if (!this.img.visible) this.img.setVisible(true);
    } else if (this.img && this.img.visible) this.img.setVisible(false);
  }
}

export class Baker {
  items: Baked[] = [];
  private sweepT = 0;
  /** how many bakes happened and the slowest one, for the dev console */
  bakes = 0; maxBakeMs = 0; lastBakeMs = 0;
  constructor(private scene: Phaser.Scene, private layer: Phaser.GameObjects.Layer) {}

  /**
   * Register a source for baking. The source leaves the display list right away; the returned object stands in for it
   * in the cull list. `box` is in the source's local space; `scale` is texels per world unit.
   */
  add(src: Src, box: Box, scale: number, permanent = false): Baked {
    src.removeFromDisplayList();
    const b = new Baked(this, src, box, scale, src.depth, permanent);
    this.items.push(b);
    if (permanent) { this.bake(b); b.img!.setVisible(false); }
    return b;
  }

  bake(b: Baked) {
    const src = b.src;
    if (!src) return;
    const S = b.scale, box = b.box;
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const w = Math.max(2, Math.ceil(bw * S)), h = Math.max(2, Math.ceil(bh * S));
    const t0 = performance.now();
    b.key = 'bake' + nextKey++;
    const tex = this.scene.textures.addDynamicTexture(b.key, w, h);
    if (!tex) return;
    // draw the source unrotated and unscaled at its own position, with the texture's camera framing the box
    const rot = src.rotation, sx = src.scaleX, sy = src.scaleY;
    src.setRotation(0).setScale(1);
    tex.camera.setZoom(S);
    tex.camera.centerOn(src.x + (box.x0 + box.x1) / 2, src.y + (box.y0 + box.y1) / 2);
    tex.draw(src);
    src.setRotation(rot).setScale(sx, sy);
    // The texture is w×h texels (rounded up from the box), so it covers tw×th world units centred on the box centre.
    // The image's origin must be where the source's own origin sits inside that texture: using the unrounded box
    // width here shifts the image by (tw - bw) × x0 / bw, which for road chunks drawn at world coordinates
    // (x0 in the tens of thousands) is a visible gap between neighbouring chunks.
    // Phaser rounds dynamic textures up to even sizes, so read the size it actually made rather than the one asked for.
    const tw = tex.width / S, th = tex.height / S, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const img = this.scene.add.image(src.x, src.y, b.key)
      .setOrigin(0.5 - cx / tw, 0.5 - cy / th)
      .setScale(sx / S, sy / S)
      .setRotation(rot)
      .setDepth(b.depth)
      .setAlpha(src.alpha)
      .setBlendMode(src.blendMode);
    this.layer.add(img);
    b.img = img;
    this.bakes++;
    this.lastBakeMs = performance.now() - t0;
    if (this.lastBakeMs > this.maxBakeMs) this.maxBakeMs = this.lastBakeMs;
    if (b.permanent) { src.destroy(); b.src = null; }
  }

  private free(b: Baked) {
    if (!b.img) return;
    b.img.destroy();
    b.img = null;
    this.scene.textures.remove(b.key);
    b.key = '';
  }

  /** every couple of seconds, drop the textures of items far outside the view so they can be re-baked later */
  sweep(dt: number, cx: number, cy: number, keepR: number) {
    this.sweepT -= dt;
    if (this.sweepT > 0) return;
    this.sweepT = 2;
    const r2 = keepR * keepR;
    for (const b of this.items) {
      if (b.permanent || !b.img) continue;
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > r2) this.free(b);
    }
  }

  /** number of baked textures alive right now */
  get live() { let n = 0; for (const b of this.items) if (b.img) n++; return n; }
}
