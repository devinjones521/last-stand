// ---------------------------------------------------------------------------
// Enemy definitions.
//
// Design rule: no zombie ever damages, disables, or destroys a tower. Every
// special ability makes the horde harder to KILL, never harder to BUILD. You
// keep everything you invest, always.
//
// speed is in grid cells per second. `cost` is wave-budget weight.
// ---------------------------------------------------------------------------

export const ENEMY_DEFS = {
  walker: {
    id: 'walker',
    name: 'Walker',
    hp: 22, speed: 1.4, armor: 0, reward: 4, leak: 1, radius: 9,
    color: '#6b8f4e', shade: '#4a6636',
    unlock: 1, cost: 1,
    desc: 'The standard shambler. Slow, unarmoured, endless.',
  },
  runner: {
    id: 'runner',
    name: 'Runner',
    hp: 14, speed: 3.1, armor: 0, reward: 5, leak: 1, radius: 8,
    color: '#a8b84a', shade: '#7a8a2e',
    unlock: 3, cost: 1.1,
    desc: 'Sprints. Fragile, but it will blow straight past a slow gun line.',
  },
  crawler: {
    id: 'crawler',
    name: 'Crawler',
    hp: 8, speed: 4.0, armor: 0, reward: 3, leak: 1, radius: 6,
    color: '#8a6b4a', shade: '#5f4832',
    unlock: 5, cost: 0.65,
    desc: 'Comes in swarms and moves alarmingly fast. Individually trivial.',
  },
  brute: {
    id: 'brute',
    name: 'Brute',
    hp: 130, speed: 0.85, armor: 6, reward: 22, leak: 5, radius: 14,
    color: '#7d5a4a', shade: '#553a2e',
    unlock: 7, cost: 4.5,
    desc: 'Heavy armour blunts small-calibre fire. Bring acid or a marksman.',
  },
  hazmat: {
    id: 'hazmat',
    name: 'Hazmat',
    hp: 40, speed: 1.6, armor: 2, reward: 10, leak: 2, radius: 10,
    color: '#d8c840', shade: '#a08f22',
    unlock: 9, cost: 1.8,
    traits: { dotImmune: true },
    desc: 'Sealed suit. Completely immune to burn and acid damage over time.',
  },
  screamer: {
    id: 'screamer',
    name: 'Screamer',
    hp: 55, speed: 1.5, armor: 1, reward: 16, leak: 2, radius: 11,
    color: '#b04a8a', shade: '#7d2e60',
    unlock: 11, cost: 3.0,
    traits: { aura: { radius: 2.6, speedMult: 1.35, damageResist: 0.2 } },
    desc: 'Whips nearby zombies into a frenzy - faster and tougher. Kill it first.',
  },
  regenerator: {
    id: 'regenerator',
    name: 'Regenerator',
    hp: 70, speed: 1.3, armor: 1, reward: 14, leak: 2, radius: 11,
    color: '#4a9b7a', shade: '#2e6b52',
    unlock: 13, cost: 2.6,
    traits: { regen: 0.045 },
    desc: 'Knits itself back together constantly. Any burn or acid shuts the healing off.',
  },
  bloater: {
    id: 'bloater',
    name: 'Bloater',
    hp: 110, speed: 1.0, armor: 3, reward: 20, leak: 4, radius: 14,
    color: '#8a9b4a', shade: '#5f6b2e',
    unlock: 15, cost: 4.0,
    traits: { deathGas: { radius: 2.4, resist: 0.35, duration: 3.5 } },
    desc: 'Bursts on death into a gas cloud that armours everything nearby. Do not kill these in a pile.',
  },
  husk: {
    id: 'husk',
    name: 'Husk',
    hp: 90, speed: 1.55, armor: 4, reward: 18, leak: 3, radius: 12,
    color: '#6a6a7d', shade: '#464655',
    unlock: 18, cost: 3.2,
    traits: { slowImmune: true },
    desc: 'Burnt dry and rigid. Cannot be slowed, chilled or frozen by anything.',
  },
  juggernaut: {
    id: 'juggernaut',
    name: 'Juggernaut',
    hp: 1600, speed: 0.62, armor: 14, reward: 220, leak: 25, radius: 22,
    color: '#9b3a2e', shade: '#6b2318',
    unlock: 10, cost: 0,
    traits: { boss: true, ccImmune: true },
    desc: 'A wall of muscle and bone. Immune to stuns and freezes. Arrives every tenth wave.',
  },
};

export const ENEMY_ORDER = [
  'walker', 'runner', 'crawler', 'brute', 'hazmat',
  'screamer', 'regenerator', 'bloater', 'husk', 'juggernaut',
];

/**
 * Scale an enemy archetype to a given wave.
 * HP climbs on a linear*exponential curve, armour creeps, speed barely moves
 * and hard-caps - nothing should ever outrun your ability to react.
 */
export function scaleEnemy(def, wave, balance) {
  const w = wave - 1;
  const hpMult = (1 + balance.hpLinear * w) * Math.pow(balance.hpExpo, w);
  const speedMult = Math.min(balance.speedCapMult, 1 + balance.speedPerWave * w);

  return {
    hp: Math.round(def.hp * hpMult),
    armor: def.armor + balance.armorPerWave * w,
    speed: def.speed * speedMult,
    reward: Math.max(1, Math.round(def.reward * (1 + balance.killRewardGrowth * w))),
  };
}

/** Types available to the wave generator at a given wave number. */
export function unlockedTypes(wave) {
  return ENEMY_ORDER.filter((id) => {
    const def = ENEMY_DEFS[id];
    return !def.traits?.boss && def.unlock <= wave;
  });
}
