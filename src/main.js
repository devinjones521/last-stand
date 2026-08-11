// ---------------------------------------------------------------------------
// Bootstrap: canvas sizing, input, the frame loop, and wiring UI to Game.
// ---------------------------------------------------------------------------

import { CANVAS_W, CANVAS_H, GRID, COLORS, DIFFICULTIES, ABILITIES } from './config.js';
import { TOWER_ORDER } from './towers.js';
import { idx } from './pathfinding.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';

const canvas = document.getElementById('game');
const audio = new Audio();
const game = new Game(audio);

/** Shared view state: what the mouse is doing, what's selected. */
const view = {
  buildId: null,
  buildStats: null,
  selected: null,
  hover: null,
  hoverTower: null,
  placeCheck: null,
  previewRoute: null,
  aiming: null,   // id of a targeted ability waiting for a map click
};

/** Difficulty picked on the title screen; applied when a new run starts. */
let chosenDifficulty = 'standard';

const renderer = new Renderer(canvas, game);
const ui = new UI(game, view, audio);

// -- canvas sizing ----------------------------------------------------------

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(CANVAS_W * dpr);
  canvas.height = Math.round(CANVAS_H * dpr);
  renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderer.ctx.imageSmoothingEnabled = true;
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

// -- input ------------------------------------------------------------------

function cellFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * CANVAS_W;
  const y = ((ev.clientY - rect.top) / rect.height) * CANVAS_H;
  return { x: Math.floor(x / GRID.cell), y: Math.floor(y / GRID.cell) };
}

let dragging = false;
let lastDragCell = null;
let dragWarnedBroke = false;
let lastHoverKey = '';

function updateHover(cell) {
  view.hover = cell;
  const key = `${cell.x},${cell.y},${view.buildId}`;
  if (key === lastHoverKey) return;
  lastHoverKey = key;

  if (!view.buildId) {
    view.placeCheck = null;
    view.previewRoute = null;
    // Hovering any tower shows its reach, without having to select it first.
    view.hoverTower = game.inBounds(cell.x, cell.y)
      ? game.towerAt[idx(cell.x, cell.y)]
      : null;
    return;
  }
  view.hoverTower = null;
  view.placeCheck = game.canPlace(cell.x, cell.y, view.buildId);
  // Show how the maze would reroute — but only if the wall could actually go in.
  view.previewRoute = view.placeCheck.ok ? game.routeIfPlaced(cell.x, cell.y) : null;
}

// Pointer Events unify mouse, touch and pen, so the same code path serves a
// desktop drag and a finger swipe.
canvas.addEventListener('pointermove', (ev) => {
  const cell = cellFromEvent(ev);
  updateHover(cell);
  if (dragging && view.buildId === 'barricade') placeLine(lastDragCell, cell);
});

canvas.addEventListener('pointerleave', () => {
  view.hover = null;
  view.hoverTower = null;
  view.previewRoute = null;
  lastHoverKey = '';
});

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  ev.preventDefault();
  audio.init();
  // Keep receiving moves even if the finger/cursor slides off the canvas.
  canvas.setPointerCapture?.(ev.pointerId);
  const cell = cellFromEvent(ev);

  // A targeted ability is armed: this click is the target, not a build action.
  if (view.aiming) {
    fireAbility(view.aiming, cell);
    return;
  }

  if (view.buildId) {
    dragging = true;
    dragWarnedBroke = false;
    lastDragCell = cell;
    tryPlace(cell);
    return;
  }

  // Inspect mode: tap a tower to select it, tap empty ground to clear.
  const t = game.towerAt[idx(cell.x, cell.y)];
  if (t) { ui.selectTower(t); audio.play('ui'); } else { ui.clearSelection(); }
});

function endPointer(ev) {
  dragging = false;
  lastDragCell = null;
  // Touch has no hover state, so drop the ghost preview when the finger lifts.
  if (ev?.pointerType && ev.pointerType !== 'mouse') {
    view.hover = null;
    view.previewRoute = null;
    lastHoverKey = '';
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  ui.clearSelection();
  lastHoverKey = '';
});

/**
 * Place along the straight line between two cells. Mouse events only sample a
 * few points per drag, so without this a fast drag leaves gaps in your wall.
 */
