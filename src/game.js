// ---------------------------------------------------------------------------
// Game simulation. Owns all state and all rules. Knows nothing about drawing.
// ---------------------------------------------------------------------------

import {
  GRID, SPAWN, GOAL, OBSTACLES, CANVAS_W, CANVAS_H, balanceFor, ABILITIES,
} from './config.js';
import {
  CELL_COUNT, idx, computeField, nextStep, traceRoute,
} from './pathfinding.js';
import { TOWER_DEFS, towerStats, nextUpgradeCost } from './towers.js';
import { ENEMY_DEFS, scaleEnemy } from './enemies.js';
import { buildWave, waveClearBonus } from './waves.js';

const CELL = GRID.cell;
const SAVE_KEY = 'laststand.save.v1';
const RECORDS_KEY = 'laststand.records.v1';

let nextUid = 1;

export class Game {
  constructor(audio, difficulty = 'standard') {
    this.audio = audio;
    this.balance = balanceFor(difficulty);
    this.terrain = new Uint8Array(CELL_COUNT); // permanent obstacles
    this.blocked = new Uint8Array(CELL_COUNT); // terrain + towers
    this.field = new Int32Array(CELL_COUNT);
    this.testField = new Int32Array(CELL_COUNT);
    // Second flow field, aimed at an active Rally Flare instead of the camp.
    this.lureField = new Int32Array(CELL_COUNT);
    this.towerAt = new Array(CELL_COUNT).fill(null);

    for (const o of OBSTACLES) {
      for (let y = o.y; y < o.y + o.h; y++) {
        for (let x = o.x; x < o.x + o.w; x++) {
          if (x >= 0 && y >= 0 && x < GRID.cols && y < GRID.rows) this.terrain[idx(x, y)] = 1;
        }
      }
    }
    // The spawn and the camp can never be built on or blocked.
    this.terrain[idx(SPAWN.x, SPAWN.y)] = 0;
    this.terrain[idx(GOAL.x, GOAL.y)] = 0;

    this.reset();
  }

  reset(difficulty = this.balance?.difficulty ?? 'standard') {
    this.balance = balanceFor(difficulty);
    // Bumped on every reset so the renderer knows to wipe its decal layer.
    this.epoch = (this.epoch ?? 0) + 1;
    // Bumped whenever the set of towers changes, so the renderer knows when to
    // re-bake its cached static tower art.
    this.buildVersion = 0;
    // Append-only queue of permanent ground marks (blood, scorch). The renderer
    // drains it into an offscreen layer; capped so a headless run can't grow it
    // without bound.
    this.decals = [];
    this.towers = [];
    this.towerAt.fill(null);
    this.enemies = [];
    this.projectiles = [];
    this.puddles = [];
    this.effects = [];
    this.floaters = [];
    this.pending = [];
    this.runningWaves = [];
    this.strikes = [];

    // Commander abilities: id -> game-clock time when it comes off cooldown.
    this.abilityReadyAt = {};
    for (const a of ABILITIES) this.abilityReadyAt[a.id] = 0;
    this.lure = null;
    this.overchargeUntil = -1;
    this.overcharge = null;

    this.cash = this.balance.startCash;
    this.baseHp = this.balance.startBaseHp;
    this.maxBaseHp = this.balance.maxBaseHp;
    this.wave = 0;            // last wave STARTED
    this.clock = 0;
    this.repairsBought = 0;
    this.speed = 1;
    this.paused = false;
    this.autoStart = false;
    this.phase = 'building';  // 'building' | 'wave' | 'over'
    this.shake = 0;
    // Game feel: a brief total freeze on heavy impacts, and a camera punch.
    this.hitStop = 0;
    this.punch = 0;
    this.stats = { kills: 0, leaked: 0, earned: 0, spent: 0, bestWave: 0 };

    this.rebuild();
  }

  // -- grid ----------------------------------------------------------------

  rebuild() {
    this.blocked.set(this.terrain);
    for (const t of this.towers) this.blocked[idx(t.x, t.y)] = 1;
    computeField(this.blocked, GOAL.x, GOAL.y, this.field);
    this.route = traceRoute(this.field, SPAWN.x, SPAWN.y);
    // A live flare's field has to follow the maze changing under it.
    if (this.lure) computeField(this.blocked, this.lure.x, this.lure.y, this.lureField);

    // Defensive: if anything is standing on a now-blocked cell or heading into
    // one, re-point it. Placement rules should prevent this, but never strand.
    for (const e of this.enemies) {
      if (this.blocked[idx(e.tx, e.ty)] || this.field[idx(e.tx, e.ty)] === -1) {
        this.retarget(e);
      }
    }
  }

  /**
   * Which flow field this enemy should follow. A Rally Flare overrides the
   * camp, but only where the flare is actually reachable — otherwise the enemy
   * would be stranded, so it falls back to walking at the camp as normal.
   */
  fieldFor(e) {
    if (this.lure && this.clock < this.lure.until) {
      if (this.lureField[idx(e.cx, e.cy)] >= 0) return this.lureField;
    }
    return this.field;
  }

  retarget(e) {
    const step = nextStep(this.fieldFor(e), e.cx, e.cy, e.dx, e.dy);
    if (step) {
      e.tx = step.x; e.ty = step.y; e.dx = step.dx; e.dy = step.dy;
    } else {
      e.tx = e.cx; e.ty = e.cy;
    }
  }

  cellOf(px, py) {
    return { x: Math.floor(px / CELL), y: Math.floor(py / CELL) };
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < GRID.cols && y < GRID.rows;
  }

