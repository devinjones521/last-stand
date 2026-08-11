// ---------------------------------------------------------------------------
// DOM user interface. Owns the sidebar, HUD, toasts and overlays.
// Reads game state; mutates it only through Game's public methods.
// ---------------------------------------------------------------------------

import { TARGET_MODES, DIFFICULTIES, DIFFICULTY_ORDER, ABILITIES } from './config.js';
import { TOWER_DEFS, TOWER_ORDER, towerStats, towerTitle, nextUpgradeCost } from './towers.js';
import { ENEMY_DEFS } from './enemies.js';

const $ = (sel) => document.querySelector(sel);

function fmt(n) {
  // Only a genuinely infinite value prints as ∞. Sentinel values (like the
  // marksman's 9999 armour pierce) are labelled at their own call site.
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(n < 1 ? 2 : 1);
}
const pct = (n) => `${Math.round(n * 100)}%`;

/** Human-readable stat rows for a resolved stat block. */
function statRows(s, defId) {
  const def = TOWER_DEFS[defId];
  const rows = [];
  if (s.inert) {
    rows.push(['Effect', 'Blocks movement']);
    return rows;
  }

  // Rough single-target DPS, adjusted for the mechanics that obviously change it.
  let dps = s.damage * s.fireRate;
  if (s.chains) dps *= 1 + s.chains * (s.chainFalloff ?? 0.7) * 0.6;
  if (s.cluster) dps *= s.cluster;
  if (s.spinUp) dps *= (1 + s.spinUp.maxMult) / 2;
  if (s.crit) dps *= 1 + s.crit.chance * (s.crit.mult - 1);

  rows.push(['DPS ~', fmt(dps)]);
  rows.push(['Damage', fmt(s.damage)]);
  rows.push(['Rate', `${fmt(s.fireRate)}/s`]);
  rows.push(['Range', fmt(s.range)]);

  const type = { physical: 'Physical', fire: 'Fire', acid: 'Acid', energy: 'Energy', explosive: 'Explosive' };
  rows.push(['Type', type[s.dmgType] ?? s.dmgType]);

  if (s.minRange) rows.push(['Min range', fmt(s.minRange)]);
  if (s.splash) rows.push(['Splash', fmt(s.splash)]);
  if (s.cluster) rows.push(['Bomblets', String(s.cluster)]);
  if (s.pierce) rows.push(['Pierce', `${s.pierce} extra`]);
  if (s.armorPen) rows.push(['Armour pen', s.armorPen >= 999 ? 'Total' : fmt(s.armorPen)]);
  if (s.permaShred) rows.push(['Armour destroy', fmt(s.permaShred)]);
  if (s.shred) rows.push(['Armour shred', fmt(s.shred)]);
  if (s.chains) rows.push(['Chains', String(s.chains)]);
  if (s.stun) rows.push(['Stun', `${fmt(s.stun)}s`]);
  if (s.crit) rows.push(['Crit', `${pct(s.crit.chance)} ×${s.crit.mult}`]);
  if (s.execute) rows.push(['Execute', `under ${pct(s.execute)} HP`]);
  if (s.slowFactor) rows.push(['Slow', `−${pct(1 - s.slowFactor)}`]);
  if (s.freeze) rows.push(['Freeze', `${pct(s.freeze.chance)} / ${fmt(s.freeze.duration)}s`]);
  if (s.vulnerable) rows.push(['Vulnerable', `+${pct(s.vulnerable.mult - 1)} dmg`]);
  if (s.burn) rows.push(['Burn', `${fmt(s.burn.dps)}/s${s.burn.maxStacks > 1 ? ` ×${s.burn.maxStacks}` : ''}`]);
  if (s.acidDot) rows.push(['Corrosion', `${fmt(s.acidDot.dps)}/s`]);
  if (s.puddle) rows.push(['Ground pool', `${fmt(s.puddle.dps)}/s`]);
  if (s.maxHpBurn) rows.push(['vs max HP', `+${(s.maxHpBurn * 100).toFixed(2)}%/s`]);
  if (def.cone) rows.push(['Arc', `${Math.round(def.cone * 2 * 57.3)}°`]);
  return rows;
}

export class UI {
  constructor(game, view, audio) {
    this.game = game;
    this.view = view;
    this.audio = audio;
    this.cache = {};
    this.toastTimers = [];
    this.onAction = () => {};
  }

