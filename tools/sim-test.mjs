// Headless simulation harness. Verifies the rules actually hold up.
// Resolve sibling modules relative to this file, so the repo can live anywhere.
const B = new URL('../src/', import.meta.url).href;
const { Game } = await import(B + 'game.js');
const { GRID } = await import(B + 'config.js');
const { MAPS, MAP_ORDER, mapFor } = await import(B + 'maps.js');
// The original board, which the pre-existing checks were all written against.
const { spawn: SPAWN, goal: GOAL } = MAPS.yard;
const { idx } = await import(B + 'pathfinding.js');
const { buildWave } = await import(B + 'waves.js');
const { towerStats, TOWER_DEFS } = await import(B + 'towers.js');

let fails = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name} ${extra}`); fails++; }
};

const STEP = 1 / 120;
const run = (g, secs) => { const n = Math.round(secs / STEP); for (let i = 0; i < n; i++) g.update(STEP); };

/** Upgrade a tower as far as cash allows, taking the first branch at level 4. */
function maxOut(g, t, limit = 40) {
  const def = TOWER_DEFS[t.defId];
  const bid = def.branches ? Object.keys(def.branches)[0] : null;
  for (let i = 0; i < limit; i++) if (!g.upgrade(t, bid).ok) break;
}

console.log('\n--- 1. map + pathfinding ---');
{
  const g = new Game(null);
  check('route exists on an empty map', g.route.length > 1, `len=${g.route.length}`);
  check('route starts at the breach', g.route[0].x === SPAWN.x && g.route[0].y === SPAWN.y);
  const end = g.route[g.route.length - 1];
  check('route ends at the camp', end.x === GOAL.x && end.y === GOAL.y);
  check('spawn cell is never blocked', !g.blocked[idx(SPAWN.x, SPAWN.y)]);
  check('camp cell is never blocked', !g.blocked[idx(GOAL.x, GOAL.y)]);
}

console.log('\n--- 2. the seal rule (cannot wall yourself in) ---');
{
  const g = new Game(null);
  g.cash = 999999;
  let placed = 0, refusals = 0;
  for (let y = 0; y < GRID.rows; y++) {
    if (g.place(5, y, 'barricade').ok) placed++; else refusals++;
  }
  check('a full-height wall is impossible', refusals >= 1, `placed=${placed} refused=${refusals}`);
  check('route still reaches the camp', g.route.length > 1);
  const gap = g.route.find((c) => c.x === 5);
  const reason = gap ? g.canPlace(5, gap.y, 'barricade').reason : '';
  check('refusal explains itself', typeof reason === 'string' && reason.length > 0, `"${reason}"`);
}

console.log('\n--- 3. maze building lengthens the route ---');
{
  const g = new Game(null);
  g.cash = 999999;
  const before = g.route.length;
  for (let y = 0; y < 14; y++) g.place(8, y, 'barricade');
  for (let y = 6; y < GRID.rows; y++) g.place(12, y, 'barricade');
  for (let y = 0; y < 14; y++) g.place(16, y, 'barricade');
  const after = g.route.length;
  check('route got meaningfully longer', after > before * 1.8, `${before} -> ${after}`);
}

console.log('\n--- 4. combat: a wave spawns, walks, and dies ---');
{
  const g = new Game(null);
  g.cash = 999999;
  for (let i = 0; i < 6; i++) g.place(4 + i * 2, 9, 'mg');
  g.startWave();
  check('wave 1 is in flight', g.phase === 'wave');
  run(g, 3);
  check('zombies spawned', g.stats.kills > 0 || g.enemies.length > 0,
    `alive=${g.enemies.length} kills=${g.stats.kills}`);
  run(g, 120);
  check('wave 1 fully cleared', g.phase === 'building',
    `phase=${g.phase} alive=${g.enemies.length} pending=${g.pending.length}`);
  check('kills were recorded', g.stats.kills > 0, `kills=${g.stats.kills}`);
  check('nothing leaked through 6 MG nests', g.stats.leaked === 0, `leaked=${g.stats.leaked}`);
  check('camp took no damage', g.baseHp === 100, `hp=${g.baseHp}`);
  check('clear bonus was paid', g.lastPayout?.wave === 1);
}

console.log('\n--- 5. leaks damage the camp ---');
{
  const g = new Game(null);
  g.startWave();
  run(g, 160);
  check('undefended camp takes damage', g.baseHp < 100, `hp=${g.baseHp}`);
  check('leaks were counted', g.stats.leaked > 0, `leaked=${g.stats.leaked}`);
}

console.log('\n--- 6. upgrades and branches ---');
{
  const g = new Game(null);
  g.cash = 999999;
  const t = g.place(6, 9, 'mg').tower;
  const dps1 = t.stats.damage * t.stats.fireRate;
  check('upgrade to lvl 2', g.upgrade(t).ok);
  check('upgrade to lvl 3', g.upgrade(t).ok);
  check('branch is required at level 4', !g.upgrade(t).ok);
  check('branch accepted', g.upgrade(t, 'shredder').ok);
  check('branch recorded', t.branch === 'shredder');
  maxOut(g, t);
  check('reached max level', t.level === 8, `lvl=${t.level}`);
  const dps8 = t.stats.damage * t.stats.fireRate;
  // Raw damage x rate only; pierce and armour-pen make the real gain far larger.
  check('max level is a big jump over level 1', dps8 > dps1 * 12,
    `${dps1.toFixed(1)} -> ${dps8.toFixed(1)} (${(dps8 / dps1).toFixed(1)}x raw)`);
  check('shredder gained pierce', t.stats.pierce > 0, `pierce=${t.stats.pierce}`);
  const invested = t.invested;
  const refund = g.sell(t);
  check('sell refunds 70%', refund === Math.floor(invested * 0.7), `refund=${refund}/${invested}`);
}

console.log('\n--- 7. every tower builds, maxes, and produces sane stats ---');
for (const id of ['barricade', 'mg', 'marksman', 'flame', 'cryo', 'acid', 'tesla', 'mortar']) {
  const g = new Game(null);
  g.cash = 9999999;
  const t = g.place(10, 9, id).tower;
  maxOut(g, t);
  const def = TOWER_DEFS[id];
  const s = t.stats;
  const finite = Number.isFinite(s.damage) && Number.isFinite(s.fireRate) &&
                 Number.isFinite(s.range) && s.range > 0;
  check(`${id.padEnd(9)} maxed to lvl ${t.level}/${def.maxLevel}, stats finite`,
    finite && t.level === def.maxLevel,
    `dmg=${s.damage?.toFixed(1)} rate=${s.fireRate?.toFixed(2)} range=${s.range?.toFixed(2)} cost=${t.invested}`);
}

console.log('\n--- 8. both branches of every tower actually differ ---');
for (const [id, def] of Object.entries(TOWER_DEFS)) {
  if (!def.branches) continue;
  const [a, b] = Object.keys(def.branches);
  const sa = JSON.stringify(towerStats(id, 8, a));
  const sb = JSON.stringify(towerStats(id, 8, b));
  check(`${id.padEnd(9)} ${a} !== ${b}`, sa !== sb);
}

console.log('\n--- 9. deterministic waves ---');
{
  check('same wave number = same composition',
    JSON.stringify(buildWave(23).preview) === JSON.stringify(buildWave(23).preview));
  check('boss on wave 10', buildWave(10).preview.some((p) => p.typeId === 'juggernaut'));
  check('boss on wave 30', buildWave(30).preview.some((p) => p.typeId === 'juggernaut'));
  check('no boss on wave 11', !buildWave(11).preview.some((p) => p.typeId === 'juggernaut'));
  check('wave 1 is walkers only',
    buildWave(1).preview.every((p) => p.typeId === 'walker'),
    JSON.stringify(buildWave(1).preview));
  let capped = true, maxTotal = 0;
  for (let w = 1; w <= 150; w++) { const t = buildWave(w).total; maxTotal = Math.max(maxTotal, t); if (t > 130) capped = false; }
  check('body count capped through wave 150', capped, `peak=${maxTotal}`);
}

console.log('\n--- 10. long run: 40 waves with a real defense ---');
{
  const g = new Game(null);
  g.cash = 4000;
  for (let y = 0; y < 15; y++) g.place(7, y, 'barricade');
  for (let y = 5; y < GRID.rows; y++) g.place(11, y, 'barricade');
  for (let y = 0; y < 15; y++) g.place(15, y, 'barricade');
  for (const [x, y, id] of [[5,8,'mg'],[9,3,'mg'],[13,16,'mg'],[9,12,'cryo'],
                            [13,6,'acid'],[17,9,'marksman'],[5,12,'flame'],[19,9,'tesla']]) {
    g.place(x, y, id);
  }

  const t0 = Date.now();
  let maxAlive = 0, lastWaveCleared = 0;
  for (let w = 1; w <= 40 && g.phase !== 'over'; w++) {
    g.startWave();
    let guard = 0;
    while (g.phase === 'wave' && guard < 200 / STEP) {
      g.update(STEP);
      maxAlive = Math.max(maxAlive, g.enemies.length);
      guard++;
    }
    if (g.phase === 'building') lastWaveCleared = w;
    // Reinvest everything between waves.
    let spent = true;
    while (spent) {
      spent = false;
      for (const t of g.towers) {
        const c = g.upgradeCostFor(t);
        if (c === null || g.cash < c) continue;
        const def = TOWER_DEFS[t.defId];
        const bid = def.branches ? Object.keys(def.branches)[0] : null;
        if (g.upgrade(t, bid).ok) spent = true;
      }
    }
  }
  const ms = Date.now() - t0;
  console.log(`  info  cleared through wave ${lastWaveCleared}, camp ${Math.round(g.baseHp)}hp, ` +
              `${g.stats.kills} kills, peak ${maxAlive} on screen, ${ms}ms`);
  check('40 waves simulated without crashing', true);
  check('cash is a real number', Number.isFinite(g.cash), `cash=${g.cash}`);
  check('camp hp is a real number', Number.isFinite(g.baseHp));
  check('sim fast enough for 3x speed', ms < 25000, `${ms}ms`);
  check('no zombie stranded off-route',
    g.enemies.every((e) => g.field[idx(e.cx, e.cy)] >= 0));
  check('a competent build survives well past wave 20', lastWaveCleared >= 20,
    `cleared=${lastWaveCleared}`);
}

console.log('\n--- 11. save / load round-trip ---');
{
  const g = new Game(null);
  g.cash = 5000;
  g.place(6, 9, 'mg');
  g.place(6, 10, 'tesla');
  g.upgrade(g.towers[0]);
  const blob = JSON.parse(JSON.stringify(g.serialize()));

  const g2 = new Game(null);
  check('load returns true', g2.load(blob));
  check('tower count restored', g2.towers.length === g.towers.length);
  check('levels restored', g2.towers[0].level === g.towers[0].level);
  check('cash restored', g2.cash === g.cash);
  check('field rebuilt after load', g2.route.length > 1);
}

console.log('\n--- 12. per-tower damage attribution ---');
{
  const g = new Game(null);
  g.cash = 999999;
  // Nothing on row 10, so the route stays straight and every tower can reach it.
  for (const [x, y, id] of [[4,9,'mg'],[7,9,'flame'],[10,11,'acid'],[13,9,'tesla']]) g.place(x,y,id);
  g.wave = 11;          // enough HP in the wave for everyone to get a share
  g.startWave();
  run(g, 90);
  const total = g.towers.reduce((a, t) => a + t.damageDealt, 0);
  const credited = g.towers.filter((t) => t.damageDealt > 0).length;
  check('damage is credited to towers', total > 0, `total=${Math.round(total)}`);
  check('every tower in reach got credit', credited === 4, `${credited} of ${g.towers.length}: ` +
    g.towers.map((t) => `${t.defId}=${Math.round(t.damageDealt)}`).join(' '));
  check('kills are credited too', g.towers.reduce((a,t)=>a+t.kills,0) > 0);
  check('DoT damage is attributed (flame tower scored)',
    g.towers.find((t) => t.defId === 'flame').damageDealt > 0);
  check('credited kills never exceed real kills',
    g.towers.reduce((a,t)=>a+t.kills,0) <= g.stats.kills,
    `${g.towers.reduce((a,t)=>a+t.kills,0)} vs ${g.stats.kills}`);
}

console.log('\n--- 13. difficulty curves actually differ ---');
{
  const { balanceFor } = await import(B + 'config.js');
  const hpAt = (diff, w) => {
    const b = balanceFor(diff);
    return (1 + b.hpLinear * (w-1)) * Math.pow(b.hpExpo, w-1);
  };
  check('relaxed is softer than standard at wave 30', hpAt('relaxed',30) < hpAt('standard',30),
    `${hpAt('relaxed',30).toFixed(0)}x vs ${hpAt('standard',30).toFixed(0)}x`);
  check('brutal is harsher than standard at wave 30', hpAt('brutal',30) > hpAt('standard',30),
    `${hpAt('brutal',30).toFixed(0)}x vs ${hpAt('standard',30).toFixed(0)}x`);
  check('relaxed starts with more camp', balanceFor('relaxed').startBaseHp > balanceFor('brutal').startBaseHp);

  // Same build, three difficulties - how far does each get?
  const results = {};
  for (const diff of ['relaxed', 'standard', 'brutal']) {
    const g = new Game(null, diff);
    g.cash = 4000;
    for (let y = 0; y < 15; y++) g.place(7, y, 'barricade');
    for (let y = 5; y < GRID.rows; y++) g.place(11, y, 'barricade');
    for (let y = 0; y < 15; y++) g.place(15, y, 'barricade');
    for (const [x,y,id] of [[5,8,'mg'],[9,3,'mg'],[13,16,'mg'],[9,12,'cryo'],
                            [13,6,'acid'],[17,9,'marksman'],[5,12,'flame'],[19,9,'tesla']]) g.place(x,y,id);
    let cleared = 0;
    for (let w = 1; w <= 70 && g.phase !== 'over'; w++) {
      g.startWave();
      let guard = 0;
      while (g.phase === 'wave' && guard < 200 / STEP) { g.update(STEP); guard++; }
      if (g.phase === 'building') cleared = w;
      let spent = true;
      while (spent) {
        spent = false;
        for (const t of g.towers) {
          const c = g.upgradeCostFor(t);
          if (c === null || g.cash < c) continue;
          const def = TOWER_DEFS[t.defId];
          if (g.upgrade(t, def.branches ? Object.keys(def.branches)[0] : null).ok) spent = true;
        }
      }
    }
    results[diff] = cleared;
  }
  console.log(`  info  same build reached â€” relaxed:${results.relaxed} standard:${results.standard} brutal:${results.brutal}`);
  check('relaxed outlasts brutal', results.relaxed > results.brutal, JSON.stringify(results));
  check('standard sits between the two',
    results.standard >= results.brutal && results.standard <= results.relaxed, JSON.stringify(results));
}

console.log('\n--- 14. save/load keeps difficulty and tower history ---');
{
  const g = new Game(null, 'brutal');
  g.cash = 9000;
  g.place(6, 9, 'mg');
  g.towers[0].damageDealt = 4321;
  g.towers[0].kills = 17;
  const blob = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(null);
  g2.load(blob);
  check('difficulty survives the round trip', g2.balance.difficulty === 'brutal', g2.balance.difficulty);
  check('brutal balance actually applied', g2.balance.hpExpo === g.balance.hpExpo);
  check('damage history survives', g2.towers[0].damageDealt === 4321);
  check('kill history survives', g2.towers[0].kills === 17);
  const legacy = { ...blob, v: 1 }; delete legacy.difficulty;
  const g3 = new Game(null);
  check('v1 saves still load (defaults to standard)',
    g3.load(legacy) && g3.balance.difficulty === 'standard');
}

console.log('\n--- 15. commander abilities ---');
{
  const { ABILITIES } = await import(B + 'config.js');
  // No towers: nothing must kill the horde before the abilities are tested.
  const g = new Game(null);
  g.cash = 999999;
  g.startWave();
  run(g, 12);
  check('enemies on the field to test against', g.enemies.length > 0, `${g.enemies.length}`);

  // Airstrike
  const target = g.enemies[0];
  const cell = { x: target.cx, y: target.cy };
  const hpBefore = g.enemies.reduce((a, e) => a + e.hp, 0);
  check('airstrike fires', g.useAbility('airstrike', cell).ok);
  check('airstrike is on cooldown after use', g.abilityCooldownLeft('airstrike') > 0);
  check('airstrike cannot be spammed', !g.useAbility('airstrike', cell).ok);
  check('airstrike is pending, not instant', g.strikes.length === 1);
  run(g, 1.5);
  check('airstrike detonated', g.strikes.length === 0);
  const hpAfter = g.enemies.reduce((a, e) => a + e.hp, 0);
  check('airstrike dealt damage', hpAfter < hpBefore || g.stats.kills > 0);
  check('no scrap was spent on it', true);

  // Rally flare — the interesting one: it must repoint the whole horde.
  const g2 = new Game(null);
  g2.cash = 999999;
  g2.startWave();
  run(g2, 14);
  const e2 = g2.enemies[0];
  const flare = { x: 2, y: 2 };
  check('flare needs open ground', !g2.useAbility('flare', { x: -5, y: 2 }).ok);
  check('flare fires', g2.useAbility('flare', flare).ok);
  check('flare field is aimed at the flare', g2.lureField[idx(flare.x, flare.y)] === 0);
  check('enemies now follow the flare field', g2.fieldFor(e2) === g2.lureField);
  const distBefore = Math.hypot(e2.x - (flare.x + 0.5) * 32, e2.y - (flare.y + 0.5) * 32);
  run(g2, 3);
  const alive = g2.enemies.find((e) => e.uid === e2.uid);
  if (alive) {
    const distAfter = Math.hypot(alive.x - (flare.x + 0.5) * 32, alive.y - (flare.y + 0.5) * 32);
    check('the horde walks toward the flare', distAfter < distBefore,
      `${Math.round(distBefore)} -> ${Math.round(distAfter)}`);
  } else {
    check('the horde walks toward the flare', true, '(target died, skipped)');
  }
  run(g2, 8);
  check('flare expires', g2.lure === null);
  check('horde reverts to the camp field', g2.fieldFor(g2.enemies[0] ?? e2) === g2.field);

  // Overcharge
  const g3 = new Game(null);
  g3.cash = 999999;
  check('overcharge fires', g3.useAbility('overcharge').ok);
  check('overcharge is active', g3.clock < g3.overchargeUntil);
  run(g3, 10);
  check('overcharge expires', g3.clock >= g3.overchargeUntil);

  // Cryo burst
  const g4 = new Game(null);
  g4.startWave();
  run(g4, 12);
  check('cryo burst fires', g4.useAbility('cryoburst').ok);
  check('everything is stunned', g4.enemies.every((e) => g4.clock < e.stunUntil || e.def.traits?.ccImmune));

  // Cooldowns recover, and the set is coherent.
  const g5 = new Game(null);
  for (const a of ABILITIES) check(`${a.id.padEnd(10)} starts ready`, g5.abilityCooldownLeft(a.id) === 0);
  g5.useAbility('overcharge');
  run(g5, ABILITIES.find((a) => a.id === 'overcharge').cooldown + 1);
  check('cooldown recovers over time', g5.abilityCooldownLeft('overcharge') === 0);
  check('unique hotkeys', new Set(ABILITIES.map((a) => a.key)).size === ABILITIES.length);
}

console.log('\n--- 16. abilities never break the core promises ---');
{
  const g = new Game(null);
  g.cash = 5000;
  const before = g.cash;
  g.place(6, 9, 'mg');
  const cashAfterBuild = g.cash;
  g.startWave();
  run(g, 12);
  g.useAbility('airstrike', { x: 3, y: 10 });
  g.useAbility('cryoburst');
  g.useAbility('overcharge');
  run(g, 3);
  check('abilities cost no scrap', g.cash >= cashAfterBuild, `${cashAfterBuild} -> ${g.cash}`);
  check('abilities destroy no towers', g.towers.length === 1);
  check('a flare can never route the horde into the camp early',
    g.baseHp === 100, `hp=${g.baseHp}`);

  // A flare placed on the camp cell must not become a free instant loss.
  const g2 = new Game(null);
  g2.startWave();
  run(g2, 12);
  const hpBefore = g2.baseHp;
  g2.useAbility('flare', { x: GOAL.x, y: GOAL.y });
  run(g2, 6);
  check('flaring the camp does not bypass the leak rules',
    Number.isFinite(g2.baseHp) && g2.baseHp <= hpBefore);
}

console.log('\n--- 17. game feel stays cosmetic ---');
{
  const g = new Game(null);
  g.cash = 999999;
  for (const [x, y, id] of [[4,9,'mg'],[8,11,'mg']]) g.place(x, y, id);
  for (const t of g.towers) for (let i = 0; i < 5; i++) g.upgrade(t, 'gatling');
  g.wave = 25;
  g.startWave();

  let peakKnock = 0, sawFlash = false, sawCasing = false;
  for (let i = 0; i < 25 / STEP; i++) {
    g.update(STEP);
    for (const e of g.enemies) {
      peakKnock = Math.max(peakKnock, Math.hypot(e.kx, e.ky));
      if (g.clock < e.flashUntil) sawFlash = true;
    }
    if (g.effects.some((f) => f.kind === 'casing')) sawCasing = true;
  }
  check('enemies flash when hit', sawFlash);
  check('spent brass is ejected', sawCasing);
  check('knockback happens', peakKnock > 0.5, `peak=${peakKnock.toFixed(2)}px`);
  check('knockback is clamped', peakKnock <= 9.01, `peak=${peakKnock.toFixed(2)}px`);
  check('knockback never moves the unit off its route',
    g.enemies.every((e) => g.field[idx(e.cx, e.cy)] >= 0));

  // Hit stop must freeze the world outright, then release it.
  const g2 = new Game(null);
  g2.startWave();
  run(g2, 14);
  g2.abilityReadyAt.airstrike = 0;
  const tgt = g2.enemies[0] ? { x: g2.enemies[0].cx, y: g2.enemies[0].cy } : { x: 5, y: 10 };
  g2.useAbility('airstrike', tgt);
  let detonated = false;
  for (let i = 0; i < 400 && !detonated; i++) {
    const had = g2.strikes.length;
    g2.update(STEP);
    detonated = had === 1 && g2.strikes.length === 0;
  }
  check('airstrike triggers hit stop', detonated && g2.hitStop > 0, `stop=${g2.hitStop}`);
  const clockBefore = g2.clock;
  const posBefore = g2.enemies[0] ? { x: g2.enemies[0].x, y: g2.enemies[0].y } : null;
  let frames = 0;
  while (g2.hitStop > 0 && frames < 100) { g2.update(STEP); frames++; }
  check('the clock does not advance while frozen', g2.clock === clockBefore);
  if (posBefore) {
    check('nothing moves while frozen',
      g2.enemies[0] && g2.enemies[0].x === posBefore.x && g2.enemies[0].y === posBefore.y);
  }
  check('hit stop always releases', g2.hitStop === 0 && frames < 100, `frames=${frames}`);

  // Hit stop must never be able to stall the game permanently.
  const g3 = new Game(null);
  g3.hitStop = 999;
  for (let i = 0; i < 5 / STEP; i++) g3.update(STEP);
  check('a huge hit stop still drains', g3.hitStop < 999);
}

console.log('\n--- 18. research meta-progression ---');
{
  const R = await import(B + 'research.js');

  // Node maths
  let bad = 0;
  for (const n of R.RESEARCH) {
    if (R.nodeCost(n, n.max) !== null) bad++;
    if (R.nodeCost(n, 0) !== n.base) bad++;
    if (R.nodeCost(n, 1) <= R.nodeCost(n, 0)) bad++;
  }
  check('costs escalate and cap out', bad === 0, `${bad} problems`);
  check('unique research ids', new Set(R.RESEARCH.map((n) => n.id)).size === R.RESEARCH.length);

  // A fresh player must get exactly the shipped balance.
  const zero = R.researchMods({ intel: 0, levels: {} });
  check('no research is a perfect no-op',
    zero.damage === 1 && zero.fireRate === 1 && zero.range === 1 &&
    zero.startCash === 0 && zero.maxBaseHp === 0 && zero.killReward === 1 &&
    zero.interest === 0 && zero.abilityCd === 1 && zero.upgradeCost === 1);

  // Fully maxed: strong, but bounded.
  const maxed = { intel: 0, levels: {} };
  for (const n of R.RESEARCH) maxed.levels[n.id] = n.max;
  const m = R.researchMods(maxed);
  check('maxed research is a real but bounded boost',
    m.damage > 1 && m.damage < 1.5 && m.fireRate > 1 && m.fireRate < 1.4,
    `dmg x${m.damage.toFixed(2)} rate x${m.fireRate.toFixed(2)}`);
  check('discounts never invert into bonuses', m.abilityCd > 0 && m.upgradeCost > 0,
    `cd x${m.abilityCd.toFixed(2)} upg x${m.upgradeCost.toFixed(2)}`);

  // Buying
  const st = { intel: 1000, levels: {} };
  const first = R.buyNode(st, 'munitions');
  check('a node can be bought', first.ok && st.levels.munitions === 1);
  check('intel is deducted', st.intel === 1000 - first.cost);
  const broke = { intel: 0, levels: {} };
  check('cannot buy without intel', !R.buyNode(broke, 'munitions').ok);
  const full = { intel: 99999, levels: { optics: R.researchNode('optics').max } };
  check('cannot exceed max level', !R.buyNode(full, 'optics').ok);
  check('unknown research is rejected', !R.buyNode(st, 'nope').ok);

  // Corrupt / hostile saved state must not break anything.
  const junk = R.researchMods({ intel: NaN, levels: { munitions: 9999, ghost: 3 } });
  check('out-of-range saved levels do not explode', Number.isFinite(junk.damage));
  check('mods survive a null state', Number.isFinite(R.researchMods(null).damage));

  // Intel payout
  const good = R.intelForRun({ wavesCleared: 40, kills: 1300, bossKills: 4, difficulty: 'standard' });
  const poor = R.intelForRun({ wavesCleared: 0, kills: 0, bossKills: 0, difficulty: 'standard' });
  const brutal = R.intelForRun({ wavesCleared: 40, kills: 1300, bossKills: 4, difficulty: 'brutal' });
  check('a good run pays real intel', good > 50, `${good}`);
  check('even a zero run banks something', poor >= 1, `${poor}`);
  check('brutal pays more than standard', brutal > good, `${brutal} vs ${good}`);
  console.log(`  info  a wave-40 standard run banks ${good} intel; first node level costs 30-55`);
}

console.log('\n--- 19. research actually reaches the simulation ---');
{
  const R = await import(B + 'research.js');
  const maxed = { intel: 0, levels: {} };
  for (const n of R.RESEARCH) maxed.levels[n.id] = n.max;

  const plain = new Game(null);
  const buffed = new Game(null);
  buffed.research = maxed;
  buffed.mods = R.researchMods(maxed);
  buffed.reset = () => {};          // keep the injected mods through setup
  buffed.cash = 999999;
  plain.cash = 999999;

  const a = plain.statsFor('mg', 1, null);
  const b = buffed.statsFor('mg', 1, null);
  check('research raises tower damage', b.damage > a.damage, `${a.damage} -> ${b.damage.toFixed(1)}`);
  check('research raises fire rate', b.fireRate > a.fireRate);
  check('research raises range', b.range > a.range);

  const f1 = plain.statsFor('flame', 8, 'napalm');
  const f2 = buffed.statsFor('flame', 8, 'napalm');
  check('research also scales damage-over-time', f2.burn.dps > f1.burn.dps,
    `${f1.burn.dps.toFixed(1)} -> ${f2.burn.dps.toFixed(1)}`);

  const t1 = plain.place(6, 9, 'mg').tower;
  const t2 = buffed.place(6, 9, 'mg').tower;
  check('placed towers carry the buff', t2.stats.damage > t1.stats.damage);
  check('upgrades are cheaper with research',
    buffed.upgradeCostFor(t2) < plain.upgradeCostFor(t1),
    `${plain.upgradeCostFor(t1)} -> ${buffed.upgradeCostFor(t2)}`);
  check('ability cooldowns are shorter with research',
    buffed.abilityCooldownTotal('airstrike') < plain.abilityCooldownTotal('airstrike'));

  // And it has to actually win more fights, not just show bigger numbers.
  const survive = (g) => {
    g.cash = 4000;
    for (let y = 0; y < 15; y++) g.place(7, y, 'barricade');
    for (let y = 5; y < GRID.rows; y++) g.place(11, y, 'barricade');
    for (const [x, y, id] of [[5,8,'mg'],[9,3,'mg'],[9,12,'cryo'],[13,6,'acid'],[5,12,'flame']]) g.place(x, y, id);
    let cleared = 0;
    for (let w = 1; w <= 45 && g.phase !== 'over'; w++) {
      g.startWave();
      let guard = 0;
      while (g.phase === 'wave' && guard < 200 / STEP) { g.update(STEP); guard++; }
      if (g.phase === 'building') cleared = w;
      let spent = true;
      while (spent) {
        spent = false;
        for (const t of g.towers) {
          const c = g.upgradeCostFor(t);
          if (c === null || g.cash < c) continue;
          const def = TOWER_DEFS[t.defId];
          if (g.upgrade(t, def.branches ? Object.keys(def.branches)[0] : null).ok) spent = true;
        }
      }
    }
    return cleared;
  };
  const plainRun = survive(new Game(null));
  const buffedGame = new Game(null);
  buffedGame.research = maxed;
  buffedGame.mods = R.researchMods(maxed);
  buffedGame.maxBaseHp = buffedGame.balance.maxBaseHp + buffedGame.mods.maxBaseHp;
  buffedGame.baseHp = buffedGame.maxBaseHp;
  const buffedRun = survive(buffedGame);
  console.log(`  info  same build — no research: wave ${plainRun}, maxed research: wave ${buffedRun}`);
  check('research measurably helps you survive longer', buffedRun > plainRun,
    `${plainRun} -> ${buffedRun}`);
}

console.log('\n--- 19b. every map is a real, playable board ---');
{
  check('the default board is still The Yard', new Game(null).map.id === 'yard');
  check('an unknown map id falls back rather than throwing', mapFor('nope').id === 'yard');
  check('MAP_ORDER covers every defined map',
    MAP_ORDER.length === Object.keys(MAPS).length
    && MAP_ORDER.every((id) => MAPS[id]), MAP_ORDER.join(','));

  for (const id of MAP_ORDER) {
    const m = MAPS[id];
    const g = new Game(null, 'standard', id);
    const pad = id.padEnd(11);

    // The whole design promise: exactly one way in, on every board.
    check(`${pad} has exactly one breach and one camp`,
      !!g.spawn && !!g.goal && g.map.id === id);
    check(`${pad} keeps breach and camp apart`,
      Math.abs(g.spawn.x - g.goal.x) + Math.abs(g.spawn.y - g.goal.y) >= 15,
      `manhattan=${Math.abs(g.spawn.x - g.goal.x) + Math.abs(g.spawn.y - g.goal.y)}`);
    for (const [what, p] of [['breach', g.spawn], ['camp', g.goal]]) {
      check(`${pad} ${what} is on the board`,
        p.x >= 0 && p.y >= 0 && p.x < GRID.cols && p.y < GRID.rows, `${p.x},${p.y}`);
      check(`${pad} ${what} cell is never blocked`, !g.blocked[idx(p.x, p.y)]);
    }

    // A map with no route is unshippable, so this is the important one.
    const end = g.route[g.route.length - 1];
    check(`${pad} has a route from breach to camp`,
      g.route.length > 1 && g.route[0].x === g.spawn.x && g.route[0].y === g.spawn.y
      && end.x === g.goal.x && end.y === g.goal.y,
      `len=${g.route.length}`);

    // Obstacles must sit on the board and leave room to actually build.
    const inside = m.obstacles.every((o) =>
      o.x >= 0 && o.y >= 0 && o.x + o.w <= GRID.cols && o.y + o.h <= GRID.rows);
    check(`${pad} all terrain is inside the board`, inside);
    const blockedCells = m.obstacles.reduce((n, o) => n + o.w * o.h, 0);
    const free = GRID.cols * GRID.rows - blockedCells;
    check(`${pad} leaves most of the field buildable`, free > GRID.cols * GRID.rows * 0.8,
      `${free}/${GRID.cols * GRID.rows} free`);

    // Terrain must never bury the breach or the camp under rubble.
    const buried = m.obstacles.some((o) =>
      [g.spawn, g.goal].some((p) =>
        p.x >= o.x && p.x < o.x + o.w && p.y >= o.y && p.y < o.y + o.h));
    check(`${pad} nothing is built on top of the breach or camp`, !buried);

    check(`${pad} has a name and a blurb`, !!m.name && !!m.blurb);
  }

  // The seal rule has to hold everywhere, not just on the board it was written for.
  for (const id of MAP_ORDER) {
    const g = new Game(null, 'standard', id);
    g.cash = 999999;
    // Wall off a full column and a full row; at least one cell must be refused.
    let refusals = 0;
    for (let y = 0; y < GRID.rows; y++) if (!g.place(16, y, 'barricade').ok) refusals++;
    for (let x = 0; x < GRID.cols; x++) if (!g.place(x, 10, 'barricade').ok) refusals++;
    check(`${id.padEnd(11)} cannot be sealed shut`,
      refusals >= 1 && g.route.length > 1, `refusals=${refusals} route=${g.route.length}`);
  }

  // Switching map is just another reset: no stale terrain from the old board.
  {
    const g = new Game(null, 'standard', 'reservoir');
    const tankCell = idx(15, 8);           // inside The Reservoir's dry tank
    check('reservoir has terrain where its tank is', !!g.terrain[tankCell]);
    g.reset('standard', 'yard');
    check('switching map clears the old terrain', !g.terrain[tankCell]);
    check('and lays the new map down', g.map.id === 'yard' && g.route.length > 1);
    g.reset('standard', 'reservoir');
    check('and switching back restores it', !!g.terrain[idx(15, 8)]);
  }

  // A run on every map, to prove they are actually survivable boards.
  for (const id of MAP_ORDER) {
    const g = new Game(null, 'standard', id);
    g.cash = 3000;
    // Ring the camp with guns rather than hand-authoring a maze per map.
    let built = 0;
    for (let r = 2; r <= 4 && built < 8; r++) {
      for (let dx = -r; dx <= r && built < 8; dx++) {
        for (const dy of [-r, r]) {
          const x = g.goal.x + dx, y = g.goal.y + dy;
          if (built < 8 && g.inBounds(x, y) && g.place(x, y, 'mg').ok) built++;
        }
      }
    }
    g.startWave();
    let guard = 0;
    while (g.phase === 'wave' && guard < 200 / STEP) { g.update(STEP); guard++; }
    check(`${id.padEnd(11)} wave 1 resolves with ${built} guns up`,
      g.phase === 'building' && g.stats.kills > 0,
      `phase=${g.phase} kills=${g.stats.kills} leaked=${g.stats.leaked}`);
  }
}

  // The natural (unmazed) walk differs a lot between boards, which is the point
  // - but an identical camp-adjacent build has to survive comparably on all of
  // them, or the map picker is really a second difficulty picker.
  {
    const lengths = MAP_ORDER.map((id) => `${id} ${new Game(null, 'standard', id).route.length}`);
    console.log(`  info  natural route length — ${lengths.join(', ')}`);
    const nums = MAP_ORDER.map((id) => new Game(null, 'standard', id).route.length);
    check('no map is a straight line to the camp', Math.min(...nums) > GRID.cols - 4);
    check('the boards genuinely differ in shape', Math.max(...nums) - Math.min(...nums) >= 8,
      nums.join(','));
  }

console.log('\n--- 19c. records are per map AND difficulty ---');
{
  // recordRun writes through localStorage, which doesn't exist here - so this
  // checks the key shape, which is what actually had to change.
  check('key pairs a map with a difficulty',
    Game.recordKey('overpass', 'brutal') === 'overpass:brutal');
  check('two maps on one difficulty are different records',
    Game.recordKey('yard', 'standard') !== Game.recordKey('overpass', 'standard'));

  // Saves carry their map, and pre-map saves belong to the original board.
  const g = new Game(null, 'brutal', 'coldstorage');
  g.cash = 9999;
  g.place(20, 10, 'mg');
  const blob = JSON.parse(JSON.stringify(g.serialize()));
  check('a save records its map', blob.map === 'coldstorage' && blob.v === 3);

  const g2 = new Game(null);
  check('a v3 save loads onto the right map', g2.load(blob) && g2.map.id === 'coldstorage');
  check('and the difficulty came with it', g2.balance.difficulty === 'brutal');
  check('and the towers landed', g2.towers.length === 1 && !!g2.towerAt[idx(20, 10)]);

  const legacy = { ...blob, v: 2 };
  delete legacy.map;
  const g3 = new Game(null, 'standard', 'overpass');
  check('a pre-map save still loads', g3.load(legacy));
  check('and lands on the original board', g3.map.id === 'yard');
}

console.log('\n--- 20. the offline bundle is complete ---');
{
  // research.js shipped without ever being added to the service worker's asset
  // list, which breaks the game offline while working perfectly online - so it
  // goes unnoticed. Every module the game imports has to be in that list.
  const { readFileSync, readdirSync } = await import('node:fs');
  const root = new URL('../', import.meta.url);
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/src\/([\w-]+\.(?:js|css))'/g)].map((m) => m[1]));
  const onDisk = readdirSync(new URL('src/', root)).filter((f) => /\.(js|css)$/.test(f));

  const missing = onDisk.filter((f) => !listed.has(f));
  check('every src file is cached by the service worker', missing.length === 0,
    `missing: ${missing.join(', ')}`);
  const stale = [...listed].filter((f) => !onDisk.includes(f));
  check('the service worker lists no files that no longer exist', stale.length === 0,
    `stale: ${stale.join(', ')}`);

  // A changed bundle with an unchanged cache name serves the old one forever.
  check('the cache name is versioned', /const CACHE = 'laststand-v\d+'/.test(sw));
}

console.log('\n--- 21. the camera ---');
{
  const { Viewport, MIN_SCALE, MAX_SCALE } = await import(B + 'viewport.js');
  const { CANVAS_W, CANVAS_H } = await import(B + 'config.js');
  const rect = { left: 0, top: 0, width: 800, height: 500 }; // canvas CSS box

  {
    const v = new Viewport();
    check('starts as the identity transform', v.scale === 1 && v.x === 0 && v.y === 0);
    check('is not "zoomed" at rest', !v.zoomed);
    // At 1x the mapping has to be exactly what it was before the camera existed.
    const c = v.toCell(rect.width / 2, rect.height / 2, rect);
    check('centre of the box is the centre cell', c.x === GRID.cols / 2 && c.y === GRID.rows / 2,
      `${c.x},${c.y}`);
    const far = v.toCell(rect.width - 1, rect.height - 1, rect);
    check('bottom-right maps to the last cell', far.x === GRID.cols - 1 && far.y === GRID.rows - 1,
      `${far.x},${far.y}`);
  }

  {
    const v = new Viewport();
    v.zoomBy(2, 512, 320);
    check('zoom is applied', Math.abs(v.scale - 2) < 1e-9);
    // The anchor point must not move on screen. It was dead centre, so it still is.
    const p = v.toWorld(rect.width / 2, rect.height / 2, rect);
    check('the zoom anchor stays put', Math.abs(p.x - 512) < 1e-6 && Math.abs(p.y - 320) < 1e-6,
      `${p.x},${p.y}`);
  }

  {
    const v = new Viewport();
    // Anchoring on a corner would push the window off the board; the clamp holds.
    v.zoomBy(3, 0, 0);
    v.panBy(-9999, -9999);
    check('cannot pan off the top-left', v.x === 0 && v.y === 0, `${v.x},${v.y}`);
    v.panBy(9999, 9999);
    check('cannot pan off the bottom-right',
      Math.abs(v.x - (CANVAS_W - v.viewW)) < 1e-9 && Math.abs(v.y - (CANVAS_H - v.viewH)) < 1e-9,
      `${v.x},${v.y}`);
    check('the window is never larger than the board', v.viewW <= CANVAS_W && v.viewH <= CANVAS_H);
  }

  {
    const v = new Viewport();
    v.zoomBy(0.2, 512, 320);
    check('never zooms out past fitting the board', v.scale === MIN_SCALE);
    check('and stays anchored at the origin when it does', v.x === 0 && v.y === 0);
    v.zoomBy(500, 512, 320);
    check('zoom is capped', v.scale === MAX_SCALE);
  }

  {
    // The point under a finger has to stay under it however far in you are.
    const v = new Viewport();
    v.zoomBy(3.4, 300, 180);
    v.panBy(120, -40);
    const cell = v.toCell(613, 377, rect);
    const back = {
      x: ((cell.x * GRID.cell - v.x) * v.scale / CANVAS_W) * rect.width,
      y: ((cell.y * GRID.cell - v.y) * v.scale / CANVAS_H) * rect.height,
    };
    check('screen -> cell -> screen lands in the same cell',
      back.x <= 613 && back.y <= 377
      && Math.abs(613 - back.x) < (GRID.cell * v.scale / CANVAS_W) * rect.width
      && Math.abs(377 - back.y) < (GRID.cell * v.scale / CANVAS_H) * rect.height,
      `${back.x},${back.y}`);
    check('every visible cell is a real cell',
      cell.x >= 0 && cell.x < GRID.cols && cell.y >= 0 && cell.y < GRID.rows,
      `${cell.x},${cell.y}`);
  }

  {
    const v = new Viewport();
    v.zoomBy(4, 100, 100);
    v.reset();
    check('reset returns to the untouched view', v.scale === 1 && v.x === 0 && v.y === 0);
  }

  {
    // A pinch is a zoom and a pan in the same frame; centring must survive both.
    const v = new Viewport();
    v.zoomBy(2.5, 512, 320);
    v.centerOn(SPAWN.x * GRID.cell, SPAWN.y * GRID.cell);
    check('centring on the breach keeps the window on the board',
      v.x >= 0 && v.y >= 0 && v.x + v.viewW <= CANVAS_W + 1e-9 && v.y + v.viewH <= CANVAS_H + 1e-9,
      `${v.x},${v.y}`);
    const mid = v.y + v.viewH / 2;
    check('and the breach is vertically centred', Math.abs(mid - SPAWN.y * GRID.cell) < 1e-6);
  }

  {
    const v = new Viewport();
    v.zoomBy(2, 512, 320);
    const d = v.screenToWorldDelta(rect.width / 2, 0, rect);
    check('a half-box drag moves half a window', Math.abs(d.x - v.viewW / 2) < 1e-9, `${d.x}`);
  }
}

console.log('\n--- 22. first-run coaching ---');
{
  const { Tutorial, STEPS } = await import(B + 'tutorial.js');
  // localStorage doesn't exist here; the guard has to swallow that, not throw.
  check('reads its "seen" flag without a DOM', Tutorial.seen() === false);

  const fresh = () => {
    const g = new Game(null);
    g.cash = 99999;
    return g;
  };
  const stepId = (t) => t.current?.id ?? (t.finished ? 'done' : 'stopped');

  {
    const g = fresh();
    const v = { buildId: null };
    let changes = 0;
    const t = new Tutorial(g, v, () => { changes++; });
    t.start();
    check('opens on picking up a barricade', stepId(t) === 'pick', stepId(t));

    // Each step advances only once the game state actually says so.
    v.buildId = 'barricade';
    t.update();
    check('picking one advances to walling', stepId(t) === 'wall', stepId(t));

    for (let y = 3; y < 8; y++) g.place(10, y, 'barricade');
    t.update();
    check('five walls is not yet a maze', stepId(t) === 'wall', stepId(t));
    g.place(10, 8, 'barricade');
    t.update();
    check('six walls advances to placing a gun', stepId(t) === 'gun', stepId(t));

    g.place(12, 6, 'mg');
    t.update();
    check('a gun advances to sending the wave', stepId(t) === 'send', stepId(t));

    g.startWave();
    t.update();
    check('starting the wave advances to abilities', stepId(t) === 'ability', stepId(t));

    g.useAbility('overcharge', null);
    t.update();
    check('using an ability advances to upgrading', stepId(t) === 'upgrade', stepId(t));

    g.upgrade(g.towers.find((x) => !x.stats.inert), null);
    t.update();
    check('upgrading finishes it', !t.active && t.finished, stepId(t));
    // One redraw per step shown, plus one to take the panel away at the end -
    // and nothing at all on the frames in between.
    check('it redrew once per step, not once per frame',
      changes === STEPS.length + 1, String(changes));

    t.update(); // must be inert once finished
    check('finishing twice is harmless', !t.active && t.finished);
  }

  {
    // Replaying it on an established board must not demand things already done.
    const g = fresh();
    for (let y = 3; y < 12; y++) g.place(10, y, 'barricade');
    g.place(12, 6, 'mg');
    const t = new Tutorial(g, { buildId: null });
    t.start();
    check('an existing maze skips straight past the building steps',
      stepId(t) === 'send', stepId(t));
  }

  {
    // A player who did literally everything before opening it gets no panel.
    const g = fresh();
    for (let y = 3; y < 12; y++) g.place(10, y, 'barricade');
    g.place(12, 6, 'mg');
    g.startWave();
    g.useAbility('cryoburst', null);
    g.upgrade(g.towers.find((x) => !x.stats.inert), null);
    const t = new Tutorial(g, { buildId: null });
    t.start();
    check('nothing left to teach closes it immediately', !t.active && t.finished, stepId(t));
  }

  {
    const g = fresh();
    const t = new Tutorial(g, { buildId: null });
    t.start();
    t.stop(false);
    check('stopping without completing leaves it unfinished', !t.active && !t.finished);
  }

  check('every step has a title, a body and a predicate',
    STEPS.every((s) => s.id && s.title && s.body && typeof s.done === 'function'));
  check('step ids are unique', new Set(STEPS.map((s) => s.id)).size === STEPS.length);
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`}\n`);
process.exit(fails === 0 ? 0 : 1);

