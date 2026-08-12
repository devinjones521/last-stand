// ---------------------------------------------------------------------------
// All canvas drawing. Reads game state, never mutates it.
// ---------------------------------------------------------------------------

import { GRID, CANVAS_W, CANVAS_H, COLORS } from './config.js';
import { TOWER_DEFS } from './towers.js';
import { idx } from './pathfinding.js';

const CELL = GRID.cell;
const TAU = Math.PI * 2;

/**
 * Per-archetype build. These drive one shared zombie renderer, so every type
 * gets a distinct silhouette without a bespoke draw routine each.
 *   w = torso width · head = head radius · arm = reach · gait = stride speed
 *   hunch = forward lean (negative leans back)
 */
const BODY = {
  walker:      { w: 0.80, head: 0.40, arm: 0.95, gait: 1.0, hunch: 0.10 },
  runner:      { w: 0.66, head: 0.36, arm: 0.80, gait: 2.0, hunch: 0.34 },
  crawler:     { w: 0.95, head: 0.34, arm: 1.15, gait: 2.6, hunch: 0.62, legless: true },
  brute:       { w: 1.12, head: 0.38, arm: 1.15, gait: 0.70, hunch: 0.18, pads: true },
  hazmat:      { w: 0.84, head: 0.46, arm: 0.82, gait: 1.0, hunch: 0.06, visor: true },
  screamer:    { w: 0.68, head: 0.44, arm: 0.78, gait: 1.1, hunch: -0.14, maw: true },
  regenerator: { w: 0.88, head: 0.40, arm: 0.92, gait: 0.90, hunch: 0.12, sinew: true },
  bloater:     { w: 1.18, head: 0.32, arm: 0.72, gait: 0.60, hunch: 0.04, belly: true },
  husk:        { w: 0.74, head: 0.36, arm: 1.05, gait: 1.0, hunch: 0.22, angular: true },
  juggernaut:  { w: 1.28, head: 0.34, arm: 1.25, gait: 0.48, hunch: 0.12, pads: true, plates: true },
};