  mount() {
    this.buildPalette();
    this.buildAbilityBar();
    this.wireControls();
    this.refresh(true);
  }

  // -- commander abilities -------------------------------------------------

  buildAbilityBar() {
    const bar = $('#abilities');
    bar.innerHTML = '';
    for (const a of ABILITIES) {
      const b = document.createElement('button');
      b.className = 'ab';
      b.dataset.id = a.id;
      b.title = `${a.name} — ${a.blurb}`;
      b.innerHTML = `
        <span class="ab-sweep"></span>
        <span class="ab-body">
          <span class="ab-name">${a.short}</span>
          <span class="ab-key">${a.key.toUpperCase()}</span>
        </span>
        <span class="ab-cd"></span>`;
      b.addEventListener('click', () => this.onAction('ability', a.id));
      bar.appendChild(b);
    }
  }

  /** Cheap per-frame pass: only the cooldown sweep and ready/aiming state. */
  refreshAbilities() {
    const g = this.game;
    for (const el of document.querySelectorAll('.ab')) {
      const id = el.dataset.id;
      const def = g.abilityDef(id);
      const left = g.abilityCooldownLeft(id);
      const frac = left > 0 ? left / def.cooldown : 0;

      el.classList.toggle('cooling', left > 0);
      el.classList.toggle('aiming', this.view.aiming === id);
      el.querySelector('.ab-sweep').style.height = `${frac * 100}%`;
      const cd = el.querySelector('.ab-cd');
      const label = left > 0 ? String(Math.ceil(left)) : '';
      if (cd.textContent !== label) cd.textContent = label;
    }
  }

  // -- build palette -------------------------------------------------------

  buildPalette() {
    const list = $('#build-list');
    list.innerHTML = '';
    TOWER_ORDER.forEach((id, i) => {
      const def = TOWER_DEFS[id];
      const b = document.createElement('button');
      b.className = 'bt';
      b.dataset.id = id;
      b.innerHTML = `
        <span class="bt-key">${i + 1}</span>
        <div class="bt-top">
          <i class="bt-swatch" style="background:${def.color}"></i>
          <span class="bt-name">${def.name}</span>
        </div>
        <div class="bt-meta">
          <span class="bt-tag">${def.tag}</span>
          <span class="bt-cost">$${def.cost}</span>
        </div>`;
      b.addEventListener('click', () => this.selectBuild(id));
      b.addEventListener('mouseenter', () => { this.hoverBuild = id; this.renderDetail(); });
      b.addEventListener('mouseleave', () => { this.hoverBuild = null; this.renderDetail(); });
      list.appendChild(b);
    });
  }

  selectBuild(id) {
    const v = this.view;
    v.buildId = v.buildId === id ? null : id;
    v.selected = null;
    v.aiming = null;
    v.buildStats = v.buildId ? towerStats(v.buildId, 1, null) : null;
    this.audio.play('ui');
    this.refresh(true);
  }

  selectTower(tower) {
    this.view.selected = tower;
    this.view.buildId = null;
    this.refresh(true);
  }

  clearSelection() {
    this.view.buildId = null;
    this.view.selected = null;
    this.view.previewRoute = null;
    this.view.aiming = null;
    this.refresh(true);
  }

  // -- controls ------------------------------------------------------------

  wireControls() {
    $('#btn-start').addEventListener('click', () => this.onAction('start'));
    $('#btn-pause').addEventListener('click', () => this.onAction('pause'));
    $('#btn-repair').addEventListener('click', () => this.onAction('repair'));
    $('#btn-menu').addEventListener('click', () => this.showMenu());

    $('#chk-auto').addEventListener('change', (e) => {
      this.game.autoStart = e.target.checked;
      this.toast(e.target.checked
        ? 'Auto-start on — waves will roll continuously'
        : 'Auto-start off — take all the time you need');
    });

    document.querySelectorAll('.spd').forEach((b) => {
      b.addEventListener('click', () => {
        this.game.speed = Number(b.dataset.speed);
        this.audio.play('ui');
        this.refresh(true);
      });
    });

    $('#btn-sound').addEventListener('click', () => {
      this.audio.setEnabled(!this.audio.enabled);
      $('#btn-sound').textContent = this.audio.enabled ? '🔊' : '🔇';
      $('#btn-sound').classList.toggle('is-on', this.audio.enabled);
    });
  }

