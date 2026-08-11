# LAST STAND

A maze-building zombie tower defense. Endless waves, deep upgrade trees, and
**exactly one spawn point — forever.**

### ▶ Play: <https://devinjones521.github.io/last-stand/>

On Android or iOS, open that link and choose **Add to Home Screen** — it installs
as a fullscreen app and works with no connection at all.

## Run it locally

```bash
npm start     # http://localhost:8080
npm test      # headless simulation suite
npm run icons # regenerate app icons
```

No dependencies and no build step. The server is a ~40-line static file server;
it only exists because ES modules can't load over `file://`. The service worker
is deliberately **not** registered on localhost, so local edits are never
shadowed by a stale cache.

---

## The design promise

This game was built around one specific complaint: tower defense games get
frustrating when they start opening extra spawn points as the difficulty ramps.

So it never does. There is **one breach**, on the west fence. Wave 1 comes
through it. So does wave 100. Difficulty scales through what walks through the
gap — tougher bodies, nastier archetypes, tighter spacing — and never through
where it comes from.

Three more rules follow from the same idea:

- **Nothing you build can be damaged or destroyed.** No zombie in the game
  attacks a tower. Every enemy ability makes the horde harder to *kill*, never
  harder to *build*. Your investment is permanent.
- **Waves never start on their own** unless you tick auto-start. Take an hour
  between waves if you want.
- **You can never seal yourself in.** Any placement that would fully block the
  route is refused, with the reason shown on the map. You cannot softlock.

---

## How it plays

You get an open field, not a road. **Your towers are the walls.** Every building
reshapes the path the horde has to walk, so the shape of your maze matters more
than any single gun.

Barricades cost $12 and do nothing but stand in the way — click-drag to lay a
whole run at once. While you're holding a tower, a dashed green line previews
the new route *before* you spend anything.

Cash banked at the end of a wave earns 5% interest (capped at $150), so saving
for one big upgrade genuinely beats dribbling it into chaff.

### Difficulty

Picked per run on the title screen. The whole curve moves together — enemy HP,
your income, and how much camp you can afford to lose.

| | HP curve | Start | Camp | Same build reaches* |
|---|---|---|---|---|
| **Relaxed** | `1.062^w` | $450 | 150 | wave 53 |
| **Standard** | `1.075^w` | $300 | 100 | wave 39 |
| **Brutal** | `1.088^w` | $250 | 80 | wave 21 |

\* measured by the test suite running one identical maze + gun line on each
setting, reinvesting all income between waves. Your best run is recorded per
difficulty.

### Controls

| Key | Action |
|---|---|
| `1`–`8` | Pick a tower to build |
| Click | Place it, or click a placed tower to inspect |
| Click-drag | Lay a run of barricades |
| Right-click / `Esc` | Cancel build mode |
| `Enter` | Send the next wave |
| `Space` | Pause |
| `S` | Cycle speed 1× → 2× → 3× → 4× |
| `U` / `X` | Upgrade / sell the selected tower |
| `A` | Toggle auto-start |

---

## Towers

Eight towers, eight levels each. Levels 1–3 follow the tower's base curve;
buying level 4 forces a permanent **specialisation choice** that changes both
the stats and the mechanics for levels 4–8.

| Tower | Cost | Role | Specialisations |
|---|---|---|---|
| Barricade | $12 | Pure wall (3 levels) | — razor wire, then electrified |
| MG Nest | $80 | High volume, low damage | **Gatling** (spins up to +190% fire rate) / **Shredder** (pierces through ranks) |
| Marksman Post | $150 | Slow, huge single hits | **Anti-Materiel** (ignores armour entirely) / **Headhunter** (crits + executes) |
| Flame Vent | $120 | Short cone, burn DoT | **Napalm** (leaves burning ground) / **Incinerator** (stacking burn vs. big HP) |
| Cryo Sprayer | $170 | Radius slow | **Deep Freeze** (freezes solid) / **Frostbite** (chilled enemies take more damage from everything) |
| Acid Sprayer | $200 | Armour shred | **Dissolver** (huge stacking shred) / **Caustic Cloud** (lingering pools) |
| Tesla Coil | $260 | Chain lightning | **Arc Storm** (many long jumps) / **Overcharge** (one huge stunning zap) |
| Mortar Pit | $300 | Long-range splash | **Cluster** (bomblet spread) / **Bunker Buster** (permanently destroys armour) |