/** Nudge a #rrggbb hex toward white. */
function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + amount);
  const g = Math.min(255, ((n >> 8) & 255) + amount);
  const b = Math.min(255, (n & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

/** Deterministic hash-noise so the ground texture is stable between reloads. */
function noise(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * How dark the unlit battlefield gets. Kept deliberately modest: this is a
 * night siege for atmosphere, but a tower defense has to stay readable at a
 * glance across the whole board, so legibility wins over mood.
 */
const NIGHT = 'rgba(6,8,5,0.38)';

function layer(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.ctx = canvas.getContext('2d');
    this.terrain = this.bakeTerrain();
    // Which map's rubble is currently baked into that layer.
    this.bakedMap = game.map.id;
    this.time = 0;

    // Permanent ground marks — blood, scorch, the worn track the horde beats
    // into the dirt. Drawn once each, never re-drawn per frame.
    this.decals = layer(CANVAS_W, CANVAS_H);
    this.decalCtx = this.decals.getContext('2d');
    this.epoch = game.epoch;

    // Static tower art, re-baked only when the tower set changes.
    this.towerLayer = layer(CANVAS_W, CANVAS_H);
    this.towerCtx = this.towerLayer.getContext('2d');
    this.builtVersion = -1;

    // Darkness with holes punched in it wherever something emits light.
    this.lights = layer(CANVAS_W, CANVAS_H);
    this.lightCtx = this.lights.getContext('2d');
    this.spriteCache = new Map();
    this.sorted = [];
    this.wearTick = 0;
  }

  /** A cached soft radial blob, tinted. Far cheaper than per-frame gradients. */
  sprite(color) {
    let s = this.spriteCache.get(color);
    if (s) return s;
    const size = 128;
    s = layer(size, size);
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    if (color === '#fff') {
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.42, 'rgba(255,255,255,0.62)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      const [r, gg, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      grad.addColorStop(0, `rgba(${r},${gg},${b},0.95)`);
      grad.addColorStop(0.4, `rgba(${r},${gg},${b},0.4)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.spriteCache.set(color, s);
    return s;
  }

  /** The static ground + rubble is drawn once into an offscreen canvas. */
  bakeTerrain() {
    // Bake at device resolution so the grid lines stay crisp on HiDPI screens.
    const s = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(CANVAS_W * s);
    c.height = Math.round(CANVAS_H * s);
    const g = c.getContext('2d');
    g.scale(s, s);

    g.fillStyle = COLORS.ground;
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Mottled dirt.
    for (let y = 0; y < GRID.rows; y++) {
      for (let x = 0; x < GRID.cols; x++) {
        const n = noise(x, y);
        if (n > 0.55) {
          g.fillStyle = `rgba(255,255,255,${(n - 0.55) * 0.055})`;
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
        } else if (n < 0.2) {
          g.fillStyle = `rgba(0,0,0,${(0.2 - n) * 0.22})`;
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }

    // Scattered grass tufts and cracks.
    for (let i = 0; i < 420; i++) {
      const x = noise(i, 1.7) * CANVAS_W;
      const y = noise(i, 9.3) * CANVAS_H;
      const n = noise(i * 3.1, 4.2);
      g.fillStyle = n > 0.5
        ? `rgba(120,150,80,${0.05 + n * 0.07})`
        : `rgba(0,0,0,${0.05 + n * 0.1})`;
      g.fillRect(x, y, 1 + n * 3, 1 + n * 2);
    }

    g.strokeStyle = COLORS.gridLine;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= GRID.cols; x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, CANVAS_H); }
    for (let y = 0; y <= GRID.rows; y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(CANVAS_W, y * CELL + 0.5); }
    g.stroke();

    for (const o of this.game.map.obstacles) this.drawObstacle(g, o);
    return c;
  }

  drawObstacle(g, o) {
    const x = o.x * CELL;
    const y = o.y * CELL;
    const w = o.w * CELL;
    const h = o.h * CELL;

    if (o.kind === 'wreck') {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 3, y + 5, w - 4, h - 4);
      g.fillStyle = COLORS.wreck;
      g.fillRect(x + 2, y + 2, w - 4, h - 6);
      g.fillStyle = COLORS.wreckTop;
      g.fillRect(x + 5, y + 4, w - 10, h - 12);
      g.fillStyle = 'rgba(20,25,30,0.8)';
      g.fillRect(x + 8, y + 7, w - 16, Math.max(3, h - 18));
      // rust streaks
      for (let i = 0; i < 6; i++) {
        const n = noise(o.x + i, o.y);
        g.fillStyle = `rgba(120,60,30,${0.15 + n * 0.2})`;
        g.fillRect(x + 3 + n * (w - 8), y + 3, 2, h - 8);
      }
    } else if (o.kind === 'barrel') {
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath(); g.ellipse(x + CELL / 2 + 2, y + CELL / 2 + 3, 11, 9, 0, 0, TAU); g.fill();
      g.fillStyle = COLORS.barrel;
      g.beginPath(); g.arc(x + CELL / 2, y + CELL / 2, 11, 0, TAU); g.fill();
      g.strokeStyle = '#2a2712'; g.lineWidth = 2;
      g.beginPath(); g.arc(x + CELL / 2, y + CELL / 2, 11, 0, TAU); g.stroke();
      g.fillStyle = '#6b6030';
      g.beginPath(); g.arc(x + CELL / 2 - 2, y + CELL / 2 - 2, 5, 0, TAU); g.fill();
    } else {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 3, y + 4, w - 4, h - 4);
      g.fillStyle = COLORS.rubble;
      g.fillRect(x + 2, y + 2, w - 4, h - 5);
      // chunky blocks
      for (let cy = 0; cy < o.h; cy++) {
        for (let cx = 0; cx < o.w; cx++) {
          const n = noise(o.x + cx * 2.3, o.y + cy * 1.9);
          g.fillStyle = n > 0.5 ? COLORS.rubbleTop : '#2c2d28';
          const bx = x + cx * CELL + 4 + n * 4;
          const by = y + cy * CELL + 4 + noise(cy, cx) * 4;
          g.fillRect(bx, by, 9 + n * 8, 8 + n * 6);
        }
      }
    }
  }

  // -------------------------------------------------------------------------

  draw(view, dt) {
    const { ctx, game } = this;
    this.time += dt;

    ctx.save();
    // The zoom/pan window goes on first, so impact shake and everything after
    // it stays in world space and needs no knowledge of the camera.
    if (view.viewport) view.viewport.apply(ctx);

    // Camera: a scale punch on heavy impacts, plus positional shake. Both are
    // measured against what's on screen — punch scales about the centre of the
    // *view*, and shake is divided back down by zoom so a kick is the same
    // number of screen pixels however far in you are. At 1x the view centre is
    // the board centre and the divisor is 1, so this is the original behaviour.
    // A new map means new rubble baked into the ground layer.
    if (game.map.id !== this.bakedMap) {
      this.bakedMap = game.map.id;
      this.terrain = this.bakeTerrain();
    }

    const zoom = view.viewport?.scale ?? 1;
    const cx = view.viewport ? view.viewport.x + view.viewport.viewW / 2 : CANVAS_W / 2;
    const cy = view.viewport ? view.viewport.y + view.viewport.viewH / 2 : CANVAS_H / 2;
    if (game.punch > 0.0005) {
      const k = 1 + game.punch;
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }
    if (game.shake > 0.2) {
      ctx.translate(
        ((Math.random() - 0.5) * game.shake) / zoom,
        ((Math.random() - 0.5) * game.shake) / zoom,
      );
    }

    ctx.drawImage(this.terrain, 0, 0, CANVAS_W, CANVAS_H);

    this.consumeDecals(dt);
    ctx.drawImage(this.decals, 0, 0, CANVAS_W, CANVAS_H);

    this.drawRoute(game.route, COLORS.route, COLORS.routeLine, false);
    if (view.previewRoute) this.drawRoute(view.previewRoute, 'rgba(232,145,42,0.10)', 'rgba(255,190,90,0.65)', true);

    this.drawPuddles();
    this.drawSpawn();
    this.drawBase();
    this.drawGroundEffects();

    // The tower bake is a 1024x640 bitmap, so magnifying it just magnifies its
    // pixels — sandbags go soft while the live-drawn turret above them stays
    // sharp, which reads as a bug. Past a modest zoom, draw the static art live
    // instead. It costs nothing: the deeper you go the fewer towers are on
    // screen, so the work shrinks exactly as the per-tower price goes up.
    if (zoom > 1.25) {
      const vp = view.viewport;
      for (const t of game.towers) {
        if (this.visible(vp, t.x, t.y)) this.drawTowerStatic(ctx, t);
      }
    } else {
      if (game.buildVersion !== this.builtVersion) {
        this.builtVersion = game.buildVersion;
        this.bakeTowers();
      }
      ctx.drawImage(this.towerLayer, 0, 0, CANVAS_W, CANVAS_H);
    }
    for (const t of game.towers) this.drawTower(t, view);

    this.drawEnemies();
    this.drawProjectiles();
    this.drawAirEffects();
    this.drawAbilityFx(view);

    // Night falls after the world is drawn, so everything sits in real dark and
    // only muzzle flashes, fires and the camp lamps carve it back open.
    this.drawLighting();
    this.drawGlow();

    // UI-ish layers stay above the darkness so they never lose legibility.
    this.drawFloaters();
    this.drawOverlay(view);
    this.drawCursor(view);
    ctx.restore();
  }

  /** Drain the sim's decal queue onto the permanent layer. */
  consumeDecals(dt) {
    const { game } = this;

    // A new run wipes the battlefield clean.
    if (game.epoch !== this.epoch) {
      this.epoch = game.epoch;
      this.decalCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    }

    const g = this.decalCtx;
    for (const d of game.decals) {
      if (d.kind === 'blood') {
        // A few overlapping blobs read as a splatter, not a circle.
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * TAU;
          const dist = Math.random() * d.r;
          g.fillStyle = `rgba(74,10,16,${0.1 + Math.random() * 0.16})`;
          g.beginPath();
          g.arc(d.x + Math.cos(a) * dist, d.y + Math.sin(a) * dist,
            d.r * (0.22 + Math.random() * 0.4), 0, TAU);
          g.fill();
        }
      } else if (d.kind === 'scorch') {
        const grad = g.createRadialGradient(d.x, d.y, 1, d.x, d.y, d.r);
        grad.addColorStop(0, 'rgba(0,0,0,0.42)');
        grad.addColorStop(0.6, 'rgba(0,0,0,0.2)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(d.x, d.y, d.r, 0, TAU);
        g.fill();
      }
    }
    game.decals.length = 0;

    // The horde wears a track into the dirt wherever it actually walks. Purely
    // a render-side effect derived from live positions - the sim knows nothing.
    this.wearTick -= dt;
    if (this.wearTick <= 0 && game.enemies.length) {
      this.wearTick = 0.1;
      g.fillStyle = 'rgba(28,22,14,0.05)';
      for (const e of game.enemies) {
        if (e.dead) continue;
        g.beginPath();
        g.ellipse(e.x, e.y + e.radius * 0.6, e.radius * 0.5, e.radius * 0.22, 0, 0, TAU);
        g.fill();
      }
    }
  }

  /** Collect every light on the field this frame. */
  collectLights() {
    const { game } = this;
    const out = [];

    // The camp burns floodlights; the breach glows with whatever is coming.
    out.push({ x: (this.game.goal.x + 0.5) * CELL, y: (this.game.goal.y + 0.5) * CELL, r: 175, a: 1 });
    out.push({
      x: (this.game.spawn.x + 0.5) * CELL, y: (this.game.spawn.y + 0.5) * CELL,
      r: 120 + Math.sin(this.time * 2.2) * 8, a: 0.9,
    });

    for (const t of game.towers) {
      const s = t.stats;
      // Even a plain barricade catches enough light to read as an obstacle.
      if (s.inert) { out.push({ x: (t.x + 0.5) * CELL, y: (t.y + 0.5) * CELL, r: 46, a: 0.5 }); continue; }
      // Engaged towers light up their own firing position.
      const hot = t.ref ? 1 : 0.7;
      out.push({
        x: (t.x + 0.5) * CELL, y: (t.y + 0.5) * CELL,
        r: (66 + t.level * 4) * hot, a: 0.6 + 0.3 * hot,
      });
    }

    // Zombies catch a little ambient light, so a pack is never a black void.
    for (const e of game.enemies) {
      if (!e.dead) out.push({ x: e.x, y: e.y, r: e.radius * 3.4, a: 0.45 });
    }

    for (const p of game.puddles) {
      out.push({ x: p.x, y: p.y, r: p.radius * 1.7, a: Math.min(1, p.life / 1.5) * 0.95 });
    }

    // A burning rally flare throws real light.
    if (game.lure && game.clock < game.lure.until) {
      out.push({
        x: (game.lure.x + 0.5) * CELL, y: (game.lure.y + 0.5) * CELL,
        r: 150 + Math.sin(this.time * 18) * 10, a: 1,
      });
    }
    for (const s of game.strikes) {
      out.push({ x: s.x, y: s.y, r: s.radius * (0.6 + s.t / s.dur), a: 0.7 });
    }

    for (const fx of game.effects) {
      const k = fx.life / fx.max;
      if (fx.kind === 'explosion') out.push({ x: fx.x, y: fx.y, r: fx.r * 2.4 * k, a: 1 });
      else if (fx.kind === 'muzzle') out.push({ x: fx.x, y: fx.y, r: 52 * k, a: 1 });
      else if (fx.kind === 'cone') out.push({ x: fx.x, y: fx.y, r: fx.r * 1.5, a: 0.9 * k });
      else if (fx.kind === 'arc') out.push({ x: fx.x2, y: fx.y2, r: 46 * k, a: 0.9 });
      else if (fx.kind === 'beam') out.push({ x: fx.x2, y: fx.y2, r: 34 * k, a: 0.8 });
    }
    return out;
  }

  drawLighting() {
    const L = this.lightCtx;
    L.globalCompositeOperation = 'source-over';
    L.globalAlpha = 1;
    L.clearRect(0, 0, CANVAS_W, CANVAS_H);
    L.fillStyle = NIGHT;
    L.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Punch the darkness away around every light source.
    const white = this.sprite('#fff');
    L.globalCompositeOperation = 'destination-out';
    for (const l of this.collectLights()) {
      if (l.r <= 0) continue;
      L.globalAlpha = Math.min(1, l.a);
      L.drawImage(white, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    L.globalAlpha = 1;
    L.globalCompositeOperation = 'source-over';

    this.ctx.drawImage(this.lights, 0, 0, CANVAS_W, CANVAS_H);
  }

  /** Warm additive bloom over the top, for things that are genuinely burning. */
  drawGlow() {
    const { ctx, game } = this;
    ctx.globalCompositeOperation = 'lighter';

    const fire = this.sprite('#ff7a1e');
    for (const p of game.puddles) {
      if (p.acid) continue;
      const a = Math.min(1, p.life / 1.5) * (0.22 + 0.1 * Math.sin(this.time * 12 + p.x));
      const r = p.radius * 1.5;
      ctx.globalAlpha = a;
      ctx.drawImage(fire, p.x - r, p.y - r, r * 2, r * 2);
    }

    for (const fx of game.effects) {
      const k = fx.life / fx.max;
      if (fx.kind === 'explosion') {
        const r = fx.r * 1.9;
        ctx.globalAlpha = k * 0.65;
        ctx.drawImage(fire, fx.x - r, fx.y - r, r * 2, r * 2);
      } else if (fx.kind === 'muzzle') {
        const r = 30 * k;
        ctx.globalAlpha = k * 0.5;
        ctx.drawImage(fire, fx.x - r, fx.y - r, r * 2, r * 2);
      }
    }

    // The camp's own lamps, always burning.
    const warm = this.sprite('#c7ab6d');
    const bx = (this.game.goal.x + 0.5) * CELL;
    const by = (this.game.goal.y + 0.5) * CELL;
    ctx.globalAlpha = 0.16;
    ctx.drawImage(warm, bx - 90, by - 90, 180, 180);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawRoute(route, fill, stroke, dashed) {
    if (!route || route.length < 2) return;
    const { ctx } = this;

    ctx.fillStyle = fill;
    for (const c of route) ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dashed) {
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -this.time * 26;
    }
    ctx.beginPath();
    ctx.moveTo((route[0].x + 0.5) * CELL, (route[0].y + 0.5) * CELL);
    for (let i = 1; i < route.length; i++) {
      ctx.lineTo((route[i].x + 0.5) * CELL, (route[i].y + 0.5) * CELL);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawSpawn() {
    const { ctx } = this;
    const x = (this.game.spawn.x + 0.5) * CELL;
    const y = (this.game.spawn.y + 0.5) * CELL;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);

    const grad = ctx.createRadialGradient(x, y, 2, x, y, CELL * 1.8);
    grad.addColorStop(0, `rgba(210,60,45,${0.35 + pulse * 0.2})`);
    grad.addColorStop(1, 'rgba(210,60,45,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - CELL * 2, y - CELL * 2, CELL * 4, CELL * 4);

    // Torn chain-link fence with a hole in it - THE breach.
    ctx.fillStyle = '#14100f';
    ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
    ctx.strokeStyle = COLORS.spawn;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 10 + pulse * 2, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(230,90,70,${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 14 + pulse * 4, 0, TAU);
    ctx.stroke();

    this.edgeLabel('BREACH', x, y, 1);
  }

  /**
   * A label under (dir 1) or over (dir -1) a point, nudged back onto the board.
   * The breach and the camp sit on an edge, and which edge depends on the map,
   * so neither can assume it has room on the side it would rather use.
   */
  edgeLabel(text, x, y, dir) {
    const { ctx } = this;
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '800 10px "Big Shoulders", sans-serif';
    ctx.textAlign = 'center';

    const half = ctx.measureText(text).width / 2 + 2;
    const lx = Math.min(CANVAS_W - half, Math.max(half, x));
    // Flip to the other side rather than draw off the top or bottom edge.
    const away = y + dir * CELL * 0.95;
    const ly = away < 10 || away > CANVAS_H - 4 ? y - dir * CELL * 0.9 : away;
    ctx.fillText(text, lx, ly);
  }

  drawBase() {
    const { ctx, game } = this;
    const x = (this.game.goal.x + 0.5) * CELL;
    const y = (this.game.goal.y + 0.5) * CELL;
    const hpFrac = Math.max(0, game.baseHp / game.maxBaseHp);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - CELL * 0.7, y - CELL * 0.7 + 3, CELL * 1.4, CELL * 1.4);

    // Sandbagged bunker.
    ctx.fillStyle = COLORS.baseDark;
    ctx.fillRect(x - CELL * 0.7, y - CELL * 0.7, CELL * 1.4, CELL * 1.4);
    ctx.fillStyle = COLORS.base;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillRect(
          x - CELL * 0.62 + c * 15 + (r % 2 ? 5 : 0),
          y - CELL * 0.62 + r * 11,
          13, 9,
        );
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - CELL * 0.7, y - CELL * 0.7, CELL * 1.4, CELL * 1.4);

    // Camp health bar.
    const bw = CELL * 1.5;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - bw / 2, y + CELL * 0.8, bw, 6);
    ctx.fillStyle = hpFrac > 0.5 ? COLORS.ok : hpFrac > 0.25 ? COLORS.amber : COLORS.danger;
    ctx.fillRect(x - bw / 2 + 1, y + CELL * 0.8 + 1, (bw - 2) * hpFrac, 4);

    this.edgeLabel('CAMP', x, y, -1);
  }

  drawPuddles() {
    const { ctx } = this;
    for (const p of this.game.puddles) {
      const a = Math.min(1, p.life / 1.2) * 0.5;
      const grad = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.radius);
      grad.addColorStop(0, p.acid ? `rgba(157,255,43,${a})` : `rgba(255,110,26,${a})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, TAU);
      ctx.fill();

      // Flicker for fire.
      if (!p.acid) {
        ctx.fillStyle = `rgba(255,200,60,${a * 0.5 * (0.6 + 0.4 * Math.sin(this.time * 14 + p.x))})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 0.45, 0, TAU);
        ctx.fill();
      }
    }
  }

  // -- towers ---------------------------------------------------------------

  /**
   * Re-bake every tower's static art (shadow, emplacement, sandbags, pips,
   * barricades) into one layer. Only runs when the tower set actually changes.
   *
   * This matters: redrawing ~20 fill operations per tower per frame cost 15ms
   * on a 459-tower board. Baking it drops that to a single drawImage.
   */
  bakeTowers() {
    const g = this.towerCtx;
    g.clearRect(0, 0, CANVAS_W, CANVAS_H);
    for (const t of this.game.towers) this.drawTowerStatic(g, t);
  }

  /** One tower's unchanging art. Baked in bulk, or drawn live when zoomed in. */
  drawTowerStatic(g, t) {
    const def = TOWER_DEFS[t.defId];
    const x = (t.x + 0.5) * CELL;
    const y = (t.y + 0.5) * CELL;

    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(-CELL / 2 + 2, -CELL / 2 + 4, CELL - 4, CELL - 4);

    if (def.shape === 'wall') {
      this.drawBarricade(g, t);
    } else {
      // Sandbag pad, gains rows as the tower levels.
      g.fillStyle = '#4a4638';
      g.fillRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);
      g.fillStyle = '#5c5744';
      const rows = 2 + Math.min(2, Math.floor((t.level - 1) / 3));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 3; c++) {
          g.fillRect(-13 + c * 9 + (r % 2 ? 3 : 0), -13 + r * 8, 8, 6);
        }
      }
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 1;
      g.strokeRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);
    }
    g.restore();

    if (def.maxLevel > 1) this.drawLevelPips(g, t, x, y, t.stats.color);
  }

  /** Is this cell inside the camera window (with a cell of slack)? */
  visible(vp, cx, cy) {
    if (!vp) return true;
    return (cx + 1) * CELL >= vp.x - CELL && cx * CELL <= vp.x + vp.viewW + CELL
        && (cy + 1) * CELL >= vp.y - CELL && cy * CELL <= vp.y + vp.viewH + CELL;
  }

  /** Per-frame tower work: just the rotating turret and any selection ring. */
  drawTower(t, view) {
    const { ctx } = this;
    const def = TOWER_DEFS[t.defId];

    if (def.shape !== 'wall') {
      ctx.save();
      ctx.translate((t.x + 0.5) * CELL, (t.y + 0.5) * CELL);
      ctx.rotate(t.angle);
      // Kick the barrel back along its own axis as it fires.
      if (t.recoil > 0) ctx.translate(-t.recoil * 2.6, 0);
      this.drawTurret(def.shape, t, t.stats);
      ctx.restore();
    }

    if (view.selected === t) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(t.x * CELL + 1, t.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.setLineDash([]);
    }
  }

  drawLevelPips(ctx, t, x, y, color) {
    const def = TOWER_DEFS[t.defId];
    const maxed = t.level >= def.maxLevel;
    const n = Math.min(t.level, 8);
    const w = 3;
    const gap = 1;
    const totalW = n * w + (n - 1) * gap;
    ctx.fillStyle = maxed ? '#ffd24a' : color;
    for (let i = 0; i < n; i++) {
      ctx.fillRect(x - totalW / 2 + i * (w + gap), y + CELL / 2 - 4, w, 2);
    }
    if (maxed) {
      ctx.strokeStyle = 'rgba(255,210,74,0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - CELL / 2 + 1.5, y - CELL / 2 + 1.5, CELL - 3, CELL - 3);
    }
  }

  drawBarricade(ctx, t) {
    const lvl = t.level;
    ctx.fillStyle = '#6d6350';
    ctx.fillRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = '#8a7f63';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillRect(-13 + c * 9 + (r % 2 ? 3 : 0), -13 + r * 9, 8, 7);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);

    if (lvl >= 2) {
      // Razor wire coils.
      ctx.strokeStyle = '#c9c6bb';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) ctx.arc(-8 + i * 8, -10, 5, 0, TAU);
      ctx.stroke();
    }
    if (lvl >= 3) {
      // Static, not animated: this art is baked into a cached layer.
      ctx.strokeStyle = 'rgba(120,220,255,0.72)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-12, 6); ctx.lineTo(-4, 1); ctx.lineTo(2, 8); ctx.lineTo(11, 2);
      ctx.stroke();
    }
  }

  drawTurret(shape, t, s) {
    const { ctx } = this;
    const lvl = t.level;
    const c = s.color;
    const heat = t.spin ?? 0;

    switch (shape) {
      case 'mg': {
        ctx.fillStyle = '#3a3a34';
        ctx.beginPath(); ctx.arc(0, 0, 7 + lvl * 0.25, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        const barrels = s.spinUp ? 3 : 1;
        for (let i = 0; i < barrels; i++) {
          const off = barrels === 1 ? 0 : (i - 1) * 3;
          ctx.fillRect(4, off - 1.2, 11 + lvl * 0.7, 2.4);
        }
        if (s.pierce) { ctx.fillStyle = '#e08a3c'; ctx.fillRect(13 + lvl * 0.7, -2.5, 3, 5); }
        if (heat > 0.4) {
          ctx.fillStyle = `rgba(255,140,40,${(heat - 0.4) * 0.7})`;
          ctx.beginPath(); ctx.arc(15 + lvl * 0.7, 0, 3, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'sniper': {
        ctx.fillStyle = '#33383a';
        ctx.fillRect(-8, -5, 14, 10);
        ctx.fillStyle = c;
        ctx.fillRect(2, -1.4, 16 + lvl * 1.2, 2.8);
        ctx.fillStyle = '#20252a';
        ctx.fillRect(-2, -6.5, 7, 3);
        if (s.armorPen >= 999) { ctx.fillStyle = '#5fd0e8'; ctx.fillRect(16 + lvl * 1.2, -2, 4, 4); }
        if (s.crit) {
          ctx.strokeStyle = 'rgba(217,140,217,0.8)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke();
        }
        break;
      }
      case 'flame': {
        ctx.fillStyle = '#3a2e28';
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(4, -4); ctx.lineTo(15 + lvl, -6); ctx.lineTo(15 + lvl, 6); ctx.lineTo(4, 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a3a1a';
        ctx.beginPath(); ctx.arc(-4, 0, 5, 0, TAU); ctx.fill();
        break;
      }
      case 'cryo': {
        ctx.rotate(-t.angle); // omni-directional; keep it upright
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + t.x);
        ctx.fillStyle = '#2e3a42';
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + this.time * 0.6;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 6, Math.sin(a) * 6, 2.4 + pulse, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(200,240,255,${0.5 + pulse * 0.4})`;
        ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
        break;
      }
      case 'tesla': {
        ctx.rotate(-t.angle);
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 9 + t.y);
        ctx.fillStyle = '#2b2f36';
        ctx.fillRect(-5, -2, 10, 12);
        ctx.fillStyle = '#454b55';
        ctx.fillRect(-3, -8, 6, 8);
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, -10, 4.5 + pulse * 1.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(159,230,255,${0.3 + pulse * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, -10, 8 + pulse * 3, 0, TAU); ctx.stroke();
        break;
      }
      case 'mortar': {
        ctx.fillStyle = '#3c4030';
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        const tubes = s.cluster ? Math.min(4, s.cluster) : 1;
        for (let i = 0; i < tubes; i++) {
          const off = tubes === 1 ? 0 : (i - (tubes - 1) / 2) * 4.5;
          ctx.fillRect(0, off - 1.8, 9 + lvl * 0.5, 3.6);
        }
        ctx.fillStyle = '#23261c';
        ctx.beginPath(); ctx.arc(-2, 0, 4.5, 0, TAU); ctx.fill();
        break;
      }
      case 'acid': {
        ctx.fillStyle = '#2f3a26';
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        ctx.fillRect(3, -2, 12 + lvl * 0.6, 4);
        // Bubbling tank.
        const b = 0.5 + 0.5 * Math.sin(this.time * 4 + t.y);
        ctx.fillStyle = `rgba(182,255,61,${0.55 + b * 0.35})`;
        ctx.beginPath(); ctx.arc(-5, 0, 4.5, 0, TAU); ctx.fill();
        break;
      }
      default:
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    }
  }

  // -- enemies --------------------------------------------------------------

  drawEnemies() {
    // Depth sort so overlapping bodies stack believably instead of by array order.
    const arr = this.sorted;
    arr.length = 0;
    for (const e of this.game.enemies) if (!e.dead) arr.push(e);
    arr.sort((a, b) => a.y - b.y);
    for (const e of arr) this.drawEnemy(e);
  }

  drawEnemy(e) {
    const { ctx } = this;
    const b = BODY[e.typeId] ?? BODY.walker;
    const r = e.radius;
    const boss = !!e.def.traits?.boss;
    const stunned = this.game.clock < e.stunUntil;

    const phase = e.wobble * b.gait;
    const swing = stunned ? 0 : Math.sin(phase);
    const bob = stunned ? 0 : Math.abs(Math.sin(phase)) * r * 0.08;
    const face = e.dx !== 0 ? Math.sign(e.dx) : 1;

    // Hit flash blows the whole body out toward white for a few frames.
    const flash = Math.max(0, (e.flashUntil - this.game.clock) / 0.07);
    const boost = flash * 190;
    const skin = flash > 0 ? lighten(e.def.color, boost) : e.def.color;
    const dark = flash > 0 ? lighten(e.def.shade, boost) : e.def.shade;
    const lit = lighten(e.def.color, 26 + boost);

    // Knockback is a render-only offset; the simulation never sees it.
    const px = e.x + e.kx;
    const py = e.y + e.ky;

    const drop = b.legless ? r * 0.3 : 0;

    // Shadow stays in world space — it must not flip or lean with the body.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(px, e.y + r * 0.95, r * 0.72, r * 0.26, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(px, py - bob + drop);
    ctx.scale(face, 1);
    ctx.rotate(b.hunch * 0.3);

    ctx.lineCap = 'round';

    const tw = r * b.w * 0.55;
    const shoulder = -r * 0.34;

    // Legs stride out well below the torso so the walk cycle actually reads.
    if (!b.legless) {
      ctx.strokeStyle = dark;
      ctx.lineWidth = r * 0.26;
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.02 + s * tw * 0.3, r * 0.3);
        ctx.lineTo(swing * s * r * 0.42, r * 0.95);
        ctx.stroke();
      }
    }

    // Two arms at clearly different heights: the rear one hangs low, the front
    // one reaches. Drawn either side of the torso so both stay legible.
    // Rear arm hangs low and still clears the torso on the widest bodies,
    // otherwise it hides behind them and both arms read as one bar.
    const rearX = (tw + r * b.arm * 0.55);
    const rearY = r * 0.42 + swing * r * 0.16;
    ctx.strokeStyle = dark;
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, shoulder + r * 0.06);
    ctx.lineTo(rearX, rearY);
    ctx.stroke();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(rearX, rearY, r * 0.13, 0, TAU); ctx.fill();

    if (b.angular) {
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.moveTo(-tw, r * 0.48);
      ctx.lineTo(-tw * 0.8, -r * 0.42);
      ctx.lineTo(tw * 0.5, -r * 0.56);
      ctx.lineTo(tw, r * 0.14);
      ctx.lineTo(tw * 0.34, r * 0.55);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.05, tw, r * 0.56, 0, 0, TAU);
      ctx.fill();
    }
    if (b.belly) {
      ctx.fillStyle = lighten(skin, 16);
      ctx.beginPath();
      ctx.ellipse(r * 0.08, r * 0.14, tw * 0.84, r * 0.42, 0, 0, TAU);
      ctx.fill();
    }
    // Rim light from above-left gives the torso volume.
    ctx.strokeStyle = 'rgba(255,246,224,0.3)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.05, tw, r * 0.56, 0, Math.PI * 1.05, Math.PI * 1.9);
    ctx.stroke();

    if (b.plates) {
      // Segmented armour bands with a lit top edge — reads as plate, not a bar.
      ctx.fillStyle = 'rgba(44,44,40,0.92)';
      ctx.fillRect(-tw * 0.8, -r * 0.34, tw * 1.6, r * 0.2);
      ctx.fillRect(-tw * 0.66, -r * 0.04, tw * 1.32, r * 0.18);
      ctx.fillStyle = 'rgba(190,185,170,0.28)';
      ctx.fillRect(-tw * 0.8, -r * 0.34, tw * 1.6, 1.4);
      ctx.fillRect(-tw * 0.66, -r * 0.04, tw * 1.32, 1.4);
    }
    if (b.pads) {
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(-tw * 0.72, shoulder, r * 0.27, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(tw * 0.72, shoulder, r * 0.27, 0, TAU); ctx.fill();
    }
    if (b.sinew) {
      ctx.strokeStyle = 'rgba(140,255,205,0.6)';
      ctx.lineWidth = 1.4;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * tw * 0.42, -r * 0.02, r * 0.26, 0.5, 2.3);
        ctx.stroke();
      }
    }

    const frontX = tw + r * b.arm * 0.92;
    const frontY = shoulder - r * 0.04 - swing * r * 0.14;
    ctx.strokeStyle = lit;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(r * 0.02, shoulder);
    ctx.lineTo(frontX, frontY);
    ctx.stroke();
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(frontX, frontY, r * 0.14, 0, TAU); ctx.fill();

    // Head.
    const hr = r * b.head;
    const hx = r * 0.16;
    const hy = shoulder - hr * 0.9;
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.arc(hx - hr * 0.34, hy + hr * 0.22, hr * 0.78, 0, TAU); ctx.fill();

    if (b.visor) {
      ctx.fillStyle = 'rgba(155,225,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(hx + hr * 0.22, hy, hr * 0.6, hr * 0.4, -0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(hx + hr * 0.05, hy - hr * 0.14, hr * 0.2, hr * 0.12, -0.3, 0, TAU);
      ctx.fill();
    } else if (b.maw) {
      // Screamers are mid-howl: jaw dropped open, throat lit from within.
      const gape = 0.7 + 0.3 * Math.sin(this.time * 12);
      ctx.fillStyle = '#25060f';
      ctx.beginPath();
      ctx.ellipse(hx + hr * 0.42, hy + hr * 0.34, hr * 0.46, hr * 0.62 * gape, -0.25, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,140,205,${0.55 + 0.35 * gape})`;
      ctx.beginPath();
      ctx.ellipse(hx + hr * 0.46, hy + hr * 0.4, hr * 0.2, hr * 0.3 * gape, -0.25, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(10,4,4,0.85)';
      ctx.beginPath(); ctx.arc(hx + hr * 0.2, hy - hr * 0.42, hr * 0.16, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(10,4,4,0.82)';
      ctx.beginPath(); ctx.arc(hx + hr * 0.42, hy - hr * 0.04, hr * 0.2, 0, TAU); ctx.fill();
    }

    ctx.restore();

    if (boss) {
      ctx.strokeStyle = `rgba(255,90,60,${0.5 + 0.3 * Math.sin(this.time * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r + 4, 0, TAU);
      ctx.stroke();
    }

    this.drawEnemyStatus(e, px, py, r);
    this.drawEnemyHp(e, px, py, r, boss);
  }

  drawEnemyStatus(e, x, y, r) {
    const { ctx, game } = this;
    const now = game.clock;

    // Status markers hug the body deliberately — at 100+ zombies, wide rings
    // pile into an unreadable halo cloud.
    if (now < e.slowUntil) {
      ctx.fillStyle = 'rgba(127,212,255,0.22)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.95, 0, TAU); ctx.fill();
    }
    if (now < e.stunUntil) {
      ctx.strokeStyle = 'rgba(200,240,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, TAU); ctx.stroke();
    }
    if (e.burn && now < e.burn.until) {
      const f = 0.5 + 0.5 * Math.sin(this.time * 18 + e.uid);
      ctx.fillStyle = `rgba(255,140,40,${0.25 + f * 0.3})`;
      ctx.beginPath(); ctx.arc(x, y - r * 0.4, r * 0.7 + f * 2, 0, TAU); ctx.fill();
    }
    if (e.acid && now < e.acid.until) {
      ctx.fillStyle = 'rgba(182,255,61,0.3)';
      ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.3, r * 0.4, 0, TAU); ctx.fill();
    }
    if (now < e.vulnUntil) {
      ctx.strokeStyle = 'rgba(255,120,200,0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, r * 1.04, 0, TAU); ctx.stroke();
    }
    const resist = Math.max(now < e.resistUntil ? e.resist : 0, e.auraResist);
    if (resist > 0) {
      ctx.strokeStyle = 'rgba(190,190,200,0.6)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, r * 1.12, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.def.traits?.aura) {
      ctx.strokeStyle = `rgba(176,74,138,${0.15 + 0.1 * Math.sin(this.time * 5)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, e.def.traits.aura.radius * CELL, 0, TAU);
      ctx.stroke();
    }
  }

  drawEnemyHp(e, x, y, r, boss) {
    if (e.hp >= e.maxHp) return;
    const { ctx } = this;
    const frac = Math.max(0, e.hp / e.maxHp);
    const w = boss ? r * 2.4 : Math.max(14, r * 1.8);
    const h = boss ? 5 : 3;
    const by = y - r - (boss ? 12 : 7);

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - w / 2, by, w, h);
    ctx.fillStyle = boss ? '#e04b3a' : frac > 0.5 ? '#8bd34a' : frac > 0.25 ? '#ffb020' : '#e04b3a';
    ctx.fillRect(x - w / 2 + 0.5, by + 0.5, (w - 1) * frac, h - 1);
  }

  // -- projectiles & effects -------------------------------------------------

  drawProjectiles() {
    const { ctx } = this;
    for (const p of this.game.projectiles) {
      if (p.kind === 'shell') {
        const h = p.height ?? 0;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y - h, 4, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(p.x - 1, p.y - h - 1, 1.6, 0, TAU); ctx.fill();
      } else if (p.kind === 'acidball') {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(p.x - 1.2, p.y - 1.2, 1.6, 0, TAU); ctx.fill();
      } else {
        const len = 7;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / sp) * len, p.y - (p.vy / sp) * len);
        ctx.stroke();
      }
    }
  }

  /** Effects that belong under the units. */
  drawGroundEffects() {
    const { ctx } = this;
    for (const fx of this.game.effects) {
      const k = fx.life / fx.max;
      if (fx.kind === 'explosion') {
        const r = fx.r * (1.4 - k * 0.5);
        ctx.strokeStyle = `rgba(255,170,60,${k})`;
        ctx.lineWidth = 3 * k + 1;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(255,120,40,${k * 0.35})`;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, r * 0.8, 0, TAU); ctx.fill();
      } else if (fx.kind === 'pulse') {
        ctx.strokeStyle = `rgba(127,212,255,${k * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r * (1 - k * 0.25), 0, TAU); ctx.stroke();
      } else if (fx.kind === 'gas') {
        ctx.fillStyle = `rgba(150,170,90,${k * 0.28})`;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r * (1.05 - k * 0.15), 0, TAU); ctx.fill();
      } else if (fx.kind === 'blood') {
        ctx.fillStyle = fx.color;
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.fillRect(fx.x, fx.y, fx.size, fx.size);
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'chunk') {
        ctx.save();
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.rot);
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.fillStyle = fx.color;
        ctx.fillRect(-fx.size, -fx.size * 0.6, fx.size * 2, fx.size * 1.2);
        ctx.globalAlpha = 1;
        ctx.restore();
      } else if (fx.kind === 'casing') {
        ctx.save();
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.rot);
        ctx.globalAlpha = Math.min(1, k * 1.8);
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(-2.2, -0.9, 4.4, 1.8);
        ctx.globalAlpha = 1;
        ctx.restore();
      } else if (fx.kind === 'pop') {
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = k * 0.75;
        ctx.lineWidth = 2.5 * k + 0.5;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * (1.25 - k * 0.85), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'cone') {
        const grad = ctx.createRadialGradient(fx.x, fx.y, 4, fx.x, fx.y, fx.r);
        grad.addColorStop(0, `rgba(255,220,120,${k * 0.85})`);
        grad.addColorStop(0.45, `rgba(255,130,40,${k * 0.6})`);
        grad.addColorStop(1, 'rgba(180,40,10,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y);
        ctx.arc(fx.x, fx.y, fx.r, fx.a - fx.half, fx.a + fx.half);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Effects that belong over the units. */
  drawAirEffects() {
    const { ctx } = this;
    for (const fx of this.game.effects) {
      const k = fx.life / fx.max;
      if (fx.kind === 'beam') {
        ctx.strokeStyle = `rgba(255,255,255,${k * 0.9})`;
        ctx.lineWidth = fx.width * k + 0.5;
        ctx.beginPath(); ctx.moveTo(fx.x1, fx.y1); ctx.lineTo(fx.x2, fx.y2); ctx.stroke();
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = k * 0.5;
        ctx.lineWidth = fx.width * 2 * k;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'arc') {
        // Jagged lightning between the two points.
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        const segs = 5;
        for (let i = 1; i < segs; i++) {
          const p = i / segs;
          const mx = fx.x1 + (fx.x2 - fx.x1) * p + (Math.random() - 0.5) * 12;
          const my = fx.y1 + (fx.y2 - fx.y1) * p + (Math.random() - 0.5) * 12;
          ctx.lineTo(mx, my);
        }
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'muzzle') {
        ctx.fillStyle = `rgba(255,220,140,${k})`;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(fx.a) * 10, fx.y + Math.sin(fx.a) * 10);
        ctx.arc(fx.x + Math.cos(fx.a) * 14, fx.y + Math.sin(fx.a) * 14, 4 * k + 1, 0, TAU);
        ctx.fill();
      } else if (fx.kind === 'spark') {
        ctx.fillStyle = fx.color;
        ctx.globalAlpha = k;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 3 * k + 1, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'freeze') {
        ctx.strokeStyle = `rgba(180,235,255,${k})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          ctx.beginPath();
          ctx.moveTo(fx.x + Math.cos(a) * 4, fx.y + Math.sin(a) * 4);
          ctx.lineTo(fx.x + Math.cos(a) * 13, fx.y + Math.sin(a) * 13);
          ctx.stroke();
        }
      }
    }
  }

  /** Rally flare, incoming airstrikes, the aiming reticle, overcharge tint. */
  drawAbilityFx(view) {
    const { ctx, game } = this;

    // Rally flare: a burning marker the horde is walking towards.
    if (game.lure && game.clock < game.lure.until) {
      const x = (game.lure.x + 0.5) * CELL;
      const y = (game.lure.y + 0.5) * CELL;
      const left = game.lure.until - game.clock;
      const flick = 0.7 + 0.3 * Math.sin(this.time * 22);

      ctx.strokeStyle = `rgba(255,210,74,${0.5 + 0.3 * Math.sin(this.time * 5)})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x, y, 12 + i * 11 + Math.sin(this.time * 4 - i) * 3, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,235,150,${flick})`;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();

      // Remaining duration as a shrinking arc.
      ctx.strokeStyle = 'rgba(255,210,74,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 + TAU * (left / 6.5));
      ctx.stroke();
    }

    // Incoming airstrike: a reticle closing on the impact point.
    for (const s of game.strikes) {
      const k = Math.min(1, s.t / s.dur);
      const r = s.radius * (1.9 - k * 0.9);
      ctx.strokeStyle = `rgba(255,120,60,${0.4 + k * 0.6})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.time * 40;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = `rgba(255,180,90,${0.5 + k * 0.5})`;
      ctx.lineWidth = 1.5;
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * (r - 9), s.y + Math.sin(a) * (r - 9));
        ctx.lineTo(s.x + Math.cos(a) * (r + 9), s.y + Math.sin(a) * (r + 9));
        ctx.stroke();
      }
    }

    // Overcharge: a hot rim around the whole board.
    if (game.clock < game.overchargeUntil) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
      ctx.strokeStyle = `rgba(232,145,42,${0.35 + pulse * 0.4})`;
      ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, CANVAS_W - 5, CANVAS_H - 5);
    }

    // Reticle under the cursor while a targeted ability is armed.
    if (view.aiming && view.hover) {
      const def = game.abilityDef(view.aiming);
      const x = (view.hover.x + 0.5) * CELL;
      const y = (view.hover.y + 0.5) * CELL;
      const blocked = view.aiming === 'flare'
        && game.blocked[idx(view.hover.x, view.hover.y)];
      const tint = blocked ? '224,75,58' : '255,190,90';

      if (def.radius) {
        ctx.fillStyle = `rgba(${tint},0.1)`;
        ctx.beginPath(); ctx.arc(x, y, def.radius * CELL, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = `rgba(${tint},0.95)`;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -this.time * 30;
      ctx.beginPath();
      ctx.arc(x, y, (def.radius ? def.radius * CELL : CELL * 0.9), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y);
      ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11);
      ctx.stroke();
    }
  }

  drawFloaters() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.font = '500 13px "Plex Mono", ui-monospace, monospace';
    for (const f of this.game.floaters) {
      const k = Math.min(1, f.life / f.max);
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  // -- build overlay ---------------------------------------------------------

  /**
   * The keyboard cursor. Corner brackets rather than a filled cell, and drawn
   * last of everything, because it shares its square with the build ghost —
   * under it, the red "can't build here" fill swallows it completely.
   */
  drawCursor(view) {
    if (!view.cursor) return;
    const { ctx } = this;
    const px = view.cursor.x * CELL;
    const py = view.cursor.y * CELL;
    const arm = 9;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 5);

    // A dark under-stroke, so the brackets hold up over pale ground too.
    for (const [color, width] of [['rgba(0,0,0,0.75)', 4], [`rgba(255,214,130,${pulse})`, 2]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [
        [px, py, 1, 1], [px + CELL, py, -1, 1],
        [px, py + CELL, 1, -1], [px + CELL, py + CELL, -1, -1],
      ]) {
        ctx.moveTo(cx + sx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + sy * arm);
      }
      ctx.stroke();
    }
  }

  drawOverlay(view) {
    const { ctx, game } = this;

    // Faint ring for whatever the cursor is over, so you can check a tower's
    // reach without committing to selecting it.
    const hov = view.hoverTower;
    if (hov && hov !== view.selected && !hov.stats.inert) {
      this.drawRange(
        (hov.x + 0.5) * CELL, (hov.y + 0.5) * CELL,
        hov.stats.range * CELL, (hov.stats.minRange ?? 0) * CELL,
        'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.03)',
      );
    }

    // Range ring for the selected tower.
    if (view.selected && !view.selected.stats.inert) {
      this.drawRange(
        (view.selected.x + 0.5) * CELL,
        (view.selected.y + 0.5) * CELL,
        view.selected.stats.range * CELL,
        (view.selected.stats.minRange ?? 0) * CELL,
        'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.06)',
      );
    }

    if (!view.buildId || !view.hover) return;
    const { x, y } = view.hover;
    if (x < 0 || y < 0 || x >= GRID.cols || y >= GRID.rows) return;

    const ok = view.placeCheck?.ok;

    ctx.fillStyle = ok ? 'rgba(120,220,120,0.22)' : 'rgba(224,75,58,0.28)';
    ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    ctx.strokeStyle = ok ? 'rgba(150,240,150,0.95)' : 'rgba(255,110,90,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);

    // A plain barricade has no range worth drawing.
    if (ok && view.buildStats && !view.buildStats.inert) {
      const s = view.buildStats;
      this.drawRange(
        (x + 0.5) * CELL, (y + 0.5) * CELL,
        s.range * CELL, (s.minRange ?? 0) * CELL,
        'rgba(150,240,150,0.45)', 'rgba(150,240,150,0.05)',
      );
    }

    if (!ok && view.placeCheck?.reason) {
      const cx = (x + 0.5) * CELL;
      const cy = y * CELL - 8;
      ctx.font = '600 12px "Barlow", system-ui, sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(view.placeCheck.reason).width + 16;
      ctx.fillStyle = 'rgba(14,10,8,0.94)';
      ctx.fillRect(cx - w / 2, cy - 14, w, 19);
      ctx.strokeStyle = 'rgba(193,68,46,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - w / 2, cy - 14, w, 19);
      ctx.fillStyle = '#ef7a5f';
      ctx.fillText(view.placeCheck.reason, cx, cy - 1);
    }
  }

  drawRange(x, y, r, minR, stroke, fill) {
    const { ctx } = this;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    if (minR > 0) { ctx.arc(x, y, minR, 0, TAU, true); }
    ctx.fill();

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    if (minR > 0) {
      ctx.strokeStyle = 'rgba(255,140,120,0.6)';
      ctx.beginPath(); ctx.arc(x, y, minR, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}