  // -- per-frame refresh ---------------------------------------------------

  /** @param {boolean} force redraw panels that are expensive to rebuild */
  refresh(force = false) {
    const g = this.game;
    const c = this.cache;

    this.refreshAbilities();

    const cash = Math.floor(g.cash);
    if (force || c.cash !== cash) {
      c.cash = cash;
      $('#v-cash').textContent = `$${cash.toLocaleString()}`;
      this.refreshAffordability();
    }
    if (force || c.wave !== g.wave) {
      c.wave = g.wave;
      $('#v-wave').textContent = String(g.wave);
      this.renderWavePreview();
    }
    if (force || c.hp !== g.baseHp) {
      c.hp = g.baseHp;
      $('#v-hp').textContent = String(Math.max(0, Math.round(g.baseHp)));
      $('#v-hpbar').style.width = `${Math.max(0, (g.baseHp / g.maxBaseHp) * 100)}%`;
      $('#stat-hp').classList.toggle('low', g.baseHp <= g.maxBaseHp * 0.3);
      this.renderRepair();
    }
    if (force || c.kills !== g.stats.kills) {
      c.kills = g.stats.kills;
      $('#v-kills').textContent = String(g.stats.kills);
    }
    if (force || c.phase !== g.phase || c.paused !== g.paused) {
      c.phase = g.phase; c.paused = g.paused;
      $('#btn-pause').textContent = g.paused ? '▶' : '❚❚';
      $('#btn-pause').classList.toggle('is-on', g.paused);
      this.renderStartButton();
    }
    if (force || c.speed !== g.speed) {
      c.speed = g.speed;
      document.querySelectorAll('.spd').forEach((b) => {
        b.classList.toggle('is-on', Number(b.dataset.speed) === g.speed);
      });
    }
    if (force || c.selUid !== this.view.selected?.uid || c.selLvl !== this.view.selected?.level) {
      c.selUid = this.view.selected?.uid;
      c.selLvl = this.view.selected?.level;
      force = true;
    }
    if (force) {
      document.querySelectorAll('.bt').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.id === this.view.buildId);
      });
      this.renderDetail();
      this.renderStartButton();
    }
  }

  refreshAffordability() {
    const cash = this.game.cash;
    document.querySelectorAll('.bt').forEach((b) => {
      b.classList.toggle('poor', TOWER_DEFS[b.dataset.id].cost > cash);
    });
    // Upgrade / repair buttons live in rebuilt panels, so just re-render them.
    const up = $('#btn-upgrade');
    if (up && !up.dataset.placeholder && this.view.selected) {
      const cost = nextUpgradeCost(this.view.selected.defId, this.view.selected.level);
      up.disabled = cost === null || cash < cost;
    }
    document.querySelectorAll('.branch').forEach((b) => {
      b.disabled = Number(b.dataset.cost) > cash;
    });
    this.renderRepair();
  }

  renderRepair() {
    const g = this.game;
    const btn = $('#btn-repair');
    if (!btn) return;
    const full = g.baseHp >= g.maxBaseHp;
    const cost = g.repairCost();
    btn.textContent = full
      ? 'Camp at full strength'
      : `Repair +${g.balance.repairChunk} — $${cost.toLocaleString()}`;
    btn.disabled = full || g.cash < cost;
  }

  renderStartButton() {
    const g = this.game;
    const btn = $('#btn-start');
    const stacking = g.enemies.length > 0 || g.pending.length > 0;
    const next = g.wave + 1;

    $('#start-label').textContent = stacking
      ? `Send Wave ${next} early`
      : `Send Wave ${next}`;
    $('#start-hint').textContent = stacking
      ? `+$${Math.round((g.balance.waveBonusBase + g.balance.waveBonusPerWave * next) * g.balance.earlyCallBonus)} bonus for stacking`
      : 'Build as long as you like — nothing starts without you';
    btn.classList.toggle('hot', stacking);
    btn.disabled = g.phase === 'over';
  }

  renderWavePreview() {
    const script = this.game.nextWavePreview();
    const el = $('#wave-preview');
    el.innerHTML = script.preview.map((p) => {
      const d = ENEMY_DEFS[p.typeId];
      return `<span class="wp-item" title="${d.name} — ${d.desc}">
        <i class="wp-dot" style="background:${d.color}"></i>${d.name}
        <b class="wp-count">×${p.count}</b></span>`;
    }).join('');

    const chip = $('#wave-flavour');
    chip.textContent = script.label;
    chip.className = `chip ${script.flavour}`;
  }

  // -- detail panel --------------------------------------------------------

  renderDetail() {
    const el = $('#detail');
    const sel = this.view.selected;

    if (sel) { el.innerHTML = ''; el.appendChild(this.towerCard(sel)); return; }

    const previewId = this.view.buildId ?? this.hoverBuild;
    if (previewId) { el.innerHTML = ''; el.appendChild(this.previewCard(previewId)); return; }

    el.innerHTML = `<div class="detail-empty">
      <b>Click a tower</b> on the map to upgrade or sell it.<br>
      <b>Pick one from Build</b> to see its stats and place it.<br><br>
      Your towers <b>are the walls</b> — the dashed green line previews
      the new route before you commit.
    </div>`;
  }

  previewCard(id) {
    const def = TOWER_DEFS[id];
    const s = towerStats(id, 1, null);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="d-head"><span class="d-name">${def.name}</span>
        <span class="d-lvl">$${def.cost}</span></div>
      <div class="d-desc">${def.desc}</div>
      <div class="d-stats">${statRows(s, id).map(
        ([k, v]) => `<div class="d-stat"><span>${k}</span><span>${v}</span></div>`,
      ).join('')}</div>`;
    return wrap;
  }

  towerCard(t) {
    const def = TOWER_DEFS[t.defId];
    const s = t.stats;
    const cost = nextUpgradeCost(t.defId, t.level);
    const maxed = cost === null;
    const needsBranch = def.branches && t.level + 1 === 4 && !t.branch;
    const nextStats = maxed ? null : towerStats(t.defId, t.level + 1, t.branch);

    const wrap = document.createElement('div');
    const levelDesc = def.levelDesc?.[t.level - 1];
    const branchName = t.branch ? def.branches[t.branch].name : null;

    // Stat rows, with the ones that would improve highlighted.
    const rows = statRows(s, t.defId);
    const nextRows = nextStats ? new Map(statRows(nextStats, t.defId)) : null;
    const rowsHtml = rows.map(([k, v]) => {
      const nv = nextRows?.get(k);
      const changed = nv !== undefined && nv !== v && !needsBranch;
      return `<div class="d-stat${changed ? ' up' : ''}">
        <span>${k}</span><span>${v}${changed ? ` → ${nv}` : ''}</span></div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="d-head">
        <span class="d-name">${towerTitle(t.defId, t.level, t.branch)}</span>
        <span class="d-lvl">LVL ${t.level}/${def.maxLevel}</span>
      </div>
      ${branchName ? `<div class="hint" style="color:var(--amber)">${branchName} specialisation</div>` : ''}
      <div class="d-desc">${levelDesc ?? def.desc}</div>
      <div class="d-stats">${rowsHtml}</div>
      ${t.damageDealt > 0
        ? `<div class="perf">Lifetime <b>${fmt(t.damageDealt)}</b> damage · <b>${t.kills}</b> kills</div>`
        : ''}`;

    // The upgrade slot ALWAYS renders, even when a branch choice is pending.
    // If it vanished, Sell would slide up into the exact pixels you were just
    // clicking - and a fast second click would sell the tower by mistake.
    const row = document.createElement('div');
    row.className = 'd-row';

    const up = document.createElement('button');
    up.className = 'ghost buy';
    up.id = 'btn-upgrade';
    if (needsBranch) {
      up.textContent = 'Pick a specialisation ↓';
      up.disabled = true;
      up.dataset.placeholder = '1'; // refreshAffordability must not re-enable it
    } else {
      up.textContent = maxed ? 'Fully upgraded' : `Upgrade — $${cost.toLocaleString()}`;
      up.disabled = maxed || this.game.cash < cost;
      up.addEventListener('click', () => {
        this.sellGuardUntil = performance.now() + 400;
        this.onAction('upgrade');
      });
    }
    row.appendChild(up);
    wrap.appendChild(row);

    // Branch choice at level 4.
    if (needsBranch) {
      const bw = document.createElement('div');
      bw.className = 'branch-wrap';
      bw.innerHTML = `<div class="branch-title">Choose a specialisation — $${cost.toLocaleString()}</div>`;
      for (const [bid, b] of Object.entries(def.branches)) {
        const btn = document.createElement('button');
        btn.className = 'branch';
        btn.dataset.cost = cost;
        btn.disabled = this.game.cash < cost;
        btn.innerHTML = `<div class="branch-name" style="color:${b.color}">${b.name}</div>
          <div class="branch-blurb">${b.blurb}</div>`;
        btn.addEventListener('click', () => {
          this.sellGuardUntil = performance.now() + 400;
          this.onAction('upgrade', bid);
        });
        bw.appendChild(btn);
      }
      wrap.appendChild(bw);
    }

    // Targeting priority.
    if (!s.inert && def.attack !== 'aura') {
      const tg = document.createElement('div');
      tg.className = 'targeting';
      for (const m of TARGET_MODES) {
        const b = document.createElement('button');
        b.className = `tg${t.target === m.id ? ' is-on' : ''}`;
        b.textContent = m.name;
        b.title = m.hint;
        b.addEventListener('click', () => {
          t.target = m.id;
          t.ref = null;
          this.audio.play('ui');
          this.renderDetail();
        });
        tg.appendChild(b);
      }
      wrap.appendChild(tg);
    }

    // Sell lives at the very bottom, in its own bordered footer, so it is never
    // adjacent to (or newly underneath) the button you were just clicking.
    const foot = document.createElement('div');
    foot.className = 'sell-foot';
    const sell = document.createElement('button');
    sell.className = 'ghost sell wide';
    sell.id = 'btn-sell';
    sell.textContent = `Sell for $${Math.floor(t.invested * this.game.balance.sellRefund).toLocaleString()}`;

    // Belt and braces: briefly inert right after an upgrade, so a stray fast
    // click that lands here can't cash out the tower you were building.
    const remaining = (this.sellGuardUntil ?? 0) - performance.now();
    if (remaining > 0) {
      sell.disabled = true;
      clearTimeout(this._sellGuardTimer);
      this._sellGuardTimer = setTimeout(() => {
        const live = document.getElementById('btn-sell');
        if (live && this.view.selected === t) live.disabled = false;
      }, remaining);
    }
    sell.addEventListener('click', () => this.onAction('sell'));
    foot.appendChild(sell);
    wrap.appendChild(foot);

    return wrap;
  }

  // -- feedback ------------------------------------------------------------

  toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast-item ${kind}`;
    el.textContent = msg;
    $('#toast').appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 260);
    }, 1900);
  }

  banner(text, color) {
    const el = $('#banner');
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  // -- overlays ------------------------------------------------------------

  showOverlay(html) {
    $('#overlay-card').innerHTML = html;
    $('#overlay').classList.remove('hidden');
  }

  hideOverlay() {
    $('#overlay').classList.add('hidden');
  }

  showTitle(hasSave, records = {}, chosen = 'standard') {
    const diffs = DIFFICULTY_ORDER.map((id) => {
      const d = DIFFICULTIES[id];
      const rec = records[id];
      return `<button class="diff${id === chosen ? ' is-on' : ''}" data-diff="${id}">
        <div class="diff-name">${d.name}</div>
        <div class="diff-blurb">${d.blurb}</div>
        ${rec ? `<div class="diff-rec">Best: wave ${rec.wave}</div>` : ''}
      </button>`;
    }).join('');

    this.showOverlay(`
      <h1>LAST STAND</h1>
      <div class="sub">Maze-building zombie defense · endless</div>
      <div class="diff-row">${diffs}</div>
      <div class="promise">
        <b>The promise:</b> there is exactly <b>one breach</b>, on the west fence.
        Wave 1 comes through it. So does wave 100. The dead never get a second door —
        difficulty comes from what walks through, never from where.
      </div>
      <p>You are not given a road. <b>Your towers are the walls.</b> Everything you build
      reshapes the route the horde has to walk, so a good maze is worth more than a good gun.</p>
      <ul>
        <li><b>Build a maze.</b> Barricades cost $12 and exist purely to make the walk longer.</li>
        <li><b>You can never fully seal it</b> — the game blocks any placement that would, so you can't softlock yourself.</li>
        <li><b>Waves never start on their own</b> unless you switch on auto-start. Take all the time you want between them.</li>
        <li><b>Nothing you build can ever be damaged or destroyed.</b> Zombies only walk. Your investment is permanent.</li>
        <li><b>Eight towers, eight levels each</b>, with a specialisation branch at level 4.</li>
      </ul>
      <div class="overlay-actions">
        <button class="go" data-act="new">New Run</button>
        ${hasSave ? '<button data-act="continue">Continue Run</button>' : ''}
        <button data-act="help">Controls</button>
      </div>`);
  }

  showHelp() {
    this.showOverlay(`
      <h1>CONTROLS</h1>
      <div class="sub">All of it is mouse-driven; the keys just make it faster.</div>
      <ul>
        <li><kbd>1</kbd>–<kbd>8</kbd> pick a tower to build</li>
        <li><kbd>Click</kbd> place it, or click a placed tower to inspect it</li>
        <li><kbd>Click-drag</kbd> with Barricade selected to lay a whole run at once</li>
        <li><kbd>Right-click</kbd> / <kbd>Esc</kbd> cancel build mode</li>
        <li><kbd>Q</kbd> airstrike &nbsp; <kbd>W</kbd> rally flare &nbsp; <kbd>E</kbd> overcharge &nbsp; <kbd>R</kbd> cryo burst</li>
        <li><kbd>Enter</kbd> send the next wave &nbsp; <kbd>Space</kbd> pause</li>
        <li><kbd>S</kbd> cycle speed 1× → 2× → 3×</li>
        <li><kbd>U</kbd> upgrade selected &nbsp; <kbd>X</kbd> sell selected</li>
        <li><kbd>A</kbd> toggle auto-start</li>
      </ul>
      <div class="promise">
        Stuck on money? Cash banked at the end of a wave earns
        <b>${pct(this.game.balance.interestRate)} interest</b> (up to $${this.game.balance.interestCap}).
        Saving for one big upgrade genuinely beats dribbling it away.
      </div>
      <div class="overlay-actions"><button class="go" data-act="close">Back</button></div>`);
  }

  showMenu() {
    this.showOverlay(`
      <h1>PAUSED</h1>
      <div class="sub">Wave ${this.game.wave} · $${Math.floor(this.game.cash).toLocaleString()} banked</div>
      <div class="overlay-actions">
        <button class="go" data-act="close">Resume</button>
        <button data-act="save">Save Run</button>
        <button data-act="help">Controls</button>
        <button data-act="restart">Restart</button>
      </div>`);
  }

  showGameOver(record) {
    const s = this.game.stats;
    const best = this.game.towers.length
      ? [...this.game.towers].sort((a, b) => b.damageDealt - a.damageDealt)[0]
      : null;
    const diff = DIFFICULTIES[this.game.balance.difficulty]?.name ?? 'Standard';

    this.showOverlay(`
      <h1 style="color:var(--danger)">OVERRUN</h1>
      <div class="sub">The camp fell on wave ${this.game.wave} · ${diff}</div>
      ${record?.isBest
        ? `<div class="promise" style="border-left-color:var(--amber);color:#ffd98a">
             <b>New record.</b> ${record.cleared} waves cleared on ${diff}${record.previous ? ` — beat your old best of ${record.previous}` : ''}.
           </div>`
        : record?.previous
          ? `<div class="hint" style="margin-bottom:12px">Your best on ${diff} is still wave ${record.previous}.</div>`
          : ''}
      ${best ? `<div class="hint" style="margin-bottom:12px">Top earner: <b style="color:var(--toxic)">${towerTitle(best.defId, best.level, best.branch)}</b>
        — ${fmt(best.damageDealt)} damage, ${best.kills} kills.</div>` : ''}
      <div class="score-grid">
        <div class="score-item"><span>Waves survived</span><span>${Math.max(0, this.game.wave - 1)}</span></div>
        <div class="score-item"><span>Zombies killed</span><span>${s.kills.toLocaleString()}</span></div>
        <div class="score-item"><span>Leaked past you</span><span>${s.leaked}</span></div>
        <div class="score-item"><span>Scrap earned</span><span>$${Math.round(s.earned).toLocaleString()}</span></div>
        <div class="score-item"><span>Scrap spent</span><span>$${Math.round(s.spent).toLocaleString()}</span></div>
        <div class="score-item"><span>Towers standing</span><span>${this.game.towers.length}</span></div>
      </div>
      <div class="overlay-actions"><button class="go" data-act="new">New Run</button></div>`);
  }
}
