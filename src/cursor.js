// ---------------------------------------------------------------------------
// Keyboard control of the board.
//
// Everything else in the game already had a key: pick a tower, send a wave,
// fire an ability, zoom. The one thing you could only do with a pointer was the
// central act of actually putting a tower somewhere - so the game was
// unplayable without a mouse or a touchscreen.
//
// The disambiguator is focus, the way the web already does it. When the canvas
// has focus, arrows move a cell cursor and Enter acts on that cell; when it
// doesn't, Enter still sends the next wave. No key had to be taken away, and
// nothing behaves differently for a player who never presses Tab.
// ---------------------------------------------------------------------------

import { GRID } from './config.js';
import { idx } from './pathfinding.js';
import { TOWER_DEFS, towerTitle } from './towers.js';

/** Clamp a cell to the board. */
export function clampCell(x, y) {
  return {
    x: Math.min(GRID.cols - 1, Math.max(0, x)),
    y: Math.min(GRID.rows - 1, Math.max(0, y)),
  };
}

/** Arrow-key movement, clamped. Holding shift jumps five cells. */
export function moveCursor(cur, dx, dy, big = false) {
  const step = big ? 5 : 1;
  return clampCell(cur.x + dx * step, cur.y + dy * step);
}

/**
 * What a screen reader should say about a cell. Announced on every cursor move,
 * so it leads with the contents rather than the coordinates - the position is
 * confirmation, not news.
 */
export function describeCell(game, x, y) {
  const where = `column ${x + 1}, row ${y + 1}`;
  if (!game.inBounds(x, y)) return `Off the board, ${where}`;

  if (x === game.spawn.x && y === game.spawn.y) return `The breach — where they come in. ${where}`;
  if (x === game.goal.x && y === game.goal.y) {
    return `Your camp, ${Math.max(0, Math.round(game.baseHp))} integrity. ${where}`;
  }

  const t = game.towerAt[idx(x, y)];
  if (t) {
    const def = TOWER_DEFS[t.defId];
    const name = towerTitle(t.defId, t.level, t.branch);
    const max = t.level >= def.maxLevel ? ', fully upgraded' : '';
    return `${name}, level ${t.level}${max}. ${where}`;
  }

  if (game.terrain[idx(x, y)]) return `Rubble — cannot be built on. ${where}`;

  const onRoute = game.route?.some((c) => c.x === x && c.y === y);
  return `Open ground${onRoute ? ', on the route' : ''}. ${where}`;
}

/**
 * What Enter should do here, given what the player is holding. Returned as a
 * verb rather than performed, so main.js keeps ownership of the side effects.
 */
export function actionForCell(view, game, cell) {
  if (view.aiming) return 'ability';
  if (view.buildId) return 'place';
  return game.towerAt[idx(cell.x, cell.y)] ? 'select' : 'clear';
}
