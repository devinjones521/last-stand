// ---------------------------------------------------------------------------
// Fuzz harness: play the game badly, on purpose, and check that the rules never
// break.
//
// The regular suite checks that correct play produces correct results. This
// checks the other half - that no sequence of legal-but-stupid actions can put
// the simulation into a state it should not be able to reach. It hammers every
// public mutator in random order, at random times, on every map and difficulty,
// and asserts a set of invariants after every single step.
//
//   node tools/fuzz.mjs [runs] [seed]
//
// It is deterministic: the same seed replays the same run exactly, so anything
// it finds can be reproduced and shrunk. npm test runs a short sweep of it.
// ---------------------------------------------------------------------------

const B = new URL('../src/', import.meta.url).href;
const { Game } = await import(B + 'game.js');
const { GRID } = await import(B + 'config.js');
const { MAP_ORDER } = await import(B + 'maps.js');
const { idx } = await import(B + 'pathfinding.js');
const { TOWER_DEFS, TOWER_ORDER } = await import(B + 'towers.js');
const { ABILITIES } = await import(B + 'config.js');

/** Deterministic PRNG (mulberry32), so a failing seed can be replayed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 1 / 120;
const DIFFS = ['relaxed', 'standard', 'brutal'];

/**
 * Everything that must be true after every single action, forever.
 * Returns a list of violations (empty when healthy).
 */
export function invariants(g) {
  const bad = [];
  const num = (label, v) => {
    if (!Number.isFinite(v)) bad.push(`${label} is not finite (${v})`);
  };

  num('cash', g.cash);
  num('baseHp', g.baseHp);
  num('clock', g.clock);
  if (g.cash < 0) bad.push(`cash went negative (${g.cash})`);
  if (g.baseHp > g.maxBaseHp) bad.push(`baseHp ${g.baseHp} > max ${g.maxBaseHp}`);
  if (g.baseHp < 0) bad.push(`baseHp went negative (${g.baseHp})`);
  if (!['building', 'wave', 'over'].includes(g.phase)) bad.push(`bad phase "${g.phase}"`);

  // THE rule: the horde can always reach the camp. If this ever fails, a player
  // has sealed themselves in and the run is unplayable.
  if (g.phase !== 'over') {
    if (!g.route || g.route.length < 1) bad.push('no route from breach to camp');
    else {
      const end = g.route[g.route.length - 1];
      if (g.route[0].x !== g.spawn.x || g.route[0].y !== g.spawn.y) bad.push('route does not start at the breach');
      if (end.x !== g.goal.x || end.y !== g.goal.y) bad.push('route does not reach the camp');
    }
  }

  // Towers: legal cells, no doubling up, and the index agrees with the list.
  const seen = new Set();
  for (const t of g.towers) {
    const i = idx(t.x, t.y);
    if (!g.inBounds(t.x, t.y)) bad.push(`tower off the board at ${t.x},${t.y}`);
    if (seen.has(i)) bad.push(`two towers share cell ${t.x},${t.y}`);
    seen.add(i);
    if (g.terrain[i]) bad.push(`tower built on terrain at ${t.x},${t.y}`);
    if (t.x === g.spawn.x && t.y === g.spawn.y) bad.push('tower built on the breach');
    if (t.x === g.goal.x && t.y === g.goal.y) bad.push('tower built on the camp');
    if (g.towerAt[i] !== t) bad.push(`towerAt disagrees with towers[] at ${t.x},${t.y}`);
    if (t.level < 1 || t.level > TOWER_DEFS[t.defId].maxLevel) bad.push(`${t.defId} at level ${t.level}`);
    num(`${t.defId}.damageDealt`, t.damageDealt);
    if (!t.stats) bad.push(`${t.defId} lost its stats`);
  }
  // ...and nothing lingering in the index that isn't in the list.
  let indexed = 0;
  for (let i = 0; i < g.towerAt.length; i++) if (g.towerAt[i]) indexed++;
  if (indexed !== g.towers.length) bad.push(`towerAt has ${indexed} entries for ${g.towers.length} towers`);

  // Enemies: on the board, alive, and heading somewhere real.
  for (const e of g.enemies) {
    num('enemy.x', e.x); num('enemy.y', e.y); num('enemy.hp', e.hp);
    if (e.hp <= 0) bad.push('a dead enemy is still in the list');
    if (!g.inBounds(e.cx, e.cy)) bad.push(`enemy off the board at cell ${e.cx},${e.cy}`);
    if (!g.inBounds(e.tx, e.ty)) bad.push(`enemy targeting off-board cell ${e.tx},${e.ty}`);
    if (e.x < -GRID.cell * 2 || e.x > GRID.cols * GRID.cell + GRID.cell * 2) bad.push(`enemy x out of world (${e.x})`);
  }

  for (const p of g.projectiles) { num('projectile.x', p.x); num('projectile.y', p.y); }
  return bad;
}

