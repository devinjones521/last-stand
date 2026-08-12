// ---------------------------------------------------------------------------
// Bootstrap: canvas sizing, input, the frame loop, and wiring UI to Game.
// ---------------------------------------------------------------------------

import { CANVAS_W, CANVAS_H, COLORS, DIFFICULTIES, ABILITIES } from './config.js';
import { TOWER_ORDER } from './towers.js';
import { idx } from './pathfinding.js';
import { Game } from './game.js';
import { buyNode, researchMods } from './research.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { Viewport, MIN_SCALE, MAX_SCALE } from './viewport.js';
import { Tutorial, STEPS } from './tutorial.js';

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
  viewport: new Viewport(),
};

/** Difficulty and map picked on the title screen; applied when a run starts. */
let chosenDifficulty = 'standard';
let chosenMap = 'yard';
/** Whether the research screen was opened from game-over (changes its exit). */
let researchFromGameOver = false;

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

const vp = view.viewport;

function cellFromEvent(ev) {
  return vp.toCell(ev.clientX, ev.clientY, canvas.getBoundingClientRect());
}

let dragging = false;
let lastDragCell = null;
let dragWarnedBroke = false;
let lastHoverKey = '';

// -- camera -----------------------------------------------------------------
// Zoom exists because a 32-column board on a phone puts a cell at ~12px, which
// is half a fingertip. Two fingers pinch and pan; with nothing being built, one
// finger drags the board too. On a mouse it's the wheel, or a middle-drag.

/** Live pointers by id, so a second finger can be recognised as a pinch. */
const pointers = new Map();
let pinch = null;        // { dist, cx, cy } from the last pinch frame
let panning = null;      // { x, y } last client position of a pan drag
let panCandidate = null; // a press that will become a pan if it travels far enough
let suppressTap = false; // a gesture happened; don't also treat the lift as a tap

function clientOf(ev) { return { x: ev.clientX, y: ev.clientY }; }

function pinchState() {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}

function beginPinch() {
  // A pinch cancels whatever the first finger was doing — but anything already
  // built stays built. Placement is never undone behind the player's back.
  dragging = false;
  lastDragCell = null;
  panning = null;
  panCandidate = null;
  suppressTap = true;
  view.hover = null;
  view.previewRoute = null;
  lastHoverKey = '';
  pinch = pinchState();
}

function updatePinch() {
  const now = pinchState();
  const rect = canvas.getBoundingClientRect();

  // Zoom about the midpoint between the fingers, then move that midpoint with
  // them, so the ground stays stuck to the fingers doing both at once.
  if (pinch.dist > 8 && now.dist > 8) {
    const anchor = vp.toWorld(now.cx, now.cy, rect);
    vp.zoomBy(now.dist / pinch.dist, anchor.x, anchor.y);
  }
  const d = vp.screenToWorldDelta(now.cx - pinch.cx, now.cy - pinch.cy, rect);
  vp.panBy(-d.x, -d.y);

  pinch = now;
  syncZoomUi();
}

function panTo(ev) {
  const rect = canvas.getBoundingClientRect();
  const d = vp.screenToWorldDelta(ev.clientX - panning.x, ev.clientY - panning.y, rect);
  vp.panBy(-d.x, -d.y);
  panning = clientOf(ev);
}

/** Zoom controls sit on the stage; the reset only appears once it does something. */
const zoomBox = document.getElementById('zoom');
function syncZoomUi() {
  if (!zoomBox) return;
  zoomBox.classList.toggle('is-zoomed', vp.zoomed);
  zoomBox.querySelector('[data-zoom="in"]').disabled = vp.scale >= MAX_SCALE - 1e-4;
  zoomBox.querySelector('[data-zoom="out"]').disabled = vp.scale <= MIN_SCALE + 1e-4;
  zoomBox.querySelector('.zoom-level').textContent = `${vp.scale.toFixed(1)}×`;
}

