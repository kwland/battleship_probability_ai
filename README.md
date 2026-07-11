# Battleship Ultimate AI

A static HTML/CSS/JavaScript Battleship game for an 8 × 11 board.

## Strongest opponent

`BayesianAI` now combines several layers:

- **Exact sunk-ship feedback:** the game reports the sunk ship's length and exact cells, so the AI never guesses incorrectly when ships touch.
- **Complete-fleet particle filtering:** every hypothesis is a legal placement of the entire fleet consistent with all hits, misses, and sunk ships.
- **Constrained resampling and Gibbs rejuvenation:** depleted hypothesis populations are rebuilt and randomly mixed without violating the evidence.
- **Target-aware scoring:** continuation probability and immediate sink probability dominate once a ship has been found.
- **Shallow lookahead:** in hunt mode, the best candidate cells also receive a two-shot expected-value adjustment.
- **Adaptive memory:** completed player layouts become an empirical prior in later games. Memory is local to the browser and can be reset.

## Placement defense

The enemy fleet is selected from `layouts.json`, a diverse pool of optimized layouts. After completed games, the placer also learns the player's firing order and favors layouts whose final cells would have been found later, while still randomizing among several elite choices.

## Files

- `index.html` — page and controls
- `style.css` — visual styling
- `ai.js` — RandomAI, ProbabilityAI, BayesianAI, and PlacementAI
- `app.js` — game state, exact sunk feedback, benchmarking, and local learning
- `layouts.json` — optimized mixed placement pool

## Run

Use a local server so `layouts.json` can load:

```bash
python -m http.server 8765
```

Then open `http://localhost:8765`.

Opening `index.html` directly with `file://` may prevent the browser from loading `layouts.json`; the game will still work but will use a slower live placement search.