/** One randomised game. Returns { violations, actions, wave }. */
function fuzzRun(seed, { steps = 24000, verbose = false } = {}) {
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

  const map = pick(MAP_ORDER);
  const diff = pick(DIFFS);
  const g = new Game(null, diff, map);

  const violations = [];
  let actions = 0;
  const note = (what) => {
    const bad = invariants(g);
    for (const b of bad) {
      violations.push({ seed, map, diff, wave: g.wave, after: what, problem: b });
    }
  };
  note('new game');

  for (let i = 0; i < steps && violations.length === 0; i++) {
    // Mostly advance time; occasionally do something.
    if (rand() < 0.82) {
      g.update(STEP);
      if (i % 97 === 0) note('update');
      continue;
    }
    actions++;

    const roll = rand();
    // Money is handed out at random so the fuzzer can afford to be reckless,
    // and so "can't afford it" doesn't quietly become the only code path.
    if (rand() < 0.25) g.cash += Math.floor(rand() * 4000);

    if (roll < 0.34) {
      const x = Math.floor(rand() * GRID.cols);
      const y = Math.floor(rand() * GRID.rows);
      g.place(x, y, pick(TOWER_ORDER));
      note('place');
    } else if (roll < 0.46) {
      if (g.towers.length) { g.sell(pick(g.towers)); note('sell'); }
    } else if (roll < 0.62) {
      if (g.towers.length) {
        const t = pick(g.towers);
        const def = TOWER_DEFS[t.defId];
        const branch = def.branches ? pick(Object.keys(def.branches)) : null;
        // Deliberately pass a bogus branch sometimes.
        g.upgrade(t, rand() < 0.15 ? 'not-a-branch' : branch);
        note('upgrade');
      }
    } else if (roll < 0.72) {
      g.startWave();
      note('startWave');
    } else if (roll < 0.80) {
      g.repair();
      note('repair');
    } else if (roll < 0.92) {
      const ab = pick(ABILITIES);
      // Targets include the breach, the camp and off-board cells on purpose.
      const cell = rand() < 0.2
        ? { x: Math.floor(rand() * 60) - 14, y: Math.floor(rand() * 40) - 10 }
        : { x: Math.floor(rand() * GRID.cols), y: Math.floor(rand() * GRID.rows) };
      g.useAbility(ab.id, cell);
      note('useAbility');
    } else if (roll < 0.96) {
      g.speed = pick([1, 2, 3, 4]);
      g.autoStart = rand() < 0.5;
      note('speed/autostart');
    } else {
      // Save/load round trip mid-flight, which is where state tends to tear.
      const blob = JSON.parse(JSON.stringify(g.serialize()));
      const g2 = new Game(null);
      if (!g2.load(blob)) violations.push({ seed, problem: 'a save it just wrote would not load' });
      else {
        const bad = invariants(g2);
        for (const b of bad) violations.push({ seed, map, diff, after: 'load', problem: b });
      }
      note('serialize');
    }

    if (g.phase === 'over') {
      // Restarting is a legal thing to do at any moment.
      if (rand() < 0.5) { g.reset(pick(DIFFS), pick(MAP_ORDER)); note('reset after loss'); }
    }
  }

  if (verbose) {
    console.log(`  seed ${String(seed).padStart(6)}  ${map.padEnd(11)} ${diff.padEnd(8)} ` +
      `wave ${String(g.wave).padStart(3)}  ${actions} actions  ${g.towers.length} towers`);
  }
  return { violations, actions, wave: g.wave, map, diff };
}

// -- entry point ------------------------------------------------------------

export function fuzz(runs = 30, baseSeed = 1, opts = {}) {
  const all = [];
  let totalActions = 0, deepest = 0;
  for (let i = 0; i < runs; i++) {
    const r = fuzzRun(baseSeed + i * 7919, opts);
    all.push(...r.violations);
    totalActions += r.actions;
    deepest = Math.max(deepest, r.wave);
    if (r.violations.length) break;   // stop at the first failure; it's reproducible
  }
  return { violations: all, totalActions, deepest, runs };
}

// Run directly: node tools/fuzz.mjs [runs] [seed]
// pathToFileURL, not string-building: this repo lives under a path with a space
// in it, and a hand-rolled file:// URL doesn't percent-encode it.
const { pathToFileURL } = await import('node:url');
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runs = Number(process.argv[2] ?? 40);
  const seed = Number(process.argv[3] ?? 1);
  console.log(`\nFuzzing ${runs} runs from seed ${seed}...\n`);
  const t0 = Date.now();
  const res = fuzz(runs, seed, { verbose: true });
  const ms = Date.now() - t0;

  console.log(`\n${res.totalActions} random actions, deepest wave ${res.deepest}, ${ms}ms`);
  if (res.violations.length === 0) {
    console.log('NO INVARIANT VIOLATIONS\n');
  } else {
    console.log(`\n${res.violations.length} VIOLATION(S):`);
    for (const v of res.violations.slice(0, 20)) {
      console.log(`  seed ${v.seed} ${v.map ?? ''} ${v.diff ?? ''} wave ${v.wave ?? '?'} ` +
        `after ${v.after ?? '?'} — ${v.problem}`);
    }
    console.log('');
    process.exit(1);
  }
}