zoomBox?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-zoom]');
  if (!btn) return;
  audio.init();
  audio.play('ui');
  if (btn.dataset.zoom === 'in') vp.step(1.5);
  else if (btn.dataset.zoom === 'out') vp.step(1 / 1.5);
  else vp.reset();
  syncZoomUi();
});

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const p = vp.toWorld(ev.clientX, ev.clientY, canvas.getBoundingClientRect());
  // Trackpads report small deltas and mice one big one; normalise to a step.
  vp.zoomBy(ev.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y);
  lastHoverKey = '';
  updateHover(cellFromEvent(ev));
  syncZoomUi();
}, { passive: false });

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
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, clientOf(ev));

  if (pinch && pointers.size >= 2) { updatePinch(); return; }
  if (panning) { panTo(ev); return; }

  // A press with nothing selected becomes a pan once it clearly travels, so a
  // tap still selects. Only when zoomed — at 1x there is nowhere to pan to and
  // suppressing the tap would just feel broken.
  if (panCandidate) {
    const far = Math.hypot(ev.clientX - panCandidate.x, ev.clientY - panCandidate.y) > 7;
    if (far && vp.zoomed) {
      panning = clientOf(ev);
      panCandidate = null;
      suppressTap = true;
      return;
    }
  }

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
  if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
  ev.preventDefault();
  audio.init();
  // Keep receiving moves even if the finger/cursor slides off the canvas.
  canvas.setPointerCapture?.(ev.pointerId);
  pointers.set(ev.pointerId, clientOf(ev));

  if (pointers.size === 2) { beginPinch(); return; }
  if (pointers.size > 2) return;

  // Middle-drag pans on a mouse, at any zoom, whatever else is going on.
  if (ev.pointerType === 'mouse' && ev.button === 1) {
    panning = clientOf(ev);
    suppressTap = true;
    return;
  }

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

  // Inspect mode. Resolved on release, so the same press can turn into a pan.
  panCandidate = { ...clientOf(ev), cell };
  suppressTap = false;
});

function endPointer(ev) {
  if (ev) pointers.delete(ev.pointerId);

  // Inspect mode: tap a tower to select it, tap empty ground to clear.
  if (panCandidate && !suppressTap) {
    const { x, y } = panCandidate.cell;
    const t = game.inBounds(x, y) ? game.towerAt[idx(x, y)] : null;
    if (t) { ui.selectTower(t); audio.play('ui'); } else { ui.clearSelection(); }
  }
  panCandidate = null;
  panning = null;
  dragging = false;
  lastDragCell = null;

  // Lifting one finger out of a pinch must not hand the other one a drag: wait
  // until the screen is clear again.
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) suppressTap = false;

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

  // Zoom keys sit outside the switch below so `-` and `=` keep their literal
  // meaning rather than being read as tower digits.
  if (k === '+' || k === '=') { vp.step(1.5); syncZoomUi(); return; }
  if (k === '-' || k === '_') { vp.step(1 / 1.5); syncZoomUi(); return; }
  if (k === '0') { vp.reset(); syncZoomUi(); return; }

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

// -- first-run coaching -----------------------------------------------------

const coachEl = document.getElementById('coach');
let coachTarget = null;

const tutorial = new Tutorial(game, view, renderCoach);

/** Paint the current step, and pulse whatever UI it's talking about. */
function renderCoach() {
  coachTarget?.classList.remove('coach-target');
  coachTarget = null;

  const step = tutorial.current;
  if (!step) {
    coachEl.classList.add('hidden');
    return;
  }

  document.getElementById('coach-step').textContent = `${tutorial.step + 1}/${STEPS.length}`;
  document.getElementById('coach-title').textContent = step.title;
  document.getElementById('coach-body').textContent = step.body;
  document.getElementById('coach-fill').style.width = `${(tutorial.step / STEPS.length) * 100}%`;
  coachEl.classList.remove('hidden');

  if (step.target) {
    coachTarget = document.querySelector(step.target);
    coachTarget?.classList.add('coach-target');
  }
}

document.getElementById('coach-skip').addEventListener('click', () => {
  audio.play('ui');
  tutorial.stop(true);           // dismissing counts as done; never nag again
  ui.toast('Walkthrough dismissed — it lives under Controls');
});

// -- overlays ---------------------------------------------------------------