function placeLine(from, to) {
  if (!from) { tryPlace(to); lastDragCell = to; return; }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i <= steps; i++) {
    tryPlace({
      x: Math.round(from.x + (dx * i) / steps),
      y: Math.round(from.y + (dy * i) / steps),
    });
  }
  lastDragCell = to;
}

function tryPlace(cell) {
  const res = game.place(cell.x, cell.y, view.buildId);
  if (!res.ok) {
    if (dragging) {
      // Constant denials mid-drag would be noise - but do say when funds run out.
      if (res.reason.startsWith('Need') && !dragWarnedBroke) {
        dragWarnedBroke = true;
        ui.toast('Out of scrap', 'bad');
        audio.play('deny');
      }
      return;
    }
    ui.toast(res.reason, 'bad');
    audio.play('deny');
    return;
  }
  lastHoverKey = '';
  updateHover(cell);
  ui.refresh(true);
}

// -- keyboard ---------------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  const k = ev.key.toLowerCase();

  if (k === 'escape') {
    if (!document.getElementById('overlay').classList.contains('hidden')) {
      if (game.phase !== 'over') closeOverlay();
    } else if (view.aiming) {
      view.aiming = null;
      ui.refresh(true);
    } else {
      ui.clearSelection();
      lastHoverKey = '';
    }
    return;
  }

  const ability = ABILITIES.find((a) => a.key === k);
  if (ability) { triggerAbility(ability.id); return; }

  if (ev.key >= '1' && ev.key <= '8') {
    const id = TOWER_ORDER[Number(ev.key) - 1];
    if (id) ui.selectBuild(id);
    return;
  }

  switch (k) {
    case ' ':
      ev.preventDefault();
      doAction('pause');
      break;
    case 'enter':
      doAction('start');
      break;
    case 's': {
      game.speed = game.speed >= 4 ? 1 : game.speed + 1;
      audio.play('ui');
      ui.refresh(true);
      break;
    }
    case 'a': {
      game.autoStart = !game.autoStart;
      document.getElementById('chk-auto').checked = game.autoStart;
      ui.toast(game.autoStart ? 'Auto-start on' : 'Auto-start off');
      break;
    }
    case 'u': doAction('upgrade'); break;
    case 'x': doAction('sell'); break;
    default: break;
  }
});

// -- actions ----------------------------------------------------------------

/** Resolve a commander ability, with feedback either way. */
function fireAbility(id, cell) {
  const res = game.useAbility(id, cell);
  view.aiming = null;
  if (res.ok) {
    ui.toast(`${res.def.name} away`, 'good');
  } else {
    ui.toast(res.reason, 'bad');
    audio.play('deny');
  }
  ui.refresh(true);
}

/**
 * Untargeted abilities fire immediately; targeted ones arm and wait for a map
 * click. Pressing the same one again disarms it.
 */
function triggerAbility(id) {
  const def = game.abilityDef(id);
  if (!def) return;

  if (game.abilityCooldownLeft(id) > 0) {
    ui.toast(`${def.name} recharging — ${Math.ceil(game.abilityCooldownLeft(id))}s`, 'bad');
    audio.play('deny');
    return;
  }
  if (!def.targeted) { fireAbility(id, null); return; }

  view.aiming = view.aiming === id ? null : id;
  view.buildId = null;
  view.previewRoute = null;
  if (view.aiming) ui.toast(`${def.name} — click a spot on the map`);
  ui.refresh(true);
}

function doAction(action, arg) {
  audio.init();
  switch (action) {
    case 'ability':
      triggerAbility(arg);
      return;
    case 'start': {
      if (game.phase === 'over') break;
      const res = game.startWave();
      if (res.ok) {
        const boss = res.script.flavour === 'boss';
        ui.banner(boss ? `WAVE ${game.wave} · BOSS` : `WAVE ${game.wave}`,
          boss ? COLORS.danger : COLORS.amber);
        ui.refresh(true);
      }
      break;
    }
    case 'pause':
      game.paused = !game.paused;
      ui.refresh(true);
      break;
    case 'repair': {
      const res = game.repair();
      if (res.ok) ui.toast('Camp reinforced', 'good');
      else { ui.toast(res.reason, 'bad'); audio.play('deny'); }
      ui.refresh(true);
      break;
    }
    case 'upgrade': {
      if (!view.selected) break;
      const res = game.upgrade(view.selected, arg);
      if (!res.ok) {
        ui.toast(res.reason, 'bad');
        if (res.reason !== 'Choose a specialisation') audio.play('deny');
      }
      ui.refresh(true);
      break;
    }
    case 'sell': {
      if (!view.selected) break;
      game.sell(view.selected);
      ui.clearSelection();
      break;
    }
    default: break;
  }
}
ui.onAction = doAction;

