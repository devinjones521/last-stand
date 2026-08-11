// ---------------------------------------------------------------------------
// Wave generation.
//
// Waves are DETERMINISTIC - wave 37 has the same composition every run, so you
// can actually learn the run and plan for it. The RNG is seeded off the wave
// number alone.
//
// Difficulty scales through: tougher bodies, nastier archetypes, tighter
// spacing, and more of them. It never scales by adding spawn points.
// ---------------------------------------------------------------------------

import { BALANCE } from './config.js';
import { ENEMY_DEFS, unlockedTypes } from './enemies.js';

/** Small deterministic PRNG so a given wave is always identical. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seconds between individual spawns within a group, before wave compression.
const BASE_GAP = {
  crawler: 0.26, runner: 0.4, walker: 0.55, hazmat: 0.55,
  screamer: 1.1, regenerator: 0.8, husk: 0.8, brute: 1.1,
  bloater: 1.2, juggernaut: 2.4,
};

const FLAVOURS = {
  normal: { label: 'Horde', weights: {} },
  swarm: {
    label: 'Swarm',
    weights: { crawler: 4, runner: 3, walker: 2, hazmat: 1.2 },
    countMult: 1.7,
  },
  armoured: {
    label: 'Armoured Push',
    weights: { brute: 4, husk: 3, bloater: 2.5, hazmat: 1.5, walker: 0.5 },
  },
  boss: { label: 'BOSS', weights: { brute: 2, husk: 2, bloater: 1.5 } },
};

function flavourFor(wave, balance) {
  if (wave % balance.bossEvery === 0) return 'boss';
  if (wave % 7 === 0 && wave >= 7) return 'armoured';
  if (wave % 5 === 0) return 'swarm';
  return 'normal';
}

function weightedPick(rng, pool, weights) {
  let total = 0;
  for (const id of pool) total += weights[id] ?? 1;
  let roll = rng() * total;
  for (const id of pool) {
    roll -= weights[id] ?? 1;
    if (roll <= 0) return id;
  }
  return pool[pool.length - 1];
}

/**
 * Build the full spawn script for a wave.
 * @returns {{wave, flavour, label, hpBonus, total, preview, groups}}
 *   groups: [{ typeId, count, gap, delay }] - delay is seconds from wave start
 */
export function buildWave(wave, balance = BALANCE) {
  const rng = mulberry32(wave * 9176 + 17);
  const flavour = flavourFor(wave, balance);
  const info = FLAVOURS[flavour];

  const pool = unlockedTypes(wave);
  const budget = (balance.budgetBase + balance.budgetPerWave * wave) *
    (flavour === 'boss' ? 0.75 : 1);

  // How many distinct archetypes show up, capped by what's unlocked.
  const groupCount = Math.min(pool.length, Math.max(2, 2 + Math.floor(wave / 6)));

  // Pick distinct types.
  const chosen = [];
  const remaining = [...pool];
  for (let i = 0; i < groupCount && remaining.length; i++) {
    const id = weightedPick(rng, remaining, info.weights);
    chosen.push(id);
    remaining.splice(remaining.indexOf(id), 1);
  }

  // Split the budget between them, weighted so it isn't a flat quarter each.
  const shares = chosen.map(() => 0.5 + rng());
  const shareSum = shares.reduce((a, b) => a + b, 0);

  const groups = [];
  chosen.forEach((typeId, i) => {
    const def = ENEMY_DEFS[typeId];
    const share = (shares[i] / shareSum) * budget;
    let count = Math.max(1, Math.round((share / def.cost) * (info.countMult ?? 1)));
    groups.push({ typeId, count });
  });

  // Bosses are added on top of the budget, not out of it.
  if (flavour === 'boss') {
    groups.unshift({
      typeId: 'juggernaut',
      count: 1 + Math.floor(wave / 30),
    });
  }

  // Respect the body cap so late waves don't melt the frame rate. Overflow
  // becomes bonus HP on the survivors instead of more corpses to draw.
  const rawTotal = groups.reduce((a, g) => a + g.count, 0);
  let total = rawTotal;
  let hpBonus = 1;
  if (total > balance.maxEnemiesPerWave) {
    // Floor, not round - rounding up across several groups can breach the cap.
    const scale = balance.maxEnemiesPerWave / total;
    for (const g of groups) g.count = Math.max(1, Math.floor(g.count * scale));
    total = groups.reduce((a, g) => a + g.count, 0);
    hpBonus = rawTotal / total;
  }

  // Spacing: groups overlap more as waves climb, so late waves feel relentless
  // without ever changing where they come from.
  const compress = Math.max(0.42, 1 - wave * 0.008);
  const overlap = Math.max(0.35, 1 - wave * 0.012);
  let cursor = 0;
  for (const g of groups) {
    g.gap = (BASE_GAP[g.typeId] ?? 0.6) * compress;
    g.delay = cursor;
    cursor += g.count * g.gap * overlap;
  }

  return {
    wave,
    flavour,
    label: info.label,
    hpBonus,
    total,
    groups,
    preview: groups.map((g) => ({ typeId: g.typeId, count: g.count })),
    duration: Math.max(...groups.map((g) => g.delay + g.count * g.gap)),
  };
}

/** Cash paid out for clearing a wave. */
export function waveClearBonus(wave, balance = BALANCE) {
  return Math.round(balance.waveBonusBase + balance.waveBonusPerWave * wave);
}
