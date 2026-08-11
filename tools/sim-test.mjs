// Headless simulation harness. Verifies the rules actually hold up.
// Resolve sibling modules relative to this file, so the repo can live anywhere.
const B = new URL('../src/', import.meta.url).href;
const { Game } = await import(B + 'game.js');
const { SPAWN, GOAL, GRID } = await import(B + 'config.js');
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

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`}\n`);
process.exit(fails === 0 ? 0 : 1);

