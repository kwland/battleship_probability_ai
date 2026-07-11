# Battleship Probability AI — Web Demo

A static, client-side-only site (plain HTML/CSS/JS, no build step, no backend)
that lets you manually place your own fleet (or auto-place it with a smart
placement search), play against a choice of AI opponents, watch a live
"heatmap" of likely ship cells, and benchmark the AIs against each other.

Ships render as rounded hulls with portholes, hits as a starburst with a
red glow, misses as a ripple, and sunk ships flip to a grey "wreck" hull —
no plain colored squares.

## AI opponents

- **BayesianAI (default, strongest)** — Monte Carlo configuration-space
  sampling. Each turn it draws thousands of complete, mutually consistent
  whole-fleet layouts (no overlaps, nothing crossing a known miss, every
  unresolved hit covered by some ship) and tallies true joint cell-occupancy
  frequency across them. This is the closest practical stand-in for exact
  Bayesian inference — exact enumeration of every possible fleet layout is
  combinatorially infeasible even on this small board.
- **ProbabilityAI (heuristic)** — scores each remaining ship length
  independently (how many valid placements of that length cover each cell)
  rather than jointly across the whole fleet. Faster, still strong, but
  can't reason about multiple ships/hits interacting at once.
- **RandomAI (baseline)** — fires at a uniformly random legal cell.

Ship placement (both the enemy fleet and the "Auto-Place (Smart)" button)
searches random legal layouts and keeps whichever one survives longest
against simulated `ProbabilityAI` attacks — `BayesianAI` is ~100x slower per
game, so using it for this repeated internal search would take minutes
instead of about a second; a layout that resists `ProbabilityAI` well also
holds up well against `BayesianAI` in practice.

## Files

- `index.html` — page structure
- `style.css` — styling (dark/light aware)
- `ai.js` — JS port of the AI logic (`RandomAI`, `ProbabilityAI`, `BayesianAI`, `PlacementAI`)
- `app.js` — game state and UI wiring

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
