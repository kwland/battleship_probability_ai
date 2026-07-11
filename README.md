# Battleship AI Lab — POMCP Edition

A static, client-side Battleship site for an 8×11 board. It includes four
attacking algorithms, a live decision heatmap, evolved fleet placement, and a
shared-layout benchmark that can run 100–200 games per fast algorithm.

## Opponents

### POMCPAI — default / strongest implemented opponent

The new opponent is a Battleship-specialized implementation inspired by
**POMCP (Partially Observable Monte-Carlo Planning)** from David Silver and
Joel Veness, *Monte-Carlo Planning in Large POMDPs* (NeurIPS 2010).

Battleship is treated as a partially observable planning problem:

- A hidden state is one complete legal fleet layout.
- An action is firing at an untested cell.
- An observation is a miss, hit, or an exact sunk-ship announcement.
- A particle belief stores possible complete fleets consistent with all
  observations so far.
- Each decision samples possible hidden fleets and runs PUCT/Monte-Carlo tree
  search over future shot/observation branches.

This differs from a greedy probability heatmap. A shot can be selected not
only because it is likely to hit now, but because its result can improve later
decisions. The playable opponent uses a larger search budget than the browser
benchmark.

### BayesianAI

Maintains a persistent particle population of complete fleet layouts and
selects the cell with the strongest posterior occupancy/target/sink score. It
is strong, but it is primarily greedy rather than performing an online search
over future observations.

The class now accepts optional particle settings so the benchmark can use a
smaller, faster configuration without changing the full playable opponent.

### ProbabilityAI

Enumerates legal placements for each ship length independently and builds a
probability-density map. It is fast and much stronger than random, but it does
not enforce whole-fleet consistency.

### RandomAI

Uniform random legal shots. Included as a baseline.

## Exact sunk feedback

`app.js` reports the exact length and cells of a newly sunk ship to algorithms
that expose `recordShotResult()`. This is legal information in standard
Battleship and prevents ambiguity when ships touch.

## Benchmark

The benchmark:

- Uses the same randomly generated fleet sequence for every algorithm.
- Runs 100–200 games for RandomAI, ProbabilityAI, a fast BayesianAI
  configuration, and a fast POMCPAI configuration.
- Reports average shots, standard deviation, game count, and runtime.
- Uses reduced particle/search budgets for BayesianAI and POMCPAI so the test
  remains practical in a browser.

A 100-game validation run in the development environment produced:

| Algorithm | Average shots | Standard deviation |
|---|---:|---:|
| POMCPAI benchmark mode | 41.65 | 7.33 |
| BayesianAI benchmark mode | 45.46 | 7.99 |
| ProbabilityAI | 51.80 | 8.57 |
| RandomAI | 84.05 | 4.11 |

Results vary because layouts and Monte-Carlo searches are randomized. Fewer
shots is better.

## Ship placement

The enemy fleet and **Auto-Place (Smart)** draw from `layouts.json`, a pool of
strong, diverse layouts generated offline. The game chooses randomly from the
pool so a repeated opponent cannot memorize one fixed arrangement. If the JSON
file cannot be loaded, `PlacementAI` falls back to a live randomized search.

## Files

- `index.html` — UI, opponent tabs, benchmark controls, algorithm descriptions
- `style.css` — board, tab, and benchmark-table styling
- `ai.js` — RandomAI, ProbabilityAI, BayesianAI, POMCPAI, and PlacementAI
- `app.js` — game flow, exact shot feedback, opponent selection, benchmark
- `layouts.json` — optional pre-optimized fleet-layout pool

## Run locally

```bash
python -m http.server 8765
```

Open `http://localhost:8765`.

## Deploy to GitHub Pages

Commit the files to a repository, then choose the repository branch/folder in
**Settings → Pages**. No backend or build step is required.
