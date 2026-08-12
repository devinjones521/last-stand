// ---------------------------------------------------------------------------
// The camera. A zoom/pan window onto the board.
//
// The board is a fixed 1024x640 world and the canvas is CSS-scaled to fit,
// which is fine on a desktop and unplayable on a phone: 32 columns across a
// 390px screen puts a cell at about 12px, well under a fingertip. So the view
// can be pinched in.
//
// Zoom never goes below 1 and the pan is always clamped inside the board, so
// at rest this is the identity transform - the desktop view is bit-for-bit
// what it was before the camera existed, and there is no letterboxing to draw
// around at any zoom level.
// ---------------------------------------------------------------------------

import { CANVAS_W, CANVAS_H, GRID } from './config.js';

export const MIN_SCALE = 1;
export const MAX_SCALE = 4.5;

export class Viewport {
  constructor() {
    this.scale = 1;
    // World coordinate sitting at the top-left corner of the visible area.
    this.x = 0;
    this.y = 0;
  }

  get zoomed() { return this.scale > MIN_SCALE + 1e-4; }

  /** Visible slice of the world, in world units. */
  get viewW() { return CANVAS_W / this.scale; }
  get viewH() { return CANVAS_H / this.scale; }

  /** Push the camera onto a context. Everything after this draws in world space. */
  apply(ctx) {
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x, -this.y);
  }

  /** Keep the window inside the board, so the field always fills the frame. */
  clamp() {
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale));
    this.x = Math.min(CANVAS_W - this.viewW, Math.max(0, this.x));
    this.y = Math.min(CANVAS_H - this.viewH, Math.max(0, this.y));
  }

  /**
   * Zoom to an absolute scale while pinning one world point under the same
   * screen position - the anchor is the cursor, or the midpoint of a pinch.
   */
  zoomTo(scale, anchorX, anchorY) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    if (next === this.scale) return;
    // Screen offset of the anchor, in world units, has to survive the change.
    this.x = anchorX - (anchorX - this.x) * (this.scale / next);
    this.y = anchorY - (anchorY - this.y) * (this.scale / next);
    this.scale = next;
    this.clamp();
  }

  zoomBy(factor, anchorX, anchorY) {
    this.zoomTo(this.scale * factor, anchorX, anchorY);
  }

  /** Step zoom, anchored on the middle of the view - for buttons and keys. */
  step(factor) {
    this.zoomBy(factor, this.x + this.viewW / 2, this.y + this.viewH / 2);
  }

  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /** Centre the view on a world point, as far as the clamp allows. */
  centerOn(wx, wy) {
    this.x = wx - this.viewW / 2;
    this.y = wy - this.viewH / 2;
    this.clamp();
  }

  reset() {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
  }

  /**
   * A pointer event to a world point. Two conversions stack: CSS pixels to the
   * fixed 1024x640 board (the canvas is scaled to fit its box), then board to
   * camera window.
   */
  toWorld(clientX, clientY, rect) {
    const bx = ((clientX - rect.left) / rect.width) * CANVAS_W;
    const by = ((clientY - rect.top) / rect.height) * CANVAS_H;
    return {
      x: this.x + bx / this.scale,
      y: this.y + by / this.scale,
    };
  }

  toCell(clientX, clientY, rect) {
    const p = this.toWorld(clientX, clientY, rect);
    return { x: Math.floor(p.x / GRID.cell), y: Math.floor(p.y / GRID.cell) };
  }

  /** World distance covered by a screen drag, for 1:1 finger-follows-ground pan. */
  screenToWorldDelta(dx, dy, rect) {
    return {
      x: (dx / rect.width) * CANVAS_W / this.scale,
      y: (dy / rect.height) * CANVAS_H / this.scale,
    };
  }
}