  /**
   * Can a tower go here? Returns { ok, reason }.
   * The critical rule: you may never fully seal the route. Mazes must always
   * leave a way through.
   */
  canPlace(x, y, defId) {
    if (!this.inBounds(x, y)) return { ok: false, reason: 'Off the map' };
    const i = idx(x, y);

    if (x === SPAWN.x && y === SPAWN.y) return { ok: false, reason: 'That is the breach' };
    if (x === GOAL.x && y === GOAL.y) return { ok: false, reason: 'That is your camp' };
    if (this.terrain[i]) return { ok: false, reason: 'Blocked by rubble' };
    if (this.towerAt[i]) return { ok: false, reason: 'Already occupied' };

    const def = TOWER_DEFS[defId];
    if (!def) return { ok: false, reason: 'Unknown tower' };
    if (this.cash < def.cost) return { ok: false, reason: `Need $${def.cost}` };

    // Don't build on top of, or directly in front of, a zombie.
    for (const e of this.enemies) {
      if ((e.cx === x && e.cy === y) || (e.tx === x && e.ty === y)) {
        return { ok: false, reason: 'A zombie is in the way' };
      }
    }

    // The seal test.
    this.blocked[i] = 1;
    computeField(this.blocked, GOAL.x, GOAL.y, this.testField);
    this.blocked[i] = 0;

    if (this.testField[idx(SPAWN.x, SPAWN.y)] === -1) {
      return { ok: false, reason: 'That would seal the route completely' };
    }
    for (const e of this.enemies) {
      if (this.testField[idx(e.cx, e.cy)] === -1) {
        return { ok: false, reason: 'That would trap a zombie' };
      }
    }
    return { ok: true };
  }

  /**
   * The route the horde WOULD take if a wall went in at (x, y). Drives the
   * dashed preview line, so you can see how a wall reshapes the maze before
   * you spend a cent on it.
   */
  routeIfPlaced(x, y) {
    const i = idx(x, y);
    if (this.blocked[i]) return null;
    this.blocked[i] = 1;
    computeField(this.blocked, GOAL.x, GOAL.y, this.testField);
    this.blocked[i] = 0;
    const route = traceRoute(this.testField, SPAWN.x, SPAWN.y);
    return route.length > 1 ? route : null;
  }

  place(x, y, defId) {
    const check = this.canPlace(x, y, defId);
    if (!check.ok) return check;

    const def = TOWER_DEFS[defId];
    const tower = {
      uid: nextUid++,
      defId, x, y,
      level: 1,
      branch: null,
      invested: def.cost,
      target: def.defaultTarget ?? 'first',
      cooldown: 0,
      angle: 0,
      spin: 0,
      ref: null,
      damageDealt: 0,
      kills: 0,
      recoil: 0,
      stats: towerStats(defId, 1, null),
    };
    this.towers.push(tower);
    this.towerAt[idx(x, y)] = tower;
    this.cash -= def.cost;
    this.stats.spent += def.cost;
    this.buildVersion++;
    this.rebuild();
    this.audio?.play('build');
    return { ok: true, tower };
  }

  sell(tower) {
    const refund = Math.floor(tower.invested * this.balance.sellRefund);
    this.cash += refund;
    this.towers.splice(this.towers.indexOf(tower), 1);
    this.towerAt[idx(tower.x, tower.y)] = null;
    this.buildVersion++;
    this.rebuild();
    this.audio?.play('sell');
    this.pushFloater(tower.x * CELL + CELL / 2, tower.y * CELL, `+$${refund}`, '#6fcf5f');
    return refund;
  }

  upgradeCostFor(tower) {
    return nextUpgradeCost(tower.defId, tower.level);
  }

  /** Level 4 requires picking a branch; pass its id. */
  upgrade(tower, branchId = null) {
    const def = TOWER_DEFS[tower.defId];
    const cost = this.upgradeCostFor(tower);
    if (cost === null) return { ok: false, reason: 'Fully upgraded' };
    if (this.cash < cost) return { ok: false, reason: `Need $${cost}` };

    const needsBranch = def.branches && tower.level + 1 === 4 && !tower.branch;
    if (needsBranch) {
      if (!branchId || !def.branches[branchId]) {
        return { ok: false, reason: 'Choose a specialisation' };
      }
      tower.branch = branchId;
    }

    this.cash -= cost;
    this.stats.spent += cost;
    tower.invested += cost;
    tower.level += 1;
    tower.stats = towerStats(tower.defId, tower.level, tower.branch);
    this.buildVersion++;
    this.audio?.play('upgrade');
    return { ok: true };
  }

  repairCost() {
    return Math.round(
      this.balance.repairCostBase * Math.pow(this.balance.repairCostGrowth, this.repairsBought),
    );
  }

  repair() {
    if (this.baseHp >= this.maxBaseHp) return { ok: false, reason: 'Camp is at full strength' };
    const cost = this.repairCost();
    if (this.cash < cost) return { ok: false, reason: `Need $${cost}` };
    this.cash -= cost;
    this.stats.spent += cost;
    this.repairsBought += 1;
    this.baseHp = Math.min(this.maxBaseHp, this.baseHp + this.balance.repairChunk);
    this.audio?.play('upgrade');
    return { ok: true };
  }

  // -- waves ---------------------------------------------------------------

  startWave() {
    if (this.phase === 'over') return { ok: false, reason: 'Run is over' };

    const stacking = this.enemies.length > 0 || this.pending.length > 0;
    this.wave += 1;
    this.stats.bestWave = Math.max(this.stats.bestWave, this.wave);
    const script = buildWave(this.wave, this.balance);

    const entry = { num: this.wave, remaining: script.total, spawnedAll: false, script };
    this.runningWaves.push(entry);

    for (const g of script.groups) {
      for (let i = 0; i < g.count; i++) {
        this.pending.push({
          at: this.clock + g.delay + i * g.gap,
          typeId: g.typeId,
          waveNum: this.wave,
          hpBonus: script.hpBonus,
        });
      }
    }
    this.pending.sort((a, b) => a.at - b.at);
    this.phase = 'wave';

    // Calling a wave early, while the last one is still on the field, pays out.
    if (stacking) {
      const bonus = Math.round(waveClearBonus(this.wave, this.balance) * this.balance.earlyCallBonus);
      this.cash += bonus;
      this.stats.earned += bonus;
      this.pushFloater(SPAWN.x * CELL + CELL, SPAWN.y * CELL, `+$${bonus} early`, '#ffb020');
    }
    this.audio?.play('wavestart');
    return { ok: true, script };
  }

