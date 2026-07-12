# Battleship AI Lab — POMCP + Adversarial Placement

Static HTML/CSS/JavaScript Battleship on an **8 × 11** board with fleet sizes
`[5, 4, 3, 3, 2]`.

The project contains four attack algorithms and four selectable placement
policies. The default combination is the POMCP attacker plus the adversarial
maximin placement policy.

## Is POMCP mathematically optimal?

No. An exact optimal policy would solve the complete Battleship POMDP over all
reachable beliefs and future action/observation histories. That is not practical
at this board size. POMCP is a strong online approximation: it samples complete
hidden fleets and uses Monte Carlo tree search to plan several observations
forward. Other research POMDP solvers, such as DESPOT and offline graph-search
methods, can be preferable under different compute budgets and assumptions.

The included `POMCPAI` is therefore best understood as the strongest **tested
browser-compatible attacker in this project**, not as a proof of globally
optimal play.

## Attack algorithms

- **POMCPAI** — particle belief plus online PUCT/Monte Carlo tree search.
- **BayesianAI** — persistent complete-fleet particle posterior with greedy
  occupancy/active-ship/sink scoring.
- **ProbabilityAI** — fast independent-placement density heuristic.
- **RandomAI** — uniform random legal shots.

The attacker benchmark runs all four on the same random layout sequence. The
browser uses reduced POMCP/Bayesian settings for the 100–200 game benchmark;
the playable opponents use stronger settings.

## Adversarial placement policy

There is no strongest single fixed layout for repeated play: a fixed board can
be learned and targeted. The default placement policy is therefore a weighted
mixed strategy stored in `layouts.json`.

`optimize_placement.js` builds it in three stages:

1. **Evolutionary candidate search** — random legal layouts are mutated by
   relocating, shifting, rotating, mirroring, moving toward edges, or moving
   ships near one another.
2. **Adversarial evaluation** — finalists are tested against seeded instances
   of ProbabilityAI, BayesianAI, POMCPAI, and several deterministic human-style
   hunt/target policies.
3. **Maximin linear program** — SciPy chooses sampling weights that maximize the
   minimum expected survival against the attack ensemble. Extra constraints
   prevent one layout from receiving excessive weight and keep aggregate cell
   occupancy reasonably flat.

The generated quick-search pool contains **42 weighted layouts**. Its mean cell
occupancy is exactly `17 / 88 ≈ 0.1932`; observed marginal occupancy across the
pool ranges from approximately **0.130 to 0.245**.

### Out-of-sample 100-game validation

These games used seeds that were not used by the optimizer. Higher shots means
stronger defense.

| Attacker | Random placement | Previous 50-layout pool | New maximin mix |
|---|---:|---:|---:|
| ProbabilityAI | 50.99 | 59.90 | **62.27** |
| BayesianAI benchmark mode | 45.23 | 47.30 | **51.18** |
| POMCPAI benchmark mode | 43.48 | 43.51 | **48.92** |

Against POMCP, the new policy survived about **5.4 extra shots** compared with
the previous pool and random placement in this validation.

## Runtime adaptation

The browser stores up to 30 of the player's firing sequences in local storage.
The adversarial policy softly tilts its maximin weights toward layouts predicted
to survive those habits, while:

- preserving a fixed non-adaptive component,
- penalizing recently used layout IDs,
- continuing to sample randomly from many layouts.

The **Reset placement learning** button deletes this local profile. No data is
sent to a server.

## Placement modes

- **Adversarial maximin** — weighted optimized pool plus optional local
  adaptation; default and strongest.
- **Uniform elite pool** — ignores optimized weights and player history.
- **Legacy live search** — generates random candidates and scores them against
  ProbabilityAI at game start.
- **Random placement** — baseline.

The page includes a separate **Placement-defense benchmark** that runs 100–200
games against POMCP, Bayesian, or ProbabilityAI.

## Re-running the optimizer

The optimizer requires Node.js and Python with NumPy/SciPy.

```bash
node optimize_placement.js --mode=quick --output=layouts.json
```

For a larger search:

```bash
node optimize_placement.js --mode=full --output=layouts.json
```

Full mode uses more candidates, attack seeds, and stricter mixture constraints,
so it can take substantially longer.

## Run locally

Use an HTTP server so `layouts.json` can be fetched:

```bash
python -m http.server 8765
```

Open `http://localhost:8765`.

Opening `index.html` directly through `file://` may block JSON loading. The game
will still work, but placement falls back to legacy live search.

## Files

- `index.html` — setup, opponent tabs, and both benchmarks.
- `style.css` — responsive presentation.
- `ai.js` — all attack AIs and placement policies.
- `app.js` — game state, exact sunk notifications, local placement learning,
  and benchmarks.
- `layouts.json` — new weighted maximin pool.
- `layouts_legacy.json` — previous 50-layout pool for comparison/reference.
- `optimize_placement.js` — offline adversarial optimizer.
