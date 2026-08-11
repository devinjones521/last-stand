// ---------------------------------------------------------------------------
// All canvas drawing. Reads game state, never mutates it.
// ---------------------------------------------------------------------------

import { GRID, CANVAS_W, CANVAS_H, SPAWN, GOAL, OBSTACLES, COLORS } from './config.js';
import { TOWER_DEFS } from './towers.js';

const CELL = GRID.cell;
const TAU = Math.PI * 2;

/** Deterministic hash-noise so the ground texture is stable between reloads. */
function noise(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.ctx = canvas.getContext('2d');
    this.terrain = this.bakeTerrain();
    this.time = 0;
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

    for (const o of OBSTACLES) this.drawObstacle(g, o);
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
    if (game.shake > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * game.shake,
        (Math.random() - 0.5) * game.shake,
      );
    }

    ctx.drawImage(this.terrain, 0, 0, CANVAS_W, CANVAS_H);

    this.drawRoute(game.route, COLORS.route, COLORS.routeLine, false);
    if (view.previewRoute) this.drawRoute(view.previewRoute, 'rgba(120,220,120,0.10)', 'rgba(140,240,140,0.6)', true);

    this.drawPuddles();
    this.drawSpawn();
    this.drawBase();
    this.drawGroundEffects();

    for (const t of game.towers) this.drawTower(t, view);
    this.drawEnemies();
    this.drawProjectiles();
    this.drawAirEffects();
    this.drawFloaters();

    this.drawOverlay(view);
    ctx.restore();
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
    const x = (SPAWN.x + 0.5) * CELL;
    const y = (SPAWN.y + 0.5) * CELL;
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

    ctx.fillStyle = COLORS.textDim;
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BREACH', x, y + CELL * 0.95);
  }

  drawBase() {
    const { ctx, game } = this;
    const x = (GOAL.x + 0.5) * CELL;
    const y = (GOAL.y + 0.5) * CELL;
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

    ctx.fillStyle = COLORS.textDim;
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CAMP', x, y - CELL * 0.85);
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

  drawTower(t, view) {
    const { ctx } = this;
    const def = TOWER_DEFS[t.defId];
    const s = t.stats;
    const x = (t.x + 0.5) * CELL;
    const y = (t.y + 0.5) * CELL;
    const selected = view.selected === t;

    ctx.save();
    ctx.translate(x, y);

    // Shadow + emplacement pad.
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(-CELL / 2 + 2, -CELL / 2 + 4, CELL - 4, CELL - 4);

    if (def.shape === 'wall') {
      this.drawBarricade(t);
    } else {
      // Sandbag pad, gains rows as the tower levels.
      ctx.fillStyle = '#4a4638';
      ctx.fillRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = '#5c5744';
      const rows = 2 + Math.min(2, Math.floor((t.level - 1) / 3));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.fillRect(-13 + c * 9 + (r % 2 ? 3 : 0), -13 + r * 8, 8, 6);
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);

      ctx.rotate(t.angle);
      this.drawTurret(def.shape, t, s);
    }
    ctx.restore();

    // Level pips along the bottom edge.
    if (def.maxLevel > 1) this.drawLevelPips(t, x, y, s.color);

    if (selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(t.x * CELL + 1, t.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.setLineDash([]);
    }
  }

  drawLevelPips(t, x, y, color) {
    const { ctx } = this;
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
      ctx.strokeStyle = `rgba(255,210,74,${0.35 + 0.25 * Math.sin(this.time * 3)})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - CELL / 2 + 1.5, y - CELL / 2 + 1.5, CELL - 3, CELL - 3);
    }
  }

  drawBarricade(t) {
    const { ctx } = this;
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
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 7 + t.x);
      ctx.strokeStyle = `rgba(120,220,255,${0.4 + pulse * 0.5})`;
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
    const { ctx, game } = this;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const boss = !!e.def.traits?.boss;
      const wob = Math.sin(e.wobble) * (boss ? 1.5 : 2.2);
      const x = e.x;
      const y = e.y + wob * 0.4;
      const r = e.radius;

      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.75, r * 0.85, r * 0.35, 0, 0, TAU);
      ctx.fill();

      // Body.
      ctx.fillStyle = e.def.shade;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.82, r, wob * 0.05, 0, TAU);
      ctx.fill();
      ctx.fillStyle = e.def.color;
      ctx.beginPath();
      ctx.ellipse(x - r * 0.12, y - r * 0.15, r * 0.62, r * 0.75, wob * 0.05, 0, TAU);
      ctx.fill();

      // Head, lolling side to side.
      ctx.fillStyle = e.def.color;
      ctx.beginPath();
      ctx.arc(x + wob * 0.5, y - r * 0.75, r * 0.42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(x + wob * 0.5 + r * 0.14, y - r * 0.78, r * 0.11, 0, TAU);
      ctx.fill();

      if (boss) {
        ctx.strokeStyle = 'rgba(255,90,60,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3 + Math.sin(this.time * 4) * 1.5, 0, TAU);
        ctx.stroke();
      }

      this.drawEnemyStatus(e, x, y, r);
      this.drawEnemyHp(e, x, y, r, boss);
    }
  }

  drawEnemyStatus(e, x, y, r) {
    const { ctx, game } = this;
    const now = game.clock;

    if (now < e.slowUntil) {
      ctx.fillStyle = 'rgba(127,212,255,0.28)';
      ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, TAU); ctx.fill();
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
      ctx.strokeStyle = 'rgba(255,120,200,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, TAU); ctx.stroke();
    }
    const resist = Math.max(now < e.resistUntil ? e.resist : 0, e.auraResist);
    if (resist > 0) {
      ctx.strokeStyle = 'rgba(180,180,190,0.65)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, TAU); ctx.stroke();
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

  drawFloaters() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.font = '700 12px ui-monospace, monospace';
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
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const w = ctx.measureText(view.placeCheck.reason).width + 14;
      ctx.fillStyle = 'rgba(20,10,10,0.9)';
      ctx.fillRect(cx - w / 2, cy - 13, w, 17);
      ctx.strokeStyle = 'rgba(224,75,58,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - w / 2, cy - 13, w, 17);
      ctx.fillStyle = '#ff9a8a';
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