  nextWavePreview() {
    return buildWave(this.wave + 1, this.balance);
  }

  spawnEnemy(typeId, waveNum, hpBonus) {
    const def = ENEMY_DEFS[typeId];
    const sc = scaleEnemy(def, waveNum, this.balance);
    const maxHp = Math.round(sc.hp * hpBonus);

    const e = {
      uid: nextUid++,
      def, typeId, waveNum,
      x: (SPAWN.x + 0.5) * CELL,
      y: (SPAWN.y + 0.5) * CELL,
      vx: 0, vy: 0,
      cx: SPAWN.x, cy: SPAWN.y,
      tx: SPAWN.x, ty: SPAWN.y,
      dx: 1, dy: 0,
      ox: (Math.random() - 0.5) * 12,
      oy: (Math.random() - 0.5) * 12,
      hp: maxHp, maxHp,
      armor: sc.armor, permaShred: 0,
      speed: sc.speed, reward: sc.reward,
      leak: def.leak, radius: def.radius,
      slowFactor: 1, slowUntil: 0,
      stunUntil: 0,
      burn: null, acid: null,
      shredAmount: 0, shredUntil: 0,
      vulnMult: 1, vulnUntil: 0,
      resist: 0, resistUntil: 0,
      auraSpeed: 1, auraResist: 0,
      wobble: Math.random() * Math.PI * 2,
      flashUntil: -1,
      kx: 0, ky: 0,          // cosmetic knockback offset
      dead: false,
    };
    this.retarget(e);
    this.enemies.push(e);
    return e;
  }

  // -- commander abilities -------------------------------------------------

  abilityDef(id) {
    return ABILITIES.find((a) => a.id === id) ?? null;
  }

  /** Seconds until an ability is usable again; 0 means ready now. */
  abilityCooldownLeft(id) {
    return Math.max(0, (this.abilityReadyAt[id] ?? 0) - this.clock);
  }

  /**
   * Fire a commander ability. `cell` is required for targeted ones.
   * These never cost scrap - only time.
   */
  useAbility(id, cell = null) {
    const def = this.abilityDef(id);
    if (!def) return { ok: false, reason: 'Unknown ability' };
    if (this.phase === 'over') return { ok: false, reason: 'Run is over' };

    const left = this.abilityCooldownLeft(id);
    if (left > 0) return { ok: false, reason: `Ready in ${Math.ceil(left)}s` };

    if (def.targeted) {
      if (!cell || !this.inBounds(cell.x, cell.y)) return { ok: false, reason: 'Pick a spot on the map' };
      if (id === 'flare' && this.blocked[idx(cell.x, cell.y)]) {
        return { ok: false, reason: 'The flare needs open ground' };
      }
    }

    switch (id) {
      case 'airstrike': {
        this.strikes.push({
          x: (cell.x + 0.5) * CELL, y: (cell.y + 0.5) * CELL,
          t: 0, dur: def.delay,
          radius: def.radius * CELL,
          flat: def.flatDamage, frac: def.hpFraction,
        });
        this.audio?.play('mortar');
        break;
      }
      case 'flare': {
        this.lure = { x: cell.x, y: cell.y, until: this.clock + def.duration };
        computeField(this.blocked, cell.x, cell.y, this.lureField);
        for (const e of this.enemies) this.retarget(e);
        this.effects.push({
          kind: 'pulse', x: (cell.x + 0.5) * CELL, y: (cell.y + 0.5) * CELL,
          r: CELL * 5, life: 0.6, max: 0.6, color: '#ffd24a',
        });
        this.audio?.play('wavestart');
        break;
      }
      case 'overcharge': {
        this.overchargeUntil = this.clock + def.duration;
        this.overcharge = { rate: def.rateMult, damage: def.damageMult };
        this.audio?.play('upgrade');
        break;
      }
      case 'cryoburst': {
        for (const e of this.enemies) {
          if (e.dead) continue;
          this.applyStun(e, def.stun);
          this.applySlow(e, def.slowFactor, def.duration);
        }
        this.effects.push({
          kind: 'pulse', x: CANVAS_W / 2, y: CANVAS_H / 2,
          r: Math.max(CANVAS_W, CANVAS_H), life: 0.7, max: 0.7, color: '#a5e8ff',
        });
        this.audio?.play('zap');
        break;
      }
      default:
        return { ok: false, reason: 'Unknown ability' };
    }

    this.abilityReadyAt[id] = this.clock + def.cooldown;
    return { ok: true, def };
  }

  updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += dt;
      if (s.t < s.dur) continue;