// -- overlays ---------------------------------------------------------------

function closeOverlay() {
  ui.hideOverlay();
  game.paused = false;
  ui.refresh(true);
}

document.getElementById('overlay-card').addEventListener('click', (ev) => {
  // Difficulty chips only change the pending selection; they start nothing.
  const diff = ev.target.closest('[data-diff]');
  if (diff) {
    chosenDifficulty = diff.dataset.diff;
    audio.init();
    audio.play('ui');
    ui.showTitle(!!Game.readSave(), Game.readRecords(), chosenDifficulty);
    return;
  }

  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  audio.init();
  audio.play('ui');

  switch (btn.dataset.act) {
    case 'new': {
      Game.clearSave();
      game.reset(chosenDifficulty);
      view.buildId = null; view.selected = null; view.previewRoute = null;
      document.getElementById('chk-auto').checked = false;
      closeOverlay();
      const name = DIFFICULTIES[chosenDifficulty].name;
      ui.toast(`New run · ${name} — build your maze, then send wave 1`, 'good');
      break;
    }
    case 'continue': {
      const data = Game.readSave();
      if (data && game.load(data)) {
        document.getElementById('chk-auto').checked = game.autoStart;
        closeOverlay();
        ui.toast(`Run restored at wave ${game.wave}`, 'good');
      } else {
        ui.toast('Save could not be read', 'bad');
      }
      break;
    }
    case 'save': {
      const saved = game.save();
      ui.toast(saved ? 'Run saved' : 'Could not save', saved ? 'good' : 'bad');
      break;
    }
    case 'help':
      ui.showHelp();
      break;
    case 'restart':
      game.reset();
      view.buildId = null; view.selected = null; view.previewRoute = null;
      closeOverlay();
      break;
    case 'title':
      Game.clearSave();
      ui.showTitle(false, Game.readRecords(), chosenDifficulty);
      break;
    case 'close':
      closeOverlay();
      break;
    default: break;
  }
});

// -- frame loop -------------------------------------------------------------

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let prevPhase = game.phase;
let prevWave = game.wave;

function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;

  const overlayOpen = !document.getElementById('overlay').classList.contains('hidden');
  if (!overlayOpen) {
    acc += real * game.speed;
    let steps = 0;
    while (acc >= STEP && steps < 60) {
      game.update(STEP);
      acc -= STEP;
      steps += 1;
    }
    if (steps >= 60) acc = 0; // fell behind; drop the backlog rather than spiral
  }

  // A wave just finished: bank the payout, save, and tell the player.
  if (prevPhase === 'wave' && game.phase === 'building') {
    const p = game.lastPayout;
    if (p) {
      ui.toast(`Wave ${p.wave} cleared — $${p.bonus} + $${p.interest} interest`, 'good');
    }
    ui.banner('HOLDING', COLORS.ok);
    game.save();
  }
  if (game.phase === 'over' && prevPhase !== 'over') {
    const record = game.recordRun();
    ui.showGameOver(record);
    Game.clearSave();
  }
  prevPhase = game.phase;

  if (game.wave !== prevWave) { prevWave = game.wave; ui.refresh(true); }

  // Selected tower may have been sold out from under the panel.
  if (view.selected && !game.towers.includes(view.selected)) ui.clearSelection();

  ui.refresh();
  renderer.draw(view, real);
  requestAnimationFrame(frame);
}

// -- go ---------------------------------------------------------------------

document.getElementById('btn-sound').classList.add('is-on');
ui.mount();
game.paused = true;
ui.showTitle(!!Game.readSave(), Game.readRecords(), chosenDifficulty);
requestAnimationFrame(frame);

// Offline support. Deliberately skipped on localhost so local edits are never
// shadowed by a stale cached bundle during development.
const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocal && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
  });
}

// Dev hook: poke at the running game from the browser console.
//   __game.cash = 99999      __game.speed = 3      __game.startWave()
window.__game = game;
window.__dev = { game, renderer, ui, view };

// Autosave on the way out.
window.addEventListener('beforeunload', () => {
  if (game.phase !== 'over' && game.wave > 0) game.save();
});
