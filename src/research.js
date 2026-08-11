// ---------------------------------------------------------------------------
// Meta-progression: permanent research that carries between runs.
//
// Design rule, same as the rest of the game: this is purely ADDITIVE. A player
// with no research gets exactly the balance the game shipped with; research
// only ever makes you stronger. Nothing here nerfs the baseline to justify a
// tree, and nothing is ever lost.
//
// Intel is earned by finishing a run — you always bank something, even a bad one.
// ---------------------------------------------------------------------------

const KEY = 'laststand.research.v1';

/**
 * `per` is the effect of ONE level. Multiplicative entries are expressed as a
 * fraction added to 1.0; flat entries are added outright.
 */
export const RESEARCH = [
  {
    id: 'munitions', name: 'Munitions', max: 5, base: 40,
    blurb: 'Every tower deals more damage.',
    per: { damage: 0.04 }, unit: (n) => `+${(n * 4).toFixed(0)}% tower damage`,
  },
  {
    id: 'firecontrol', name: 'Fire Control', max: 5, base: 45,
    blurb: 'Every tower fires faster.',
    per: { fireRate: 0.03 }, unit: (n) => `+${(n * 3).toFixed(0)}% fire rate`,
  },
  {
    id: 'optics', name: 'Optics', max: 4, base: 50,
    blurb: 'Every tower reaches further.',
    per: { range: 0.03 }, unit: (n) => `+${(n * 3).toFixed(0)}% range`,
  },
  {
    id: 'logistics', name: 'Logistics', max: 5, base: 30,
    blurb: 'Begin each run with more scrap in hand.',
    per: { startCash: 60 }, unit: (n) => `+$${n * 60} starting scrap`,
  },
  {
    id: 'fortify', name: 'Fortifications', max: 5, base: 35,
    blurb: 'The camp can take more punishment before it falls.',
    per: { maxBaseHp: 15 }, unit: (n) => `+${n * 15} camp integrity`,
  },
  {
    id: 'salvage', name: 'Salvage Crews', max: 5, base: 40,
    blurb: 'Strip more scrap off every corpse.',
    per: { killReward: 0.05 }, unit: (n) => `+${(n * 5).toFixed(0)}% kill payout`,
  },
  {
    id: 'warchest', name: 'War Chest', max: 4, base: 45,
    blurb: 'Banked scrap earns more between waves.',
    per: { interest: 0.015 }, unit: (n) => `+${(n * 1.5).toFixed(1)}% interest`,
  },
  {
    id: 'ordnance', name: 'Ordnance Depot', max: 4, base: 50,
    blurb: 'Commander abilities come back sooner.',
    per: { abilityCd: 0.08 }, unit: (n) => `−${(n * 8).toFixed(0)}% ability cooldown`,
  },
  {
    id: 'engineering', name: 'Field Engineering', max: 4, base: 55,
    blurb: 'Tower upgrades cost less to install.',
    per: { upgradeCost: 0.04 }, unit: (n) => `−${(n * 4).toFixed(0)}% upgrade cost`,
  },
];

export const researchNode = (id) => RESEARCH.find((r) => r.id === id) ?? null;

/** Intel to buy the NEXT level of a node, or null when maxed. */
export function nodeCost(node, owned) {
  if (owned >= node.max) return null;
  return Math.round(node.base * Math.pow(1.7, owned));
}

export function loadResearch() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* ignore */ }
  const state = { intel: 0, levels: {}, ...(raw ?? {}) };
  state.intel = Number.isFinite(state.intel) ? state.intel : 0;
  state.levels = state.levels ?? {};
  // Drop anything that no longer exists or is out of range.
  for (const id of Object.keys(state.levels)) {
    const node = researchNode(id);
    if (!node) { delete state.levels[id]; continue; }
    state.levels[id] = Math.max(0, Math.min(node.max, state.levels[id] | 0));
  }
  return state;
}

export function saveResearch(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function resetResearch() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Collapse owned levels into the multipliers the game actually reads. */
export function researchMods(state) {
  const m = {
    damage: 1, fireRate: 1, range: 1,
    startCash: 0, maxBaseHp: 0,
    killReward: 1, interest: 0,
    abilityCd: 1, upgradeCost: 1,
  };
  for (const node of RESEARCH) {
    const lv = state?.levels?.[node.id] ?? 0;
    if (!lv) continue;
    const p = node.per;
    if (p.damage) m.damage += p.damage * lv;
    if (p.fireRate) m.fireRate += p.fireRate * lv;
    if (p.range) m.range += p.range * lv;
    if (p.startCash) m.startCash += p.startCash * lv;
    if (p.maxBaseHp) m.maxBaseHp += p.maxBaseHp * lv;
    if (p.killReward) m.killReward += p.killReward * lv;
    if (p.interest) m.interest += p.interest * lv;
    if (p.abilityCd) m.abilityCd -= p.abilityCd * lv;
    if (p.upgradeCost) m.upgradeCost -= p.upgradeCost * lv;
  }
  // Never let a discount invert into a bonus.
  m.abilityCd = Math.max(0.35, m.abilityCd);
  m.upgradeCost = Math.max(0.4, m.upgradeCost);
  return m;
}

export function buyNode(state, id) {
  const node = researchNode(id);
  if (!node) return { ok: false, reason: 'Unknown research' };
  const owned = state.levels[id] ?? 0;
  const cost = nodeCost(node, owned);
  if (cost === null) return { ok: false, reason: 'Already fully researched' };
  if (state.intel < cost) return { ok: false, reason: `Need ${cost} intel` };

  state.intel -= cost;
  state.levels[id] = owned + 1;
  saveResearch(state);
  return { ok: true, level: owned + 1, cost };
}

/**
 * Intel banked for a finished run. You always earn something — a bad run still
 * moves you forward, which is the whole point of the system.
 */
export function intelForRun({ wavesCleared, kills, bossKills, difficulty }) {
  const weight = { relaxed: 0.7, standard: 1, brutal: 1.4 }[difficulty] ?? 1;
  const raw = wavesCleared * 2 + Math.floor(kills / 25) + bossKills * 5;
  return Math.max(1, Math.round(raw * weight));
}
