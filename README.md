# LAST STAND

A maze-building zombie tower defense. Endless waves, deep upgrade trees, and
**exactly one spawn point — forever.**

## Run it

```bash
npm start
```

Then open <http://localhost:8080>. No dependencies, no build step. The server is
a ~40-line static file server; it only exists because ES modules can't load over
`file://`.

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

### Controls

| Key | Action |
|---|---|
| `1`–`8` | Pick a tower to build |
| Click | Place it, or click a placed tower to inspect |
| Click-drag | Lay a run of barricades |
| Right-click / `Esc` | Cancel build mode |
| `Enter` | Send the next wave |
| `Space` | Pause |
| `S` | Cycle speed 1× → 2× → 3× |
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
index.html          shell
server.js           zero-dependency static server
src/
  config.js         ALL balance numbers, colours, map layout
  towers.js         tower defs + upgrade/branch trees
  enemies.js        enemy defs + per-wave scaling
  waves.js          deterministic wave generation
  pathfinding.js    flow-field BFS (see below)
  game.js           simulation: state and rules, no drawing
  render.js         all canvas drawing, no state mutation
  ui.js             DOM sidebar, panels, overlays
  audio.js          synthesised SFX (no asset files)
  main.js           input, frame loop, wiring
```

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
