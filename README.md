# Battleship Probability AI — Web Demo

A static, client-side-only site (plain HTML/CSS/JS, no build step, no backend)
that lets you manually place your own fleet (or auto-place it with a smart
placement search), play against a choice of AI opponents, watch a live
"heatmap" of likely ship cells, and benchmark the AIs against each other.

Ships render as rounded hulls with portholes, hits as a starburst with a
red glow, misses as a ripple, and sunk ships flip to a grey "wreck" hull —
no plain colored squares.

## AI opponents

- **BayesianAI (default, strongest)** — a persistent particle filter.
  Maintains a population of thousands of "particles" (complete, internally
  consistent whole-fleet layouts) across the entire game, filtering it
  after every shot rather than rebuilding it from scratch: a particle
  survives a miss only if none of its ships are there, and survives a hit
  only if one of its ships is. Each particle keeps its ships' individual
  identities rather than collapsing into one flat "occupied cells" set —
  this is what lets it reason correctly when two ships are placed touching
  each other, since it never has to *decide* which specific ship a run of
  hits belongs to (see "Fixed bug" below). Scoring splits into an occupancy
  probability (is anything here) and an active-ship / sink probability (does
  a partially-hit ship continue into here), so once a hit exists it
  concentrates fire on finishing that ship before hunting a new one. When
  hunting, an entropy-style information-gain term nudges it toward cells
  closer to 50/50, a cheap one-step-lookahead proxy for how much a shot
  there would narrow down the remaining hypotheses.
- **ProbabilityAI (heuristic)** — much faster and still strong: scores each
  ship length independently (how many valid placements of that length cover
  each cell) rather than jointly across the whole fleet, so it can't fully
  rule out an option that looks locally plausible but is actually
  impossible once the rest of the board is taken into account.
- **RandomAI (baseline)** — fires at a uniformly random legal cell.

### Fixed bug: sunk-ship detection breaking on touching ships

An earlier version of both AIs tried to *infer* when a ship had sunk by
looking for a run of hits capped on both ends by a miss or the board edge,
then removed that ship's length from a "remaining sizes" list. This breaks
when two ships are placed touching each other: their combined hit run looks
exactly like one longer ship, so the AI could misidentify which ship sank,
permanently corrupt its belief about the remaining fleet, and need nearly
every cell on the board to finish the game. Neither AI does this anymore.
`ProbabilityAI` never shrinks its ship-length list at all, and instead only
targets placements that still have an unknown cell to give. `BayesianAI`
goes further and never tries to *decide* anything about which ship is
where — every consistent interpretation of a run of hits stays alive in the
particle population until later shots naturally rule the wrong ones out.

### Ship placement — evolved, mixed strategy

Ship placement (both the enemy fleet and the "Auto-Place (Smart)" button)
draws from `layouts.json`: a pool of ~50 strong-but-diverse layouts produced
offline by an evolutionary search (`optimize_placement.py` in the Python
project). The search evolves candidate layouts over many generations —
mutating by moving, rotating, shifting, swapping, or clustering ships —
scoring each by how many shots a panel of attackers needs to sink it, and
rewards both average and worst-case survival. It then keeps ~50 layouts that
are individually strong yet structurally different from one another.

At game time PlacementAI picks one of those at random — a **mixed strategy**,
so a repeat human opponent can't learn and exploit a single fixed pattern. If
`layouts.json` is missing (or the page is opened via `file://`, where `fetch`
is blocked), it falls back to a quick live search that keeps the best of a
handful of random layouts.

The offline screening uses the fast `ProbabilityAI`, not `BayesianAI`, purely
for speed (Bayesian is ~100x slower per game); a layout that resists one
resists the other in practice.

## Files

- `index.html` — page structure
- `style.css` — styling (dark/light aware)
- `ai.js` — JS port of the AI logic (`RandomAI`, `ProbabilityAI`, `BayesianAI`, `PlacementAI`)
- `app.js` — game state and UI wiring
- `layouts.json` — pre-optimized diverse placement pool (see the Python
  project's `optimize_placement.py`); optional — the app works without it

## Run locally

Any static file server works, e.g.:

```
python -m http.server 8765
```

then open `http://localhost:8765`.

## Deploy to GitHub Pages

1. Commit these files to a GitHub repo (either at the repo root, or in a
   `docs/` folder, or on their own branch — whatever matches your Pages
   source setting).
2. In the repo: **Settings → Pages → Source**, pick the branch/folder these
   files live in.
3. Save. GitHub will publish it at `https://<username>.github.io/<repo>/`.

No further configuration is needed — everything runs in the browser.