      for (const e of this.enemiesInRadius(s.x, s.y, s.radius)) {
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        const falloff = 1 - 0.4 * (d / s.radius);
        this.damage(e, (s.flat + e.maxHp * s.frac) * falloff, 'explosive', { armorPen: 6 });
      }
      this.effects.push({
        kind: 'explosion', x: s.x, y: s.y, r: s.radius,
        life: 0.5, max: 0.5, color: '#ffb020',
      });
      this.pushDecal('scorch', s.x, s.y, s.radius * 0.8, '#000000');
      this.shake = Math.max(this.shake, 18);
      this.punch = Math.max(this.punch, 0.026);
      this.hitStop = Math.max(this.hitStop, 0.09);
      this.audio?.play('boom');
      this.strikes.splice(i, 1);
    }
  }

  // -- combat helpers ------------------------------------------------------

  effectiveArmor(e) {
    const shred = this.clock < e.shredUntil ? e.shredAmount : 0;
    return Math.max(0, e.armor - shred - e.permaShred);
  }

  /**
   * Apply damage with full type/armour/buff resolution.
   * @returns actual damage dealt
   */
  damage(e, amount, type, opts = {}) {
    if (e.dead || amount <= 0) return 0;
    let dmg = amount;
    const armor = this.effectiveArmor(e);
    const pen = opts.armorPen ?? 0;

    if (type === 'physical' || type === 'explosive') {
      dmg = Math.max(dmg * this.balance.armorFloor, dmg - Math.max(0, armor - pen));
    } else if (type === 'energy') {
      dmg = Math.max(dmg * this.balance.armorFloor, dmg - Math.max(0, armor * 0.5 - pen));
    }
    // fire and acid bypass armour entirely - that is their whole identity.

    if (this.clock < e.vulnUntil) dmg *= e.vulnMult;

    const resist = Math.max(this.clock < e.resistUntil ? e.resist : 0, e.auraResist);
    dmg *= 1 - resist;

    // Overcharge boosts anything a tower is responsible for, including the
    // damage-over-time it applied.
    if (opts.src && this.clock < this.overchargeUntil) dmg *= this.overcharge.damage;

    // Credit the tower that caused it, so the UI can show what's pulling weight.
    if (opts.src) {
      opts.src.damageDealt += Math.min(dmg, Math.max(0, e.hp));
      if (e.hp - dmg <= 0) opts.src.kills += 1;
    }

    // Impact feedback. Deliberately skipped for fire and acid: those tick every
    // frame, so flashing on them would leave enemies permanently white.
    if (type !== 'fire' && type !== 'acid') {
      e.flashUntil = this.clock + 0.07;
      // Knockback scales with how big the hit was relative to the target, and
      // is purely cosmetic - it never moves the unit in the simulation.
      const bite = dmg / Math.max(1, e.maxHp);
      if (bite > 0.004) {
        const sp = Math.hypot(e.vx, e.vy) || 1;
        // Tuned so an ordinary rifle round nudges a couple of pixels and a
        // mortar shell visibly shoves; at this zoom a few pixels is a lot.
        const push = Math.min(8, 1.2 + bite * 90);
        e.kx -= (e.vx / sp) * push;
        e.ky -= (e.vy / sp) * push;

        // Clamp the ACCUMULATED offset, not just each hit: rapid fire stacks
        // pushes far faster than they decay, which would tear the sprite away
        // from where the unit actually is.
        const mag = Math.hypot(e.kx, e.ky);
        if (mag > 9) { e.kx = (e.kx / mag) * 9; e.ky = (e.ky / mag) * 9; }
      }
    }

    e.hp -= dmg;
    if (e.hp <= 0) this.kill(e);
    return dmg;
  }

  kill(e) {
    if (e.dead) return;
    e.dead = true;
    this.cash += e.reward;
    this.stats.earned += e.reward;
    this.stats.kills += 1;

    this.spawnBlood(e.x, e.y, e.def.traits?.boss ? 26 : 8, e.def.shade);
    this.pushDecal('blood', e.x, e.y, e.radius * (e.def.traits?.boss ? 2.1 : 1.15), e.def.shade);

    // Bloaters armour up everything around them when they pop.
    const gas = e.def.traits?.deathGas;
    if (gas) {
      for (const o of this.enemies) {
        if (o === e || o.dead) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) <= gas.radius * CELL) {
          o.resist = Math.max(o.resist, gas.resist);
          o.resistUntil = this.clock + gas.duration;
        }
      }
      this.effects.push({
        kind: 'gas', x: e.x, y: e.y, r: gas.radius * CELL,
        life: gas.duration, max: gas.duration,
      });
    }

    // A pop ring reads the kill instantly even in a crowded corridor.
    this.effects.push({
      kind: 'pop', x: e.x, y: e.y, r: e.radius * 2.2,
      life: 0.22, max: 0.22, color: e.def.color,
    });
    this.spawnChunks(e);

    if (e.def.traits?.boss) {
      this.shake = Math.max(this.shake, 16);
      this.punch = Math.max(this.punch, 0.02);
      this.hitStop = Math.max(this.hitStop, 0.11);
      this.audio?.play('bossdie');
    } else {
      this.audio?.play('die');
    }
  }

  /** Chunkier debris than the blood spray, with spin, that settles and fades. */
  spawnChunks(e) {
    const n = e.def.traits?.boss ? 9 : 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 150;
      this.effects.push({
        kind: 'chunk', x: e.x, y: e.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 14,
        size: e.radius * (0.16 + Math.random() * 0.2),
        life: 0.5 + Math.random() * 0.4, max: 0.9,
        color: e.def.shade,
      });
    }
  }

  leak(e) {
    if (e.dead) return;
    e.dead = true;
    this.stats.leaked += 1;
    this.baseHp -= e.leak;
    this.shake = Math.max(this.shake, Math.min(18, 3 + e.leak));
    this.pushFloater(GOAL.x * CELL, GOAL.y * CELL - 8, `-${e.leak}`, '#e04b3a');
    this.audio?.play('leak');
    if (this.baseHp <= 0) {
      this.baseHp = 0;
      this.phase = 'over';
      this.audio?.play('gameover');
    }
  }

  applySlow(e, factor, duration) {
    if (e.def.traits?.slowImmune) return;
    if (this.clock >= e.slowUntil || factor < e.slowFactor) e.slowFactor = factor;
    e.slowUntil = Math.max(e.slowUntil, this.clock + duration);
  }

  applyStun(e, duration) {
    if (e.def.traits?.ccImmune || e.def.traits?.slowImmune) return;
    e.stunUntil = Math.max(e.stunUntil, this.clock + duration);
  }

  applyBurn(e, dps, duration, maxStacks = 1, src = null) {
    if (e.def.traits?.dotImmune) return;
    if (!e.burn || this.clock >= e.burn.until) {
      e.burn = { dps, until: this.clock + duration, stacks: 1, src };
    } else {
      e.burn.stacks = Math.min(maxStacks, e.burn.stacks + 1);
      e.burn.dps = Math.max(e.burn.dps, dps);
      e.burn.until = this.clock + duration;
      if (src) e.burn.src = src;
    }
  }

  applyAcid(e, dps, duration, src = null) {
    if (e.def.traits?.dotImmune) return;
    if (!e.acid || this.clock >= e.acid.until || dps > e.acid.dps) {
      e.acid = { dps, until: this.clock + duration, src };
    } else {
      e.acid.until = Math.max(e.acid.until, this.clock + duration);
      if (src) e.acid.src = src;
    }
  }

  applyShred(e, amount, duration) {
    if (this.clock >= e.shredUntil) e.shredAmount = 0;
    e.shredAmount = Math.max(e.shredAmount, amount);
    e.shredUntil = Math.max(e.shredUntil, this.clock + duration);
  }

  enemiesInRadius(x, y, r) {
    const out = [];
    const r2 = r * r;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2) out.push(e);
    }
    return out;
  }

  // -- update loop ---------------------------------------------------------

  update(dt) {
    if (this.paused || this.phase === 'over') {
      this.updateVisuals(dt);
      return;
    }

    // Hit stop: freeze the world outright for a few frames so heavy impacts
    // land. Everything stops, which is what makes the resume feel like a snap.
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      return;
    }

    this.clock += dt;

    // A Rally Flare expiring sends everyone back to walking at the camp.
    if (this.lure && this.clock >= this.lure.until) {
      this.lure = null;
      for (const e of this.enemies) this.retarget(e);
    }

    this.updateSpawns();
    this.updateStrikes(dt);
    this.updateAuras();
    this.updateEnemies(dt);
    this.updatePuddles(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateVisuals(dt);
    this.cullDead();
    this.checkWaveClear();

    if (this.autoStart && this.phase === 'building') this.startWave();
  }

  updateSpawns() {
    while (this.pending.length && this.pending[0].at <= this.clock) {
      const ev = this.pending.shift();
      this.spawnEnemy(ev.typeId, ev.waveNum, ev.hpBonus);
    }
    for (const w of this.runningWaves) {
      if (!w.spawnedAll && !this.pending.some((p) => p.waveNum === w.num)) {
        w.spawnedAll = true;
      }
    }
  }

  /** Screamer buffs are recomputed from scratch each tick, not timed. */
  updateAuras() {
    let anyScreamer = false;
    for (const e of this.enemies) {
      e.auraSpeed = 1;
      e.auraResist = 0;
      if (!e.dead && e.def.traits?.aura) anyScreamer = true;
    }
    if (!anyScreamer) return;

    for (const s of this.enemies) {
      const aura = s.def.traits?.aura;
      if (!aura || s.dead) continue;
      const r2 = (aura.radius * CELL) ** 2;
      for (const e of this.enemies) {
        if (e.dead || e === s) continue;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        if (dx * dx + dy * dy <= r2) {
          e.auraSpeed = Math.max(e.auraSpeed, aura.speedMult);
          e.auraResist = Math.max(e.auraResist, aura.damageResist);
        }
      }
    }
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.dead) continue;

      // Damage over time. Any active DoT also suppresses regeneration.
      let dotting = false;
      if (e.burn && this.clock < e.burn.until) {
        dotting = true;
        this.damage(e, e.burn.dps * e.burn.stacks * dt, 'fire', { src: e.burn.src });
      }
      if (!e.dead && e.acid && this.clock < e.acid.until) {
        dotting = true;
        this.damage(e, e.acid.dps * dt, 'acid', { src: e.acid.src });
      }
      if (e.dead) continue;

      const regen = e.def.traits?.regen;
      if (regen && !dotting && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * regen * dt);
      }

      e.wobble += dt * (4 + e.speed);

      // Knockback springs back to zero rather than displacing the unit.
      if (e.kx || e.ky) {
        const decay = Math.max(0, 1 - dt * 9);
        e.kx *= decay;
        e.ky *= decay;
        if (Math.abs(e.kx) < 0.04) e.kx = 0;
        if (Math.abs(e.ky) < 0.04) e.ky = 0;
      }

      if (this.clock < e.stunUntil) { e.vx = 0; e.vy = 0; continue; }

      const slow = this.clock < e.slowUntil ? e.slowFactor : 1;
      const move = e.speed * CELL * slow * e.auraSpeed * dt;
      this.stepEnemy(e, move, dt);
    }
  }

  stepEnemy(e, distance, dt) {
    let remaining = distance;
    const startX = e.x;
    const startY = e.y;

    for (let guard = 0; guard < 8 && remaining > 0; guard++) {
      const tpx = (e.tx + 0.5) * CELL + e.ox;
      const tpy = (e.ty + 0.5) * CELL + e.oy;
      const dx = tpx - e.x;
      const dy = tpy - e.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= remaining) {
        e.x = tpx; e.y = tpy;
        remaining -= dist;
        e.cx = e.tx; e.cy = e.ty;

        if (e.cx === GOAL.x && e.cy === GOAL.y) { this.leak(e); return; }
        const step = nextStep(this.fieldFor(e), e.cx, e.cy, e.dx, e.dy);
        if (!step) break; // stranded (shouldn't happen) - just idle
        e.tx = step.x; e.ty = step.y; e.dx = step.dx; e.dy = step.dy;
      } else {
        e.x += (dx / dist) * remaining;
        e.y += (dy / dist) * remaining;
        remaining = 0;
      }
    }
    if (dt > 0) {
      e.vx = (e.x - startX) / dt;
      e.vy = (e.y - startY) / dt;
    }
  }

  updatePuddles(dt) {
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.life -= dt;
      if (p.life <= 0) { this.puddles.splice(i, 1); continue; }
      p.tick -= dt;
      if (p.tick > 0) continue;
      p.tick = 0.2;
      for (const e of this.enemiesInRadius(p.x, p.y, p.radius)) {
        if (p.acid) {
          this.applyAcid(e, p.dps, 0.6, p.src);
          if (p.shred) this.applyShred(e, p.shred, 2);
        } else {
          this.applyBurn(e, p.dps, 0.7, 3, p.src);
        }
      }
    }
  }

  // -- towers --------------------------------------------------------------

  validTarget(tower, e, rangePx, minRangePx) {
    if (!e || e.dead) return false;
    const d = Math.hypot(e.x - tower.px, e.y - tower.py);
    return d <= rangePx && d >= minRangePx;
  }

  findTarget(tower, rangePx, minRangePx) {
    let best = null;
    let bestScore = -Infinity;

    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - tower.px;
      const dy = e.y - tower.py;
      const d = Math.hypot(dx, dy);
      if (d > rangePx || d < minRangePx) continue;

      let score;
      switch (tower.target) {
        // The flow field distance IS "how far from the camp", so first/last
        // are exact rather than approximate.
        case 'last': score = this.field[idx(e.cx, e.cy)]; break;
        case 'strong': score = e.hp; break;
        case 'weak': score = -e.hp; break;
        case 'near': score = -d; break;
        case 'first':
        default: score = -this.field[idx(e.cx, e.cy)]; break;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  updateTowers(dt) {
    for (const t of this.towers) {
      const s = t.stats;
      if (s.inert) continue;

      t.px = (t.x + 0.5) * CELL;
      t.py = (t.y + 0.5) * CELL;
      const rangePx = s.range * CELL;
      const minRangePx = (s.minRange ?? 0) * CELL;

      // Auras don't aim - they just pulse.
      if (s.attack === 'aura') {
        t.cooldown -= dt * (this.clock < this.overchargeUntil ? this.overcharge.rate : 1);
        if (t.cooldown <= 0) {
          t.cooldown = 1 / s.fireRate;
          this.pulseAura(t, s, rangePx);
        }
        continue;
      }

      if (!this.validTarget(t, t.ref, rangePx, minRangePx)) {
        t.ref = this.findTarget(t, rangePx, minRangePx);
      }

      if (t.ref) {
        const want = Math.atan2(t.ref.y - t.py, t.ref.x - t.px);
        // Shortest-arc turn so the turret never spins the long way round.
        let diff = ((want - t.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        t.angle += diff * Math.min(1, dt * 14);
        t.spin = Math.min(1, t.spin + dt / (s.spinUp?.rampTime ?? 1));
      } else {
        t.spin = Math.max(0, t.spin - dt * 0.8);
      }

      let rateMult = s.spinUp ? 1 + (s.spinUp.maxMult - 1) * t.spin : 1;
      if (this.clock < this.overchargeUntil) rateMult *= this.overcharge.rate;
      t.cooldown -= dt * rateMult;
      if (t.cooldown > 0) continue;

      if (!t.ref) { t.cooldown = 0; continue; }
      t.cooldown = 1 / s.fireRate;
      this.fire(t, s, t.ref);
    }
  }

  pulseAura(t, s, rangePx) {
    const hits = this.enemiesInRadius(t.px, t.py, rangePx);
    if (!hits.length) return;
    for (const e of hits) {
      if (s.damage > 0) this.damage(e, s.damage, s.dmgType, { src: t });
      if (e.dead) continue;
      if (s.slowFactor) this.applySlow(e, s.slowFactor, s.slowDuration);
      if (s.vulnerable) {
        e.vulnMult = Math.max(e.vulnMult, s.vulnerable.mult);
        e.vulnUntil = this.clock + s.vulnerable.duration;
      }
      if (s.freeze && Math.random() < s.freeze.chance) {
        this.applyStun(e, s.freeze.duration);
        this.effects.push({ kind: 'freeze', x: e.x, y: e.y, life: 0.35, max: 0.35 });
      }
    }
    if (s.attack === 'aura' && s.range > 1.6) {
      this.effects.push({ kind: 'pulse', x: t.px, y: t.py, r: rangePx, life: 0.3, max: 0.3, color: s.color });
    }
  }

  fire(t, s, target) {
    switch (s.attack) {
      case 'bullet': this.fireBullet(t, s, target); break;
      case 'acid': this.fireBullet(t, s, target, true); break;
      case 'hitscan': this.fireHitscan(t, s, target); break;
      case 'flame': this.fireFlame(t, s); break;
      case 'chain': this.fireChain(t, s, target); break;
      case 'mortar': this.fireMortar(t, s, target); break;
      default: break;
    }
  }

  /** Lead the target so slow projectiles still connect. */
  aimPoint(t, target, speed) {
    const dist = Math.hypot(target.x - t.px, target.y - t.py);
    const flight = dist / speed;
    return { x: target.x + target.vx * flight, y: target.y + target.vy * flight };
  }

  fireBullet(t, s, target, isAcid = false) {
    const def = TOWER_DEFS[t.defId];
    const speed = def.projSpeed ?? 900;
    const aim = this.aimPoint(t, target, speed);
    const ang = Math.atan2(aim.y - t.py, aim.x - t.px);

    this.projectiles.push({
      kind: isAcid ? 'acidball' : 'bullet',
      x: t.px + Math.cos(ang) * 12,
      y: t.py + Math.sin(ang) * 12,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: (s.range * CELL) / speed + 0.25,
      damage: s.damage,
      dmgType: s.dmgType,
      armorPen: s.armorPen ?? 0,
      pierce: s.pierce ?? 0,
      radius: isAcid ? 5 : 3,
      color: s.color,
      hits: new Set(),
      acid: isAcid ? s : null,
      src: t,
    });
    this.effects.push({ kind: 'muzzle', x: t.px, y: t.py, a: ang, life: 0.06, max: 0.06, color: s.color });
    t.recoil = 1;

    // Spent brass, thrown sideways out of the breech. Throttled because a
    // maxed Gatling fires ~12 rounds a second.
    if (!isAcid && Math.random() < 0.3) {
      const side = ang + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
      const sp = 40 + Math.random() * 60;
      this.effects.push({
        kind: 'casing', x: t.px, y: t.py,
        vx: Math.cos(side) * sp, vy: Math.sin(side) * sp,
        rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 22,
        life: 0.45 + Math.random() * 0.25, max: 0.7,
      });
    }
    this.audio?.play(isAcid ? 'acid' : 'shot');
  }

  fireHitscan(t, s, target) {
    let dmg = s.damage;
    let crit = false;
    if (s.crit && Math.random() < s.crit.chance) { dmg *= s.crit.mult; crit = true; }

    const dealt = this.damage(target, dmg, s.dmgType, { armorPen: s.armorPen, src: t });

    // Headhunter finishes off anything already badly wounded (bosses excepted).
    if (!target.dead && s.execute && !target.def.traits?.boss &&
        target.hp <= target.maxHp * s.execute) {
      this.kill(target);
      this.pushFloater(target.x, target.y - 10, 'EXECUTE', '#d98cd9');
    } else if (crit) {
      this.pushFloater(target.x, target.y - 10, `${Math.round(dealt)}!`, '#ffd24a');
    }

    this.effects.push({
      kind: 'beam', x1: t.px, y1: t.py, x2: target.x, y2: target.y,
      life: 0.12, max: 0.12, color: s.color, width: crit ? 3 : 1.8,
    });
    t.recoil = 1;
    if (crit) this.punch = Math.max(this.punch, 0.007);
    this.audio?.play('snipe');
  }

  fireFlame(t, s) {
    const def = TOWER_DEFS[t.defId];
    const rangePx = s.range * CELL;
    const half = def.cone ?? 0.42;
    let hit = false;

    for (const e of this.enemiesInRadius(t.px, t.py, rangePx)) {
      const ang = Math.atan2(e.y - t.py, e.x - t.px);
      let diff = Math.abs(((ang - t.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > half) continue;
      hit = true;

      let dmg = s.damage;
      if (s.maxHpBurn) dmg += e.maxHp * s.maxHpBurn;
      this.damage(e, dmg, 'fire', { src: t });
      if (!e.dead && s.burn) {
        this.applyBurn(e, s.burn.dps, s.burn.duration, s.burn.maxStacks ?? 1, t);
      }
    }

    if (s.puddle && Math.random() < 0.25) {
      const d = rangePx * 0.75;
      this.puddles.push({
        x: t.px + Math.cos(t.angle) * d,
        y: t.py + Math.sin(t.angle) * d,
        radius: s.puddle.radius * CELL,
        dps: s.puddle.dps,
        life: s.puddle.duration,
        tick: 0,
        acid: false,
        src: t,
        color: '#ff6a1a',
      });
    }

    this.effects.push({
      kind: 'cone', x: t.px, y: t.py, a: t.angle, half, r: rangePx,
      life: 0.1, max: 0.1, color: s.color,
    });
    if (hit) this.audio?.play('flame');
  }

  fireChain(t, s, target) {
    let current = target;
    let dmg = s.damage;
    const seen = new Set([current.uid]);
    let from = { x: t.px, y: t.py };
    const jumps = s.chains ?? 0;

    for (let i = 0; i <= jumps; i++) {
      this.damage(current, dmg, s.dmgType, { armorPen: s.armorPen, src: t });
      if (s.stun) this.applyStun(current, s.stun);
      this.effects.push({
        kind: 'arc', x1: from.x, y1: from.y, x2: current.x, y2: current.y,
        life: 0.14, max: 0.14, color: s.color,
      });
      if (i === jumps) break;

      from = { x: current.x, y: current.y };
      dmg *= s.chainFalloff ?? 0.7;

      let next = null;
      let bestD = Infinity;
      const reach = (s.chainRange ?? 2.4) * CELL;
      for (const e of this.enemies) {
        if (e.dead || seen.has(e.uid)) continue;
        const d = Math.hypot(e.x - from.x, e.y - from.y);
        if (d < bestD && d <= reach) { bestD = d; next = e; }
      }
      if (!next) break;
      seen.add(next.uid);
      current = next;
    }
    this.audio?.play('zap');
  }

  fireMortar(t, s, target) {
    const speed = s.shellSpeed ?? 380;
    const shots = s.cluster ?? 1;
    const aim = this.aimPoint(t, target, speed);

    for (let i = 0; i < shots; i++) {
      const scatter = s.scatter ? (Math.random() - 0.5) * s.scatter * CELL : 0;
      const scatterY = s.scatter ? (Math.random() - 0.5) * s.scatter * CELL : 0;
      const tx = aim.x + scatter;
      const ty = aim.y + scatterY;
      const dist = Math.hypot(tx - t.px, ty - t.py);
      this.projectiles.push({
        kind: 'shell',
        x0: t.px, y0: t.py, x1: tx, y1: ty,
        x: t.px, y: t.py,
        t: 0, dur: Math.max(0.25, dist / speed),
        damage: s.damage,
        dmgType: s.dmgType,
        armorPen: s.armorPen ?? 0,
        splash: (s.splash ?? 1.4) * CELL,
        permaShred: s.permaShred ?? 0,
        color: s.color,
        src: t,
      });
    }
    this.audio?.play('mortar');
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      if (p.kind === 'shell') {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        p.x = p.x0 + (p.x1 - p.x0) * k;
        p.y = p.y0 + (p.y1 - p.y0) * k;
        p.height = Math.sin(k * Math.PI) * 46;
        if (k >= 1) {
          this.explode(p);
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      let consumed = false;
      for (const e of this.enemies) {
        if (e.dead || p.hits.has(e.uid)) continue;
        const rr = e.radius + p.radius;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > rr * rr) continue;

        p.hits.add(e.uid);
        this.damage(e, p.damage, p.dmgType, { armorPen: p.armorPen, src: p.src });

        if (p.acid) {
          const s = p.acid;
          if (!e.dead) {
            this.applyShred(e, s.shred, s.shredDuration);
            this.applyAcid(e, s.acidDot.dps, s.acidDot.duration, p.src);
          }
          if (s.puddle) {
            this.puddles.push({
              x: p.x, y: p.y,
              radius: s.puddle.radius * CELL,
              dps: s.puddle.dps,
              life: s.puddle.duration,
              shred: s.puddle.shred,
              tick: 0, acid: true,
              src: p.src,
              color: '#9dff2b',
            });
          }
        }
        this.effects.push({ kind: 'spark', x: p.x, y: p.y, life: 0.14, max: 0.14, color: p.color });

        if (p.pierce > 0) { p.pierce -= 1; } else { consumed = true; }
        break;
      }

      if (consumed || p.life <= 0 ||
          p.x < -40 || p.y < -40 || p.x > CANVAS_W + 40 || p.y > CANVAS_H + 40) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  explode(p) {
    for (const e of this.enemiesInRadius(p.x, p.y, p.splash)) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const falloff = 1 - 0.45 * (d / p.splash); // centre hits hardest
      this.damage(e, p.damage * falloff, p.dmgType, { armorPen: p.armorPen, src: p.src });
      if (p.permaShred && !e.dead) e.permaShred += p.permaShred;
    }
    this.effects.push({
      kind: 'explosion', x: p.x, y: p.y, r: p.splash,
      life: 0.35, max: 0.35, color: p.color,
    });
    this.pushDecal('scorch', p.x, p.y, p.splash * 0.75, '#000000');
    this.shake = Math.max(this.shake, 5);
    this.punch = Math.max(this.punch, 0.008);
    this.audio?.play('boom');
  }

  // -- bookkeeping ---------------------------------------------------------

  /** Queue a permanent ground mark. Oldest are dropped once the cap is hit. */
  pushDecal(kind, x, y, r, color) {
    if (this.decals.length > 400) this.decals.shift();
    this.decals.push({ kind, x, y, r, color });
  }

  spawnBlood(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 120;
      this.effects.push({
        kind: 'blood', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5, max: 0.9,
        size: 1.5 + Math.random() * 2.5,
        color: color ?? '#6e1018',
      });
    }
  }

  pushFloater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 1.1, max: 1.1 });
  }

  updateVisuals(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life -= dt;
      if (fx.kind === 'blood') {
        fx.x += fx.vx * dt; fx.y += fx.vy * dt;
        fx.vx *= 0.88; fx.vy *= 0.88;
      } else if (fx.kind === 'chunk' || fx.kind === 'casing') {
        // Skid to a halt and stop spinning, as if landing on dirt.
        fx.x += fx.vx * dt; fx.y += fx.vy * dt;
        const drag = Math.max(0, 1 - dt * 6);
        fx.vx *= drag; fx.vy *= drag;
        fx.rot += fx.spin * dt;
        fx.spin *= drag;
      }
      if (fx.life <= 0) this.effects.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y -= dt * 22;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 40);
    this.punch = Math.max(0, this.punch - dt * 0.11);

    // Turret recoil springs back fast.
    for (const t of this.towers) {
      if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 9);
    }
  }

  cullDead() {
    if (!this.enemies.some((e) => e.dead)) return;
    for (const e of this.enemies) {
      if (!e.dead) continue;
      const w = this.runningWaves.find((r) => r.num === e.waveNum);
      if (w) w.remaining -= 1;
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    for (const t of this.towers) if (t.ref?.dead) t.ref = null;
  }

  checkWaveClear() {
    for (let i = this.runningWaves.length - 1; i >= 0; i--) {
      const w = this.runningWaves[i];
      if (!w.spawnedAll || w.remaining > 0) continue;

      const bonus = waveClearBonus(w.num, this.balance);
      const interest = Math.min(
        this.balance.interestCap,
        Math.floor(this.cash * this.balance.interestRate),
      );
      this.cash += bonus + interest;
      this.stats.earned += bonus + interest;
      this.lastPayout = { wave: w.num, bonus, interest };
      this.pushFloater(
        GOAL.x * CELL - 30, GOAL.y * CELL - 20,
        `+$${bonus + interest}`, '#6fcf5f',
      );
      this.runningWaves.splice(i, 1);
      this.audio?.play('waveclear');
    }

    if (this.phase === 'wave' && !this.runningWaves.length &&
        !this.pending.length && !this.enemies.length) {
      this.phase = 'building';
    }
  }

  // -- persistence ---------------------------------------------------------

  serialize() {
    return {
      v: 2,
      difficulty: this.balance.difficulty,
      cash: this.cash,
      baseHp: this.baseHp,
      wave: this.wave,
      repairsBought: this.repairsBought,
      stats: this.stats,
      autoStart: this.autoStart,
      towers: this.towers.map((t) => ({
        d: t.defId, x: t.x, y: t.y, l: t.level, b: t.branch, i: t.invested, m: t.target,
        dd: Math.round(t.damageDealt), k: t.kills,
      })),
    };
  }

  load(data) {
    if (!data || (data.v !== 1 && data.v !== 2)) return false;
    this.reset(data.difficulty ?? 'standard');
    this.cash = data.cash;
    this.baseHp = data.baseHp;
    this.wave = data.wave;
    this.repairsBought = data.repairsBought ?? 0;
    this.stats = { ...this.stats, ...data.stats };
    this.autoStart = !!data.autoStart;

    for (const t of data.towers) {
      const tower = {
        uid: nextUid++,
        defId: t.d, x: t.x, y: t.y,
        level: t.l, branch: t.b, invested: t.i,
        target: t.m ?? 'first',
        cooldown: 0, angle: 0, spin: 0, ref: null,
        damageDealt: t.dd ?? 0, kills: t.k ?? 0, recoil: 0,
        stats: towerStats(t.d, t.l, t.b),
      };
      this.towers.push(tower);
      this.towerAt[idx(t.x, t.y)] = tower;
    }
    this.phase = this.baseHp > 0 ? 'building' : 'over';
    this.buildVersion++;
    this.rebuild();
    return true;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
      return true;
    } catch { return false; }
  }

  static readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  static clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }

  /** Best result per difficulty, kept across runs. */
  static readRecords() {
    try {
      return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}') ?? {};
    } catch { return {}; }
  }

  /** Bank the finished run. Returns true if it beat the previous best. */
  recordRun() {
    const records = Game.readRecords();
    const key = this.balance.difficulty;
    const prev = records[key];
    const cleared = Math.max(0, this.wave - 1);
    const isBest = !prev || cleared > prev.wave;

    if (isBest) {
      records[key] = { wave: cleared, kills: this.stats.kills, at: Date.now() };
      try { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); } catch { /* ignore */ }
    }
    return { isBest, previous: prev?.wave ?? 0, cleared };
  }
}
