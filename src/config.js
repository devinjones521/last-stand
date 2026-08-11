// ---------------------------------------------------------------------------
// LAST STAND - central balance & layout config.
// Every tunable number in the game lives in this file. Nothing else hardcodes
// balance, so you can rebalance the whole game from here.
// ---------------------------------------------------------------------------

export const GRID = { cols: 32, rows: 20, cell: 32 };
export const CANVAS_W = GRID.cols * GRID.cell; // 1024
export const CANVAS_H = GRID.rows * GRID.cell; // 640

// THE one and only spawn point, and the camp you're defending.
// These never change, at any wave, ever. That is the whole design promise.
export const SPAWN = { x: 0, y: 10 };
export const GOAL = { x: GRID.cols - 1, y: 10 };

// Permanent terrain. Unbuildable, unwalkable - gives the field character and
// seeds interesting maze shapes without over-constraining the player.
export const OBSTACLES = [
  { x: 6, y: 2, w: 3, h: 2, kind: 'rubble' },
  { x: 5, y: 14, w: 2, h: 1, kind: 'wreck' },
  { x: 11, y: 5, w: 1, h: 3, kind: 'rubble' },
  { x: 12, y: 16, w: 3, h: 1, kind: 'rubble' },
  { x: 16, y: 2, w: 2, h: 2, kind: 'wreck' },
  { x: 18, y: 12, w: 1, h: 4, kind: 'rubble' },
  { x: 22, y: 6, w: 3, h: 1, kind: 'wreck' },
  { x: 24, y: 15, w: 2, h: 2, kind: 'rubble' },
  { x: 27, y: 3, w: 1, h: 3, kind: 'rubble' },
  { x: 9, y: 9, w: 1, h: 1, kind: 'barrel' },
  { x: 21, y: 11, w: 1, h: 1, kind: 'barrel' },
  { x: 14, y: 9, w: 1, h: 1, kind: 'barrel' },
];

export const BALANCE = {
  startCash: 300,
  startBaseHp: 100,
  maxBaseHp: 100,

  // Selling gives back this fraction of everything you sank into the tower.
  sellRefund: 0.7,

  // Economy -------------------------------------------------------------
  // Per-kill payout is scaled by (1 + killRewardGrowth * (wave - 1)).
  killRewardGrowth: 0.08,
  // Flat cash for clearing a wave: waveBonusBase + waveBonusPerWave * wave.
  waveBonusBase: 25,
  waveBonusPerWave: 10,
  // Banked cash earns interest at the end of each wave. Rewards saving up
  // for a big upgrade instead of dribbling cash into chaff.
  interestRate: 0.05,
  interestCap: 150,
  // Calling the next wave while the current one is still on the field.
  earlyCallBonus: 0.5, // fraction of that wave's clear bonus, paid immediately

  // Repairing the camp between waves. Cost climbs each time you use it.
  repairChunk: 25, // hp restored per purchase
  repairCostBase: 120,
  repairCostGrowth: 1.45,

  // Enemy scaling -------------------------------------------------------
  // hpMult(w) = (1 + hpLinear*(w-1)) * hpExpo^(w-1)
  hpLinear: 0.1,
  hpExpo: 1.075,
  // Armor creeps up slowly across the run.
  armorPerWave: 0.11,
  // Speed grows barely at all, and hard-caps. Nothing should ever outrun
  // your ability to react.
  speedPerWave: 0.004,
  speedCapMult: 1.35,

  // Wave composition budget: budgetBase + budgetPerWave * wave.
  budgetBase: 6,
  budgetPerWave: 2.2,
  maxEnemiesPerWave: 130, // past this, budget converts to HP instead of bodies

  // Armor math: effective = max(dmg * armorFloor, dmg - armor)
  armorFloor: 0.1,

  bossEvery: 10,
};

/**
 * Difficulty presets. Each one is a patch applied over BALANCE, so the whole
 * curve moves together - enemy HP, your income, and how much camp you get to
 * lose before it's over.
 *
 * These exist because the "right" curve is a matter of taste, not a fact.
 */
export const DIFFICULTIES = {
  relaxed: {
    id: 'relaxed',
    name: 'Relaxed',
    blurb: 'A long, generous ramp. Built for enjoying the building, not sweating the maths.',
    patch: {
      hpLinear: 0.09, hpExpo: 1.062,
      startCash: 450, startBaseHp: 150, maxBaseHp: 150,
      killRewardGrowth: 0.1, waveBonusPerWave: 13,
      budgetPerWave: 2.0, armorPerWave: 0.09,
      repairCostBase: 90,
    },
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    blurb: 'The intended curve. Wave 30 is a real test; a good maze goes much further.',
    patch: {},
  },
  brutal: {
    id: 'brutal',
    name: 'Brutal',
    blurb: 'Steeper HP, thinner wallet, less camp. Every placement has to earn its square.',
    patch: {
      hpLinear: 0.12, hpExpo: 1.088,
      startCash: 250, startBaseHp: 80, maxBaseHp: 80,
      killRewardGrowth: 0.07, waveBonusPerWave: 9,
      budgetPerWave: 2.5, armorPerWave: 0.14,
      repairCostBase: 160,
    },
  },
};

export const DIFFICULTY_ORDER = ['relaxed', 'standard', 'brutal'];

/** Resolve a difficulty id into a complete balance table. */
export function balanceFor(difficultyId) {
  const d = DIFFICULTIES[difficultyId] ?? DIFFICULTIES.standard;
  return { ...BALANCE, ...d.patch, difficulty: d.id };
}

// Tower upgrade costs. Level is the level you're buying (2..8).
export function upgradeCost(baseCost, level) {
  return Math.round(baseCost * 0.55 * Math.pow(1.6, level - 2));
}

// Canvas palette. Mirrors the CSS identity in src/styles.css: a warm
// olive-biased ground with signal amber as the single accent, olive-drab for
// "holding" and oxide red for danger.
export const COLORS = {
  ground: '#1d2016',
  groundAlt: '#232719',
  gridLine: 'rgba(233,227,210,0.030)',
  route: 'rgba(232,145,42,0.075)',
  routeLine: 'rgba(232,145,42,0.5)',

  rubble: '#32332a',
  rubbleTop: '#3d3e33',
  wreck: '#3a2e28',
  wreckTop: '#4a3a32',
  barrel: '#4a4326',

  spawn: '#c1442e',
  spawnGlow: 'rgba(193,68,46,0.35)',
  base: '#c7ab6d',
  baseDark: '#87703f',

  blood: '#6e1018',
  toxic: '#a8b565',
  amber: '#e8912a',
  danger: '#ef7a5f',
  ice: '#7fd4ff',
  fire: '#ff8a2b',
  acidGreen: '#b6ff3d',
  arc: '#9fe6ff',

  ok: '#a8b565',
  text: '#e9e3d2',
  textDim: '#8b8874',
};

export const TARGET_MODES = [
  { id: 'first', name: 'First', hint: 'Closest to your camp' },
  { id: 'last', name: 'Last', hint: 'Furthest from your camp' },
  { id: 'strong', name: 'Strongest', hint: 'Highest current HP' },
  { id: 'weak', name: 'Weakest', hint: 'Lowest current HP' },
  { id: 'near', name: 'Nearest', hint: 'Closest to this tower' },
];
