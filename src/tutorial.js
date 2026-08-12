// ---------------------------------------------------------------------------
// First-run coaching.
//
// The one idea a new player has to get is that the towers ARE the walls - that
// you're drawing the route, not decorating one. A wall of text on the title
// screen says that and nobody reads it, so this says it one line at a time and
// waits for the player to actually do the thing before moving on.
//
// Every step is a predicate over real game state, never a scripted click path.
// That means there is no "wrong" move and nothing to get stuck behind: players
// who wander off and build their own maze satisfy the steps anyway, and any
// step already satisfied when it comes up is skipped rather than nagged about.
// ---------------------------------------------------------------------------

const SEEN_KEY = 'laststand.coached.v1';

const walls = (game) => game.towers.filter((t) => t.stats.inert).length;
const guns = (game) => game.towers.filter((t) => !t.stats.inert).length;

/**
 * `done` is checked every frame; the first one that passes advances the step.
 * `target` is a selector to highlight, and is allowed to match nothing.
 */
export const STEPS = [
  {
    id: 'pick',
    title: 'Pick up a barricade',
    body: 'Barricades cost $12 and do nothing but stand in the way. They are how you draw the route.',
    target: '.bt[data-id="barricade"]',
    done: (g, v) => v.buildId === 'barricade' || walls(g) > 0,
  },
  {
    id: 'wall',
    title: 'Drag out a wall',
    body: 'Hold and drag to lay a whole run at once. The dashed green line shows where the horde would walk — make that walk long.',
    target: null,
    done: (g) => walls(g) >= 6,
  },
  {
    id: 'gun',
    title: 'Now something that shoots',
    body: 'Put a gun where the route doubles back on itself, so it covers the same zombies twice.',
    target: '.bt[data-id="mg"]',
    done: (g) => guns(g) >= 1,
  },
  {
    id: 'send',
    title: 'Send wave 1 when you are ready',
    body: 'Nothing starts without you. You can take an hour between waves — the game will wait.',
    target: '#btn-start',
    done: (g) => g.phase === 'wave' || g.wave >= 1,
  },
  {
    id: 'ability',
    title: 'Your abilities are free',
    body: 'They cost time, not scrap, so they never compete with building. Airstrike is Q — or tap AIR.',
    target: '#abilities',
    done: (g) => Object.values(g.abilityReadyAt).some((t) => t > 0),
  },
  {
    id: 'upgrade',
    title: 'Click a tower to upgrade it',
    body: 'Eight levels each. Level 4 forces a permanent specialisation that changes how the tower works, not just its numbers.',
    target: null,
    done: (g) => g.towers.some((t) => t.level > 1),
  },
];

export class Tutorial {
  constructor(game, view, onChange) {
    this.game = game;
    this.view = view;
    this.onChange = onChange ?? (() => {});
    this.step = -1;      // -1 = not running
    this.finished = false;
  }

  get active() { return this.step >= 0 && this.step < STEPS.length; }
  get current() { return this.active ? STEPS[this.step] : null; }

  static seen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
  }

  static markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode; just re-offer it */ }
  }

  /** Begin at the first step the player hasn't already satisfied. */
  start() {
    this.finished = false;
    this.step = 0;
    this.skipSatisfied();
    if (this.active) this.onChange();
  }

  stop(complete) {
    this.step = -1;
    this.finished = !!complete;
    if (complete) Tutorial.markSeen();
    this.onChange();
  }

  /** Don't ask for something that's already true — jump past it silently. */
  skipSatisfied() {
    while (this.active && STEPS[this.step].done(this.game, this.view)) this.step += 1;
    if (!this.active) this.stop(true);
  }

  /** Called once per frame. Cheap: one predicate. */
  update() {
    if (!this.active) return;
    if (!STEPS[this.step].done(this.game, this.view)) return;
    this.step += 1;
    this.skipSatisfied();
    if (this.active) this.onChange();
  }
}