function closeOverlay() {
  ui.hideOverlay();
  game.paused = false;
  ui.refresh(true);
}

document.getElementById('overlay-card').addEventListener('click', (ev) => {
  // Difficulty and map chips only change the pending selection; they start
  // nothing. Re-rendering the title swaps the best-run figures on both rows,
  // since a record belongs to a map and a difficulty together.
  const diff = ev.target.closest('[data-diff]');
  const map = ev.target.closest('[data-map]');
  if (diff || map) {
    if (map) chosenMap = map.dataset.map;
    else chosenDifficulty = diff.dataset.diff;
    audio.init();
    audio.play('ui');
    ui.showTitle(!!Game.readSave(), Game.readRecords(), chosenDifficulty, chosenMap);
    return;
  }

  // Buying research re-renders the screen in place so you can spend a run's
  // intel across several nodes without bouncing in and out.
  const buy = ev.target.closest('[data-research]');
  if (buy) {
    audio.init();
    const res = buyNode(game.research, buy.dataset.research);
    if (res.ok) {
      game.mods = researchMods(game.research);
      audio.play('upgrade');
    } else {
      audio.play('deny');
    }
    ui.showResearch(researchFromGameOver);
    return;
  }

  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  audio.init();
  audio.play('ui');

  switch (btn.dataset.act) {
    case 'new': {
      Game.clearSave();
      game.reset(chosenDifficulty, chosenMap);
      view.buildId = null; view.selected = null; view.previewRoute = null;
      vp.reset(); syncZoomUi();
      document.getElementById('chk-auto').checked = false;
      closeOverlay();
      const name = DIFFICULTIES[chosenDifficulty].name;
      ui.toast(`${game.map.name} · ${name} — build your maze, then send wave 1`, 'good');
      // First run ever: coach it. After that the player has seen it and the
      // walkthrough stays available under Controls.
      if (!Tutorial.seen()) tutorial.start();
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
    case 'walkthrough':
      // Replaying it mid-run is fine: any step already satisfied is skipped,
      // so an established board just picks up wherever it actually is.
      tutorial.start();
      closeOverlay();
      break;
    case 'research':
      researchFromGameOver = false;
      ui.showResearch(false);
      break;
    case 'research-over':
      researchFromGameOver = true;
      ui.showResearch(true);
      break;
    case 'close-research':
      ui.showTitle(!!Game.readSave(), Game.readRecords(), chosenDifficulty, chosenMap);
      break;
    case 'restart':
      game.reset();
      view.buildId = null; view.selected = null; view.previewRoute = null;
      vp.reset(); syncZoomUi();
      // The board is gone, so the steps it was measuring are gone with it.
      tutorial.stop(false);
      closeOverlay();
      break;
    case 'title':
      Game.clearSave();
      tutorial.stop(false);
      ui.showTitle(false, Game.readRecords(), chosenDifficulty, chosenMap);
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
    const intel = game.bankIntel();
    ui.showGameOver(record, intel);
    Game.clearSave();
  }
  prevPhase = game.phase;

  if (game.wave !== prevWave) { prevWave = game.wave; ui.refresh(true); }

  // Coaching advances off real game state, so it has to be checked, not fired
  // from the handlers that would each have to remember to do it.
  if (tutorial.active) {
    tutorial.update();
    if (!tutorial.active) {
      renderCoach();
      ui.toast('That is the whole game. One breach, forever.', 'good');
    }
  }

  // Selected tower may have been sold out from under the panel.
  if (view.selected && !game.towers.includes(view.selected)) ui.clearSelection();

  ui.refresh();
  renderer.draw(view, real);
  requestAnimationFrame(frame);
}

// -- go ---------------------------------------------------------------------

document.getElementById('btn-sound').classList.add('is-on');
syncZoomUi();
ui.mount();
game.paused = true;
ui.showTitle(!!Game.readSave(), Game.readRecords(), chosenDifficulty, chosenMap);
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
window.__dev = { game, renderer, ui, view, tutorial, viewport: vp };

// Autosave on the way out.
window.addEventListener('beforeunload', () => {
  if (game.phase !== 'over' && game.wave > 0) game.save();
});
