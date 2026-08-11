// ---------------------------------------------------------------------------
// Tower definitions and upgrade trees.
//
// Levels 1-3 use the tower's own growth curve. Buying level 4 forces a branch
// choice, and levels 4-8 use that branch's growth. Each branch also has a
// `derive` hook that scales its special mechanics with how far you've pushed it.
//
// `range` is in grid cells. `fireRate` is shots per second. Everything else is
// per-shot unless noted.
// ---------------------------------------------------------------------------

import { upgradeCost } from './config.js';

export const TOWER_DEFS = {
  // -------------------------------------------------------------------------
  barricade: {
    id: 'barricade',
    name: 'Barricade',
    tag: 'Wall',
    cost: 12,
    // Cheap to lay down in bulk, genuinely expensive to turn into a weapon.
    upgradeBase: 180,
    maxLevel: 3,
    attack: 'aura',
    dmgType: 'physical',
    color: '#8a7f63',
    shape: 'wall',
    desc: 'Cheap sandbag wall. Deals no damage - its whole job is to be in the way. Build long, winding corridors with these.',
    base: { damage: 0, fireRate: 1, range: 1.45 },
    growth: { damage: 1, fireRate: 1, range: 1 },
    levelNames: ['Barricade', 'Razor Wire', 'Electrified Fence'],
    levelDesc: [
      'Blocks movement. Nothing more, nothing less.',
      'Barbed wire shreds anything squeezing past. Small damage and a slow to adjacent zombies.',
      'Live current. Real damage and a heavy slow to anything walking alongside it.',
    ],
    derive(s, { level }) {
      // Only the upgraded versions do anything to passers-by.
      if (level >= 2) {
        s.damage = level === 2 ? 5 : 22;
        s.fireRate = 2;
        s.slowFactor = level === 2 ? 0.88 : 0.7;
        s.slowDuration = 0.5;
      } else {
        s.inert = true;
      }
    },
  },

  // -------------------------------------------------------------------------
  mg: {
    id: 'mg',
    name: 'MG Nest',
    tag: 'Rapid',
    cost: 80,
    maxLevel: 8,
    attack: 'bullet',
    dmgType: 'physical',
    color: '#c9a227',
    shape: 'mg',
    projSpeed: 1100,
    desc: 'Belt-fed machine gun. Low damage per round, enormous volume of fire. Your bread and butter against crowds - and useless against heavy armor until you upgrade it.',
    base: { damage: 6, fireRate: 4.0, range: 3.2 },
    growth: { damage: 1.32, fireRate: 1.1, range: 1.05 },
    branches: {
      gatling: {
        name: 'Gatling',
        blurb: 'Spins up while firing. Fire rate climbs to +120% if you keep it on target - devastating on long corridors.',
        color: '#ffcc33',
        growth: { damage: 1.22, fireRate: 1.2, range: 1.03 },
        derive(s, { post }) {
          s.spinUp = { maxMult: 2.2, rampTime: 3.0 };
          s.spinUp.maxMult = 2.2 + post * 0.14;
        },
      },
      shredder: {
        name: 'Shredder',
        blurb: 'Armor-piercing rounds punch straight through the zombie in front into the ones behind.',
        color: '#e08a3c',
        growth: { damage: 1.34, fireRate: 1.08, range: 1.05 },
        derive(s, { post }) {
          s.pierce = 1 + Math.floor(post * 0.8);
          s.armorPen = 2 + post * 1.6;
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  marksman: {
    id: 'marksman',
    name: 'Marksman Post',
    tag: 'Sniper',
    cost: 150,
    maxLevel: 8,
    attack: 'hitscan',
    dmgType: 'physical',
    color: '#7fa8c9',
    shape: 'sniper',
    defaultTarget: 'strong',
    desc: 'A patient shooter with a very long sightline. Slow, but every shot lands and hits hard. Defaults to picking off the biggest thing it can see.',
    base: { damage: 55, fireRate: 0.65, range: 7.5 },
    growth: { damage: 1.42, fireRate: 1.08, range: 1.06 },
    branches: {
      antimateriel: {
        name: 'Anti-Materiel',
        blurb: 'Ignores armor entirely and reaches even further. The dedicated answer to Brutes and Juggernauts.',
        color: '#5fd0e8',
        growth: { damage: 1.45, fireRate: 1.05, range: 1.08 },
        derive(s) {
          s.armorPen = 9999;
        },
      },
      headhunter: {
        name: 'Headhunter',
        blurb: 'Faster follow-ups, heavy crit chance, and finishes off any wounded non-boss outright.',
        color: '#d98cd9',
        growth: { damage: 1.3, fireRate: 1.18, range: 1.04 },
        derive(s, { post }) {
          s.crit = { chance: 0.2 + post * 0.05, mult: 3 };
          s.execute = 0.05 + post * 0.012; // fraction of max HP
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  flame: {
    id: 'flame',
    name: 'Flame Vent',
    tag: 'Burn',
    cost: 120,
    maxLevel: 8,
    attack: 'flame',
    dmgType: 'fire',
    color: '#ff7a2b',
    shape: 'flame',
    cone: 0.42, // half-angle in radians
    desc: 'Short-range cone of fire that hits everything in front of it and leaves them burning. Burn damage ignores armor and stops Regenerators from healing.',
    base: { damage: 5, fireRate: 6, range: 2.6 },
    growth: { damage: 1.28, fireRate: 1.06, range: 1.05 },
    branches: {
      napalm: {
        name: 'Napalm Projector',
        blurb: 'Splashes burning fuel onto the ground. The fire stays there and cooks everything that walks through.',
        color: '#ff5722',
        growth: { damage: 1.24, fireRate: 1.05, range: 1.08 },
        derive(s, { post }) {
          s.burn = { dps: s.damage * 1.2, duration: 3 };
          s.puddle = {
            dps: s.damage * (1.1 + post * 0.25),
            duration: 3.5 + post * 0.4,
            radius: 1.0 + post * 0.06,
          };
        },
      },
      incinerator: {
        name: 'Incinerator',
        blurb: 'Burn stacks up to five times and scales off the target’s max HP. Melts anything big and slow.',
        color: '#ffb300',
        growth: { damage: 1.34, fireRate: 1.08, range: 1.03 },
        derive(s, { post }) {
          s.burn = { dps: s.damage * 1.9, duration: 3.5, maxStacks: 5 };
          s.maxHpBurn = 0.004 + post * 0.0015; // extra burn dps per point of max HP
        },
      },
    },
    derive(s) {
      // Pre-branch flame still applies a modest burn.
      if (!s.burn) s.burn = { dps: s.damage * 1.2, duration: 3, maxStacks: 1 };
    },
  },

  // -------------------------------------------------------------------------
  cryo: {
    id: 'cryo',
    name: 'Cryo Sprayer',
    tag: 'Slow',
    cost: 170,
    maxLevel: 8,
    attack: 'aura',
    dmgType: 'energy',
    color: '#7fd4ff',
    shape: 'cryo',
    desc: 'Chills every zombie in radius, slowing them badly. Barely damages anything on its own - its value is holding the horde inside everyone else’s firing arcs.',
    base: { damage: 4, fireRate: 2, range: 3.0 },
    growth: { damage: 1.25, fireRate: 1.04, range: 1.07 },
    derive(s, { pre }) {
      s.slowFactor = 0.6 - pre * 0.04;
      s.slowDuration = 1.2;
    },
    branches: {
      deepfreeze: {
        name: 'Deep Freeze',
        blurb: 'Slows harder, and periodically freezes zombies solid where they stand.',
        color: '#4fb8ff',
        growth: { damage: 1.3, fireRate: 1.06, range: 1.06 },
        derive(s, { post }) {
          s.slowFactor = Math.max(0.22, 0.52 - post * 0.05);
          s.slowDuration = 1.4;
          s.freeze = { chance: 0.06 + post * 0.022, duration: 0.9 + post * 0.12 };
        },
      },
      frostbite: {
        name: 'Frostbite',
        blurb: 'Chilled zombies take dramatically more damage from every source. Force-multiplies your entire defense.',
        color: '#a5e8ff',
        growth: { damage: 1.22, fireRate: 1.04, range: 1.09 },
        derive(s, { post }) {
          s.slowFactor = 0.68;
          s.slowDuration = 1.6;
          s.vulnerable = { mult: 1.2 + post * 0.09, duration: 1.6 };
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  tesla: {
    id: 'tesla',
    name: 'Tesla Coil',
    tag: 'Chain',
    cost: 260,
    maxLevel: 8,
    attack: 'chain',
    dmgType: 'energy',
    color: '#9fe6ff',
    shape: 'tesla',
    desc: 'Arcs lightning from zombie to zombie. Energy damage only counts half of a target’s armor, so it stays relevant deep into a run.',
    base: { damage: 30, fireRate: 1.3, range: 4.0 },
    growth: { damage: 1.35, fireRate: 1.1, range: 1.05 },
    derive(s, { pre }) {
      s.chains = 2 + pre;
      s.chainFalloff = 0.72;
      s.chainRange = 2.4;
    },
    branches: {
      arcstorm: {
        name: 'Arc Storm',
        blurb: 'Far more jumps, longer jumps, and much less damage lost down the chain. Erases packed crowds.',
        color: '#7fffd4',
        growth: { damage: 1.24, fireRate: 1.14, range: 1.06 },
        derive(s, { post }) {
          s.chains = 4 + post;
          s.chainFalloff = Math.min(0.95, 0.78 + post * 0.035);
          s.chainRange = 2.6 + post * 0.2;
        },
      },
      overcharge: {
        name: 'Overcharge',
        blurb: 'Dumps the whole capacitor into one target and stuns it. Single-target execution.',
        color: '#c9a6ff',
        growth: { damage: 1.52, fireRate: 1.04, range: 1.05 },
        derive(s, { post }) {
          s.chains = 0;
          s.stun = 0.35 + post * 0.07;
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  mortar: {
    id: 'mortar',
    name: 'Mortar Pit',
    tag: 'Splash',
    cost: 300,
    maxLevel: 8,
    attack: 'mortar',
    dmgType: 'explosive',
    color: '#8f9c6a',
    shape: 'mortar',
    defaultTarget: 'first',
    desc: 'Lobs shells across the whole map. Huge splash damage, but it cannot depress its barrel far enough to hit anything close to itself.',
    base: { damage: 90, fireRate: 0.45, range: 9.0 },
    growth: { damage: 1.4, fireRate: 1.08, range: 1.04 },
    derive(s) {
      s.minRange = 2.5;
      s.splash = 1.5;
      s.shellSpeed = 380;
    },
    branches: {
      cluster: {
        name: 'Cluster Battery',
        blurb: 'Splits into a spread of smaller bomblets over the target area. Vastly more total damage against a packed corridor.',
        color: '#b9cc7a',
        growth: { damage: 1.3, fireRate: 1.12, range: 1.04 },
        derive(s, { post }) {
          s.minRange = 2.5;
          s.shellSpeed = 400;
          s.cluster = 3 + Math.floor(post * 0.7);
          s.splash = 1.15;
          s.damage *= 0.5; // per bomblet
          s.scatter = 1.6;
        },
      },
      bunkerbuster: {
        name: 'Bunker Buster',
        blurb: 'One enormous shell that permanently strips armor off everything it catches.',
        color: '#d9a05a',
        growth: { damage: 1.5, fireRate: 1.03, range: 1.05 },
        derive(s, { post }) {
          s.minRange = 3.0;
          s.shellSpeed = 340;
          s.splash = 1.9 + post * 0.1;
          s.permaShred = 2 + post * 1.2;
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  acid: {
    id: 'acid',
    name: 'Acid Sprayer',
    tag: 'Shred',
    cost: 200,
    maxLevel: 8,
    attack: 'acid',
    dmgType: 'acid',
    color: '#b6ff3d',
    shape: 'acid',
    projSpeed: 520,
    desc: 'Corrosive rounds that eat armor and leave a lingering burn. Weak on its own - pair it with an MG Nest and watch Brutes evaporate.',
    base: { damage: 12, fireRate: 1.6, range: 4.2 },
    growth: { damage: 1.28, fireRate: 1.1, range: 1.05 },
    derive(s, { pre }) {
      s.shred = 2 + pre * 0.8;
      s.shredDuration = 5;
      s.acidDot = { dps: s.damage * 0.8, duration: 4 };
    },
    branches: {
      dissolver: {
        name: 'Dissolver',
        blurb: 'Shred stacks without limit and the corrosion does serious damage on its own.',
        color: '#7fff5a',
        growth: { damage: 1.36, fireRate: 1.1, range: 1.04 },
        derive(s, { post }) {
          s.shred = 3.5 + post * 1.5;
          s.shredDuration = 6;
          s.acidDot = { dps: s.damage * (1.1 + post * 0.12), duration: 4.5 };
        },
      },
      caustic: {
        name: 'Caustic Cloud',
        blurb: 'Bursts into a corrosive pool that shreds and damages everything standing in it.',
        color: '#c9ff2b',
        growth: { damage: 1.24, fireRate: 1.12, range: 1.07 },
        derive(s, { post }) {
          s.shred = 2.5 + post * 0.6;
          s.shredDuration = 5;
          s.acidDot = { dps: s.damage * 0.7, duration: 4 };
          s.puddle = {
            dps: s.damage * (0.55 + post * 0.12),
            duration: 4 + post * 0.3,
            radius: 1.1 + post * 0.08,
            shred: 0.8 + post * 0.2,
            acid: true,
          };
        },
      },
    },
  },
};

export const TOWER_ORDER = ['barricade', 'mg', 'marksman', 'flame', 'cryo', 'acid', 'tesla', 'mortar'];

const SCALED = ['damage', 'fireRate', 'range'];

/**
 * Resolve a tower's live stats at a given level and branch.
 * @param {string} defId
 * @param {number} level 1..maxLevel
 * @param {string|null} branchId
 */
export function towerStats(defId, level, branchId = null) {
  const def = TOWER_DEFS[defId];
  const branch = branchId ? def.branches?.[branchId] : null;

  // Levels 2 and 3 use the base curve; 4+ use the branch curve.
  const pre = Math.min(level, 3) - 1;
  const post = Math.max(0, level - 3);
  const postGrowth = branch?.growth ?? def.growth;

  const s = { ...def.base };
  for (const key of SCALED) {
    if (def.growth[key]) s[key] *= Math.pow(def.growth[key], pre);
    if (postGrowth[key]) s[key] *= Math.pow(postGrowth[key], post);
  }

  const ctx = { level, pre, post, branch: branchId };
  def.derive?.(s, ctx);
  branch?.derive?.(s, ctx);

  s.dmgType = def.dmgType;
  s.attack = def.attack;
  s.color = branch?.color ?? def.color;
  return s;
}

/**
 * Cost to take a tower from `level` to `level + 1`, or null if maxed.
 * `upgradeBase` lets a tower decouple its upgrade curve from its build cost -
 * the barricade is deliberately dirt cheap to place but expensive to electrify.
 */
export function nextUpgradeCost(defId, level) {
  const def = TOWER_DEFS[defId];
  if (level >= def.maxLevel) return null;
  return upgradeCost(def.upgradeBase ?? def.cost, level + 1);
}

/** Display name for a tower at its current level/branch. */
export function towerTitle(defId, level, branchId) {
  const def = TOWER_DEFS[defId];
  if (def.levelNames) return def.levelNames[level - 1] ?? def.name;
  const branch = branchId ? def.branches?.[branchId] : null;
  return branch ? `${branch.name} ${def.name.split(' ').pop()}` : def.name;
}