Damage types matter: **physical** and **explosive** are blunted by armour,
**energy** only counts half of it, and **fire** and **acid** ignore armour
completely (which is also what shuts off a Regenerator's healing).

Each tower has a targeting priority — First, Last, Strongest, Weakest, Nearest.
"First" and "Last" are exact, not approximate: they read straight off the flow
field's distance-to-camp.

## Zombies

| Enemy | From | What makes it annoying |
|---|---|---|
| Walker | 1 | Baseline |
| Runner | 3 | Fast, fragile |
| Crawler | 5 | Very fast, swarms |
| Brute | 7 | Heavy armour |
| Hazmat | 9 | Immune to all burn and acid DoT |
| Screamer | 11 | Buffs nearby zombies' speed and resistance |
| Regenerator | 13 | Heals constantly unless burning or corroded |
| Bloater | 15 | Death cloud armours everything nearby |
| Husk | 18 | Cannot be slowed, chilled or frozen |
| Juggernaut | every 10 | Boss. Massive HP, immune to stun and freeze |

Waves are **deterministic** — wave 37 has the same composition every run, so you
can learn a run and plan for it.

---

## Code layout

```
index.html            shell
server.js             zero-dependency static server
manifest.webmanifest  PWA metadata
sw.js                 service worker (offline)
fonts/                self-hosted woff2 — no CDN, works offline
icons/                generated PNG app icons
tools/
  generate-icons.mjs  draws the icons (hand-rolled PNG encoder, no deps)
  sim-test.mjs        headless simulation suite — npm test
src/
  config.js         ALL balance numbers, difficulties, colours, map layout
  towers.js         tower defs + upgrade/branch trees
  enemies.js        enemy defs + per-wave scaling
  waves.js          deterministic wave generation
  pathfinding.js    flow-field BFS (see below)
  game.js           simulation: state and rules, no drawing
  render.js         all canvas drawing, no state mutation
  ui.js             DOM sidebar, panels, overlays
  audio.js          synthesised SFX (no asset files)
  main.js           input, frame loop, wiring
  styles.css        design tokens + the whole interface
```

### Testing

`npm test` runs the real `Game` class headlessly in Node — no DOM, no browser.
It covers the seal rule, maze rerouting, full combat, every tower maxed, both
branches of each, damage attribution, deterministic waves, the difficulty
spread, and save/load (including migrating v1 saves). A 40-wave run simulates in
well under a second, which is also the performance check.

### Visual identity

Field-expedient military and quarantine signage: stencilled crates, hazard tape,
olive-drab kit. Signal amber (`#e8912a`) is the single accent; olive-drab and
oxide red carry "holding" and "danger" so semantic colour never competes with
it. Squared 2px corners and hairline rules instead of floating rounded cards.
Type is Big Shoulders Display (stencil/display), Barlow (body), and IBM Plex
Mono (every numeral, tabular) — all self-hosted under the OFL.

It commits to a single dark theme on purpose; there is no light mode, and every
colour is painted explicitly so nothing borrows a host background.

### How the battlefield is drawn

Four layers composite each frame, all plain Canvas 2D:

1. **Terrain** — baked once at device resolution into an offscreen canvas.
2. **Decals** — a second offscreen canvas that is only ever *added* to. Blood
   pools, mortar scorch and the track the horde wears into the dirt accumulate
   there permanently, so a wave-40 battlefield looks nothing like a fresh one.
   The sim pushes marks onto `game.decals`; the renderer drains that queue.
3. **The world** — route, towers, then zombies depth-sorted by `y`.
4. **Lighting** — darkness is filled over everything, then punched back out
   with `destination-out` around each light (camp floodlights, the breach,
   engaged towers, fires, muzzle flashes), followed by an additive warm bloom.
   Lights use one cached radial sprite rather than per-frame gradients.

Night is kept at only 38% opacity on purpose: a tower defense has to stay
readable across the whole board, so legibility beats mood.

Zombies share a single draw routine parameterised per archetype (`BODY` in
`render.js` — torso width, head size, reach, stride speed, lean, plus flags like
`legless`, `visor`, `maw`, `plates`). One renderer, ten distinct silhouettes.

Static tower art (emplacements, sandbags, level pips, barricades) is baked into
its own layer and only re-drawn when the tower set actually changes, tracked via
`game.buildVersion`. Each frame then costs one `drawImage` plus the rotating
turrets. Redrawing it live was ~20 fill operations per tower per frame.

Whole-frame cost with 60+ towers and a live wave is about **1.7ms**, against a
16.7ms budget. A pathological 459-tower board — every buildable cell filled —
runs at **5.3ms** (~188fps); before the tower-art bake it was 22.7ms (~41fps).

### Why a flow field instead of A*

Rather than pathing each zombie individually, a single BFS runs outward from the
camp whenever the maze changes, giving every walkable cell its distance-to-camp.
Zombies just walk downhill. That makes three things fall out for free:

- repathing 130 zombies after you drop a wall costs nothing
- "would this placement seal the route?" is just "is the spawn still reachable?"
- drawing the route preview is just walking downhill from the spawn

### Tuning

Everything balance-related is in `src/config.js` — the HP curve
(`hpLinear` / `hpExpo`), payouts, interest, wave budget, the enemy body cap.
Tower numbers are in `src/towers.js`.

For reference, the HP curve is
`(1 + 0.10·(w−1)) · 1.075^(w−1)`, which puts wave 30 at ~33× a wave-1 zombie and
wave 60 at ~530×.

### Dev hooks

With the page open, the console has `__game` and `__dev`:

```js
__game.cash = 99999
__game.speed = 3
__game.wave = 40          // jump the scaling
__game.startWave()
```

Saves live in `localStorage` under `laststand.save.v1` and autosave on each wave
clear.
