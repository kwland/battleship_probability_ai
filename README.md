# Battleship Hybrid AI

This project adds a **HybridAI** opponent to the existing Random, Probability,
Bayesian, and POMCP opponents. It is designed for the tournament requirement
that every shot be returned in less than three seconds.

## What HybridAI combines

1. **Complete-fleet belief tracking**
   - Every particle is a complete legal placement of the remaining fleet.
   - Particles inconsistent with hits, misses, or exact sunk announcements are
     removed.
   - Ships may touch; the AI does not infer ship identity from a continuous run
     of hits.

2. **A small trained policy**
   - A linear model ranks legal shots using posterior occupancy, information
     gain, parity, neighboring occupancy, hit geometry, sink probability, and
     active-ship probability.
   - `train_hybrid.js` tunes the weights through self-play on training fleets,
     then selects a model on a separate held-out fleet set.
   - The trainer keeps the untouched posterior baseline if no candidate wins on
     the held-out games.

3. **Conservative POMCP planning**
   - The playable opponent searches future hit/miss/sunk branches.
   - Planning may replace the trained policy's move only when the search finds
     a clearly better value. This prevents a small noisy tree from weakening
     the policy.

4. **Exact late-game enumeration**
   - When few cells remain, the AI attempts to enumerate every consistent fleet.
   - If enumeration cannot finish within its internal budget, it safely falls
     back to the particle belief.

5. **Tournament-safe timing**
   - The playable AI uses an internal 2.65-second deadline.
   - It stores a valid legal fallback immediately, so a timeout or exception
     does not produce an illegal shot.

## Files

- `ai.js` — all attack AIs, HybridAI, and PlacementAI.
- `app.js` — game UI and five-way benchmark integration.
- `index.html`, `style.css` — browser interface.
- `policy_model.json` — held-out self-play-selected policy weights.
- `train_hybrid.js` — reproducible offline trainer.
- `training_results.json` — model-selection results.
- `benchmark_results.json` — 100-game comparison.
- `layouts.json` — adversarial mixed placement pool.
- `optimize_placement.js` — offline placement optimizer.
- `submission_adapter.js` — generic tournament API wrapper.
- `tournament_ai.js` — single-file version of `ai.js` plus the adapter.

## Latest tests

All random-layout algorithms attacked the same 100 legal fleets. Lower is
better.

| Algorithm | Average shots | Standard deviation | Maximum move time |
|---|---:|---:|---:|
| ProbabilityAI | 51.66 | 8.12 | 2.28 ms |
| POMCPAI benchmark mode | 41.97 | 7.80 | 19.41 ms |
| **HybridAI benchmark mode** | **40.65** | 7.65 | 30.78 ms |

On 100 layouts from the adversarial placement pool:

| Algorithm | Average shots |
|---|---:|
| POMCPAI benchmark mode | 47.59 |
| **HybridAI benchmark mode** | **46.31** |

A separate 20-game test of the stronger playable HybridAI averaged 39.95
shots. Its slowest measured move was 149.04 ms, far below the three-second
limit. Results vary because fleet placement, particles, and planning are
randomized.

## Running the browser project

Use a local server so the optional JSON model and placement pool can load:

```bash
python -m http.server 8765
```

Then open:

```text
http://localhost:8765
```

If JSON loading fails, the trained policy weights are also embedded in
`ai.js`, so the AI still functions.

## Re-training the policy

Quick held-out search:

```bash
node train_hybrid.js --quick
```

Larger search:

```bash
node train_hybrid.js --full
```

The full mode is intentionally expensive. Training is offline and does not
count against the tournament's per-shot computation limit unless the
instructor explicitly says otherwise.

## Tournament integration

The supplied `submission_adapter.js` exposes:

```js
nextShot(board)
reportShotResult(result)
resetTournamentAI()
```

`nextShot` currently returns:

```js
{ row, col }
```

Change that one line if the assignment expects `[row, col]` or a cell index.
Also adjust `normalizeTournamentBoard` if the harness uses different values for
unknown, hit, and miss cells.

### Board-only harnesses

HybridAI works even when the harness only supplies the board and never calls
`reportShotResult`. In that mode, it deliberately avoids relying on the
negative inference that a completely hit ship would have been announced sunk.
Explicit sunk callbacks still improve accuracy when the tournament provides
them.

## Important limitation

HybridAI is the strongest algorithm tested in this project, not a proof of
mathematically optimal Battleship play. The exact tournament API, sunk-ship
information, turn rules, and opponent placement distribution can materially
change which policy performs best. Run the included 100–200 game benchmark
using the same interface and rules as the tournament before submitting.
