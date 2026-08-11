// ---------------------------------------------------------------------------
// Flow-field pathfinding.
//
// Instead of running A* per zombie, we BFS outward from the camp once whenever
// the maze changes. That gives every walkable cell its distance-to-camp, and a
// zombie just walks downhill. Benefits:
//   - repathing 130 zombies after you drop a wall is free
//   - "is this placement legal?" is just "is the spawn still reachable?"
//   - drawing the current route is just walking downhill from the spawn
// ---------------------------------------------------------------------------

import { GRID } from './config.js';

const { cols, rows } = GRID;
export const CELL_COUNT = cols * rows;

export const idx = (x, y) => y * cols + x;
export const cellX = (i) => i % cols;
export const cellY = (i) => (i / cols) | 0;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;

// Scratch queue reused across calls so validation doesn't allocate.
const queue = new Int32Array(CELL_COUNT);

/**
 * BFS distance from the goal across every non-blocked cell.
 * @param {Uint8Array} blocked  1 = impassable
 * @param {number} goalX @param {number} goalY
 * @param {Int32Array} [out] reusable output buffer
 * @returns {Int32Array} distance per cell, -1 where unreachable
 */
export function computeField(blocked, goalX, goalY, out) {
  const field = out ?? new Int32Array(CELL_COUNT);
  field.fill(-1);

  const goal = idx(goalX, goalY);
  if (blocked[goal]) return field; // camp itself walled in - shouldn't happen

  let head = 0;
  let tail = 0;
  field[goal] = 0;
  queue[tail++] = goal;

  while (head < tail) {
    const c = queue[head++];
    const x = c % cols;
    const d = field[c] + 1;

    if (x > 0) {
      const n = c - 1;
      if (field[n] === -1 && !blocked[n]) { field[n] = d; queue[tail++] = n; }
    }
    if (x < cols - 1) {
      const n = c + 1;
      if (field[n] === -1 && !blocked[n]) { field[n] = d; queue[tail++] = n; }
    }
    if (c >= cols) {
      const n = c - cols;
      if (field[n] === -1 && !blocked[n]) { field[n] = d; queue[tail++] = n; }
    }
    if (c < CELL_COUNT - cols) {
      const n = c + cols;
      if (field[n] === -1 && !blocked[n]) { field[n] = d; queue[tail++] = n; }
    }
  }
  return field;
}

// Neighbour probe order, biased so ties break toward horizontal travel. Keeps
// the horde's route stable and readable instead of shimmering between equals.
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * The next cell a unit at (x,y) should walk to. Returns null at the goal or
 * when stranded.
 * @param {Int32Array} field
 * @param {number} preferDx @param {number} preferDy last direction travelled;
 *        continuing straight wins ties, so zombies don't jitter at junctions.
 */
export function nextStep(field, x, y, preferDx = 0, preferDy = 0) {
  const here = field[idx(x, y)];
  if (here <= 0) return null;

  let best = null;
  let bestDist = here;
  let bestStraight = false;

  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const d = field[idx(nx, ny)];
    if (d === -1 || d >= here) continue;

    const straight = dx === preferDx && dy === preferDy;
    if (d < bestDist || (d === bestDist && straight && !bestStraight)) {
      best = { x: nx, y: ny, dx, dy };
      bestDist = d;
      bestStraight = straight;
    }
  }
  return best;
}

/**
 * Walk downhill from the spawn to trace the route the horde will actually take.
 * Used to draw the route preview. Returns [] if there's no route.
 */
export function traceRoute(field, startX, startY) {
  if (field[idx(startX, startY)] === -1) return [];
  const route = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;
  let dx = 0;
  let dy = 0;
  // The field distance strictly decreases each step, so this always terminates.
  for (let guard = 0; guard < CELL_COUNT; guard++) {
    const step = nextStep(field, x, y, dx, dy);
    if (!step) break;
    route.push({ x: step.x, y: step.y });
    x = step.x; y = step.y; dx = step.dx; dy = step.dy;
  }
  return route;
}
