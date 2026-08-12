// ---------------------------------------------------------------------------
// The maps.
//
// The design promise is one breach, forever - and it holds on every map here.
// What changes between them is WHERE that single breach sits and what stands
// between it and your camp, which is enough to make the maze problem feel new
// without ever handing the horde a second door.
//
// Terrain is permanent: unbuildable, unwalkable. It exists to seed interesting
// maze shapes without over-constraining the player, so every map deliberately
// leaves the middle of the field open for you to fill.
// ---------------------------------------------------------------------------

import { GRID } from './config.js';

/**
 * kind is what the renderer draws: 'rubble' (grey concrete), 'wreck' (burnt
 * vehicle) or 'barrel' (single cell). w/h are in cells.
 */
export const MAPS = {
  yard: {
    id: 'yard',
    name: 'The Yard',
    blurb: 'Open ground, west to east. The original — nothing to hide behind and nothing in your way.',
    spawn: { x: 0, y: 10 },
    goal: { x: GRID.cols - 1, y: 10 },
    obstacles: [
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
    ],
  },

  coldstorage: {
    id: 'coldstorage',
    name: 'Cold Storage',
    blurb: 'They come in over the north fence. Freezer rows already channel the walk — build with them, not against them.',
    spawn: { x: 15, y: 0 },
    goal: { x: 28, y: 18 },
    obstacles: [
      // Freezer rows: long verticals that pre-shape the field into corridors.
      { x: 6, y: 3, w: 1, h: 6, kind: 'rubble' },
      { x: 10, y: 6, w: 1, h: 7, kind: 'rubble' },
      { x: 13, y: 3, w: 1, h: 5, kind: 'rubble' },
      { x: 19, y: 2, w: 1, h: 6, kind: 'rubble' },
      { x: 23, y: 8, w: 1, h: 6, kind: 'rubble' },
      { x: 4, y: 12, w: 4, h: 1, kind: 'wreck' },
      { x: 12, y: 15, w: 5, h: 1, kind: 'wreck' },
      { x: 25, y: 4, w: 3, h: 1, kind: 'wreck' },
      { x: 8, y: 16, w: 1, h: 1, kind: 'barrel' },
      { x: 18, y: 12, w: 1, h: 1, kind: 'barrel' },
      { x: 27, y: 10, w: 1, h: 1, kind: 'barrel' },
    ],
  },

  overpass: {
    id: 'overpass',
    name: 'The Overpass',
    blurb: 'Corner to corner, the longest natural walk on any map. A collapsed span cuts the field on the diagonal.',
    spawn: { x: 0, y: 1 },
    goal: { x: GRID.cols - 1, y: 18 },
    obstacles: [
      // The fallen span, stepping up across the middle of the board.
      { x: 5, y: 15, w: 2, h: 2, kind: 'wreck' },
      { x: 9, y: 12, w: 2, h: 2, kind: 'wreck' },
      { x: 13, y: 9, w: 2, h: 2, kind: 'wreck' },
      { x: 17, y: 6, w: 2, h: 2, kind: 'wreck' },
      { x: 21, y: 3, w: 2, h: 2, kind: 'wreck' },
      { x: 25, y: 1, w: 2, h: 2, kind: 'rubble' },
      { x: 3, y: 6, w: 3, h: 1, kind: 'rubble' },
      { x: 27, y: 12, w: 1, h: 4, kind: 'rubble' },
      { x: 8, y: 3, w: 2, h: 1, kind: 'rubble' },
      { x: 11, y: 17, w: 1, h: 1, kind: 'barrel' },
      { x: 20, y: 11, w: 1, h: 1, kind: 'barrel' },
      { x: 24, y: 16, w: 1, h: 1, kind: 'barrel' },
    ],
  },

  reservoir: {
    id: 'reservoir',
    name: 'The Reservoir',
    blurb: 'East to west, against the grain, around a dry tank you cannot build on. Reads backwards until it does not.',
    spawn: { x: GRID.cols - 1, y: 4 },
    goal: { x: 0, y: 15 },
    obstacles: [
      // The tank: one big landmark you have to commit to going around.
      { x: 13, y: 7, w: 5, h: 4, kind: 'rubble' },
      { x: 8, y: 3, w: 2, h: 3, kind: 'rubble' },
      { x: 22, y: 12, w: 3, h: 2, kind: 'wreck' },
      { x: 5, y: 9, w: 1, h: 5, kind: 'rubble' },
      { x: 24, y: 5, w: 1, h: 4, kind: 'rubble' },
      { x: 9, y: 16, w: 4, h: 1, kind: 'wreck' },
      { x: 18, y: 16, w: 1, h: 3, kind: 'rubble' },
      { x: 20, y: 8, w: 1, h: 1, kind: 'barrel' },
      { x: 7, y: 18, w: 1, h: 1, kind: 'barrel' },
      { x: 28, y: 15, w: 1, h: 1, kind: 'barrel' },
    ],
  },
};

export const MAP_ORDER = ['yard', 'coldstorage', 'overpass', 'reservoir'];

/** Resolve a map id, falling back to the original rather than throwing. */
export function mapFor(id) {
  return MAPS[id] ?? MAPS.yard;
}
