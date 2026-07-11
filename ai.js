/*
 * Battleship AI engine -- JavaScript port of the Python reference
 * implementation (ai/probability_ai.py, ai/random_ai.py, ai/placement_ai.py).
 *
 * Board: 8 rows x 11 columns. Cell state is one of:
 *   null    -- not yet fired upon
 *   "hit"   -- fired upon, ship present, not yet confirmed sunk
 *   "miss"  -- fired upon, no ship
 */

const ROWS = 8;
const COLS = 11;

const STANDARD_FLEET = [
  { name: "Carrier", length: 5 },
  { name: "Battleship", length: 4 },
  { name: "Cruiser", length: 3 },
  { name: "Submarine", length: 3 },
  { name: "Destroyer", length: 2 },
];

const STANDARD_FLEET_SIZES = STANDARD_FLEET.map((s) => s.length);

function key(r, c) {
  return r + "," + c;
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function choice(arr) {
  return arr[randInt(arr.length)];
}

function makeEmptyBoard() {
  const board = [];
  for (let r = 0; r < ROWS; r++) board.push(new Array(COLS).fill(null));
  return board;
}

function shipCells(r, c, length, orientation) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    cells.push(orientation === "H" ? [r, c + i] : [r + i, c]);
  }
  return cells;
}

/* ---------------- RandomAI ---------------- */

class RandomAI {
  constructor(fleetSizes) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
  }

  selectNextMove(board) {
    const candidates = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === null) candidates.push([r, c]);
      }
    }
    return choice(candidates);
  }
}

/* ---------------- ProbabilityAI ---------------- */

class ProbabilityAI {
  /*
   * Deliberately does NOT try to infer which specific ship a run of hits
   * belongs to, or track "remaining" ship sizes that shrink as ships sink.
   * An earlier version did this via a "capped run of hits" heuristic,
   * which is unsound: when two ships happen to be placed touching each
   * other, their combined hit run can look exactly like one longer ship,
   * causing the AI to misidentify which ship sank and corrupt every
   * density computation for the rest of the game (symptom: needing 87-88
   * shots on an 88-cell board). The "active placement" condition below
   * (covers a hit AND still has an unknown cell) gets the same practical
   * benefit -- stop wasting shots on a fully-explained run -- without
   * ever committing to a specific, possibly-wrong interpretation of which
   * ship is where: a capped run of hits with no adjacent unknown cell
   * simply can't extend, regardless of which ship(s) it turns out to be.
   * See BayesianAI for a more powerful (and more expensive) version of
   * this same idea using full joint particle sampling.
   */
  constructor(fleetSizes) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
  }

  selectNextMove(board) {
    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === null) unknown.push([r, c]);
      }
    }
    if (unknown.length === 0) throw new Error("No legal moves remain: board is full.");

    try {
      let density = this.computeDensity(board, false);

      let hasHits = false;
      for (let r = 0; r < ROWS && !hasHits; r++) {
        for (let c = 0; c < COLS; c++) {
          if (board[r][c] === "hit") {
            hasHits = true;
            break;
          }
        }
      }

      if (hasHits) {
        const targetDensity = this.computeDensity(board, true);
        let anyPositive = false;
        for (const v of targetDensity.values()) {
          if (v > 0) {
            anyPositive = true;
            break;
          }
        }
        if (anyPositive) density = targetDensity;
      }

      let bestScore = -1;
      for (const [r, c] of unknown) {
        const d = density.get(key(r, c));
        if (d > bestScore) bestScore = d;
      }
      const bestCells = unknown.filter(([r, c]) => density.get(key(r, c)) === bestScore);
      return choice(bestCells);
    } catch (e) {
      // Any unexpected failure must never cost us an invalid/slow move.
      return choice(unknown);
    }
  }

  /** Exposed so the UI can render a live heatmap of the AI's current thinking. */
  currentDensityMap(board) {
    let density = this.computeDensity(board, false);
    let hasHits = false;
    for (let r = 0; r < ROWS && !hasHits; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "hit") {
          hasHits = true;
          break;
        }
      }
    }
    if (hasHits) {
      const targetDensity = this.computeDensity(board, true);
      let anyPositive = false;
      for (const v of targetDensity.values()) {
        if (v > 0) {
          anyPositive = true;
          break;
        }
      }
      if (anyPositive) density = targetDensity;
    }
    return density;
  }

  computeDensity(board, requireActive) {
    const density = new Map();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) density.set(key(r, c), 0);
    }

    const lengths = new Set(this.fleetSizes);
    for (const length of lengths) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= COLS - length; c++) {
          const cells = [];
          for (let i = 0; i < length; i++) cells.push([r, c + i]);
          this.scorePlacement(cells, board, density, requireActive);
        }
      }
      for (let r = 0; r <= ROWS - length; r++) {
        for (let c = 0; c < COLS; c++) {
          const cells = [];
          for (let i = 0; i < length; i++) cells.push([r + i, c]);
          this.scorePlacement(cells, board, density, requireActive);
        }
      }
    }
    return density;
  }

  scorePlacement(cells, board, density, requireActive) {
    let hasHit = false;
    let hasUnknown = false;
    for (const [r, c] of cells) {
      const state = board[r][c];
      if (state === "miss") return;
      if (state === "hit") hasHit = true;
      else if (state === null) hasUnknown = true;
    }
    if (requireActive && !(hasHit && hasUnknown)) return;
    for (const [r, c] of cells) {
      const k = key(r, c);
      density.set(k, density.get(k) + 1);
    }
  }
}

/* ---------------- BayesianAI ---------------- */

const PARTICLE_TARGET = 20000; // persistent population size
const PARTICLE_MIN = 2500; // resample back up to PARTICLE_TARGET once we drop below this
const RESAMPLE_SOFT_BUDGET_MS = 400; // this turn may spend roughly this long refilling the population
const PARTICLE_MAX_POOL_PICK_ATTEMPTS = 40;

// Hunt/target score weights -- see class docstring. Tunable via self-play.
const W_ACTIVE_SHIP = 4.0;
const W_SINK = 2.0;
const W_OCCUPANCY_TARGET = 0.5;
const W_INFO_GAIN_HUNT = 0.1;

class BayesianAI {
  /*
   * Shot-selection AI backed by a persistent particle filter over complete
   * fleet configurations.
   *
   * A "particle" is one complete, internally consistent guess at where the
   * whole fleet is: every ship in the fleet gets a placement, no two ships
   * overlap, and (once observations exist) every hit cell is covered and no
   * miss cell is covered. The AI maintains a population of these particles
   * across the whole game -- filtering, not rebuilding, it after each shot
   * -- and derives its move purely from what fraction of surviving
   * particles agree on each cell. This never needs to *decide* which ship a
   * run of hits belongs to (the failure mode of a simpler capped-run
   * heuristic once ships touch and their hit-runs merge): particles
   * representing every remaining consistent interpretation stay alive side
   * by side, weighted implicitly by how many valid whole-fleet completions
   * support each one, and contradictory interpretations die out on their
   * own as more of the board is revealed -- there is never a point where
   * the AI commits to a wrong belief it can't recover from.
   *
   * Per shot:
   *   1. Filter -- drop particles inconsistent with any new hit/miss.
   *   2. Resample -- if too few particles survive, construct fresh ones
   *      consistent with *all* evidence so far (covers every hit, avoids
   *      every miss) to refill the population. Sampling reuses candidate
   *      pools precomputed once per resample rather than rejecting blind
   *      guesses, so refilling stays fast even late-game.
   *   3. Score -- three probability maps, not one:
   *        occupancy[cell]  = fraction of particles with *any* ship at cell.
   *        activeShip[cell] = fraction of particles where `cell` belongs to
   *                           a ship that has >=1 hit and >=1 still-unknown
   *                           cell in that particle (i.e. a ship that's
   *                           been found but not finished).
   *        sink[cell]       = fraction of particles where `cell` is the
   *                           *only* remaining unknown cell of such a ship
   *                           (firing here would sink it in that
   *                           hypothesis).
   *      If any activeShip mass exists, target mode: score cells by
   *      4*activeShip + 2*sink + 0.5*occupancy. Otherwise hunt mode: score
   *      by occupancy + 0.10*informationGain, where informationGain uses
   *      4*p*(1-p) as a cheap proxy for how much firing at a cell (roughly
   *      50/50 to hit) would narrow the hypothesis space -- a one-step
   *      lookahead in spirit without the cost of actually re-filtering the
   *      whole population once per candidate cell.
   *
   * Simplifications made deliberately for a board this size: "resampling"
   * regenerates fresh particles via constrained random construction rather
   * than mutating survivors (simpler, and cheap enough here that true
   * MCMC-style mutation isn't needed); informationGain is an analytic
   * entropy proxy rather than a literal two-branch expected-value
   * simulation. Coefficients above are reasonable defaults, tunable via
   * self-play.
   */

  constructor(fleetSizes) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.particles = null;
    this.processedCells = new Set();
  }

  selectNextMove(board) {
    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === null) unknown.push([r, c]);
      }
    }
    if (unknown.length === 0) throw new Error("No legal moves remain: board is full.");

    try {
      const scores = this.computeScores(board);

      let bestScore = -Infinity;
      let bestCells = [];
      for (const [r, c] of unknown) {
        const s = scores.get(key(r, c)) ?? 0;
        if (s > bestScore + 1e-12) {
          bestScore = s;
          bestCells = [[r, c]];
        } else if (Math.abs(s - bestScore) <= 1e-12) {
          bestCells.push([r, c]);
        }
      }
      if (bestCells.length === 0) return choice(unknown);
      return choice(bestCells);
    } catch (e) {
      return choice(unknown);
    }
  }

  /** Exposed so the UI can render a live heatmap of the AI's current thinking. */
  currentDensityMap(board) {
    try {
      return this.computeScores(board);
    } catch (e) {
      const d = new Map();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) d.set(key(r, c), 0);
      return d;
    }
  }

  computeScores(board) {
    const start = performance.now();

    if (this.particles === null) {
      this.particles = this.generateParticles(new Set(), new Set(), PARTICLE_TARGET, start + RESAMPLE_SOFT_BUDGET_MS * 4);
    }

    this.applyNewEvidence(board);
    this.maybeResample(board, start);

    const scores = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) scores.set(key(r, c), 0);

    if (this.particles.length === 0) {
      return this.fallbackScores(board);
    }

    const n = this.particles.length;
    const occupancy = new Map();
    const activeShip = new Map();
    const sink = new Map();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = key(r, c);
        occupancy.set(k, 0);
        activeShip.set(k, 0);
        sink.set(k, 0);
      }
    }

    for (const particle of this.particles) {
      for (const cells of particle.ships) {
        let hitCount = 0;
        const unknownInShip = [];
        for (const [r, c] of cells) {
          const state = board[r][c];
          if (state === "hit") hitCount++;
          else if (state === null) unknownInShip.push([r, c]);
        }
        for (const [r, c] of unknownInShip) {
          const k = key(r, c);
          occupancy.set(k, occupancy.get(k) + 1);
        }
        if (hitCount > 0 && hitCount < cells.length) {
          for (const [r, c] of unknownInShip) {
            const k = key(r, c);
            activeShip.set(k, activeShip.get(k) + 1);
          }
          if (unknownInShip.length === 1) {
            const [r, c] = unknownInShip[0];
            const k = key(r, c);
            sink.set(k, sink.get(k) + 1);
          }
        }
      }
    }

    let hasActive = false;
    for (const v of activeShip.values()) {
      if (v > 0) {
        hasActive = true;
        break;
      }
    }

    for (const k of scores.keys()) {
      const occ = occupancy.get(k) / n;
      if (hasActive) {
        const act = activeShip.get(k) / n;
        const snk = sink.get(k) / n;
        scores.set(k, W_ACTIVE_SHIP * act + W_SINK * snk + W_OCCUPANCY_TARGET * occ);
      } else {
        const infoGain = 4 * occ * (1 - occ);
        scores.set(k, occ + W_INFO_GAIN_HUNT * infoGain);
      }
    }

    return scores;
  }

  fallbackScores(board) {
    const blocked = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "miss") blocked.add(key(r, c));
      }
    }
    const density = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) density.set(key(r, c), 0);
    for (const length of new Set(this.fleetSizes)) {
      for (const cells of this.allValidPlacements(length, blocked)) {
        const hasHit = cells.some(([r, c]) => board[r][c] === "hit");
        const hasUnknown = cells.some(([r, c]) => board[r][c] === null);
        if (hasHit && !hasUnknown) continue;
        for (const [r, c] of cells) {
          const k = key(r, c);
          density.set(k, density.get(k) + 1);
        }
      }
    }
    return density;
  }

  /* ---------------- Particle maintenance ---------------- */

  applyNewEvidence(board) {
    const newHits = [];
    const newMisses = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const state = board[r][c];
        if (state === null) continue;
        const k = key(r, c);
        if (this.processedCells.has(k)) continue;
        this.processedCells.add(k);
        if (state === "hit") newHits.push(k);
        else if (state === "miss") newMisses.push(k);
      }
    }
    if (newHits.length === 0 && newMisses.length === 0) return;

    this.particles = this.particles.filter((p) => {
      for (const k of newHits) if (!p.occupied.has(k)) return false;
      for (const k of newMisses) if (p.occupied.has(k)) return false;
      return true;
    });
  }

  maybeResample(board, startTime) {
    if (this.particles.length >= PARTICLE_MIN) return;

    const blocked = new Set();
    const activeHits = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "miss") blocked.add(key(r, c));
        else if (board[r][c] === "hit") activeHits.add(key(r, c));
      }
    }

    const deadline = startTime + RESAMPLE_SOFT_BUDGET_MS;
    const fresh = this.generateParticles(blocked, activeHits, PARTICLE_TARGET - this.particles.length, deadline);
    this.particles = this.particles.concat(fresh);
  }

  generateParticles(blocked, activeHits, targetCount, deadline) {
    const validByLength = new Map();
    for (const length of new Set(this.fleetSizes)) {
      validByLength.set(length, this.allValidPlacements(length, blocked));
    }

    const particles = [];
    let attempts = 0;
    const maxAttempts = Math.max(targetCount * 25, 20000);
    while (particles.length < targetCount && attempts < maxAttempts) {
      attempts++;
      if (attempts % 300 === 0 && performance.now() > deadline) break;
      const ships = this.tryBuildParticle(activeHits, validByLength);
      if (ships !== null) particles.push(this.makeParticle(ships));
    }
    return particles;
  }

  tryBuildParticle(activeHits, validByLength) {
    const occupied = new Set();
    const remaining = [...this.fleetSizes];
    const uncovered = new Set(activeHits);
    const ships = [];

    while (uncovered.size > 0) {
      const h = uncovered.values().next().value;
      const [hr, hc] = h.split(",").map(Number);
      const candidates = []; // [length, cells, weight]
      for (const length of new Set(remaining)) {
        for (const cells of validByLength.get(length)) {
          if (cells.some(([r, c]) => r === hr && c === hc) && this.cellsFree(cells, occupied)) {
            // Weight by (overlap with currently-uncovered hits)^2. Without
            // this, a run of touching hits gets constructed as often via
            // many separate ships each crossing it at a single cell as via
            // the far more realistic single ship spanning the whole run --
            // there are simply more (length, placement) pairs of the first
            // kind, so uniform random choice over-samples them.
            const overlap = cells.filter(([r, c]) => uncovered.has(key(r, c))).length;
            candidates.push([length, cells, overlap * overlap]);
          }
        }
      }
      if (candidates.length === 0) return null;
      const totalWeight = candidates.reduce((sum, [, , w]) => sum + w, 0);
      let pick = Math.random() * totalWeight;
      let [length, cells] = [candidates[candidates.length - 1][0], candidates[candidates.length - 1][1]];
      for (const [candLength, candCells, w] of candidates) {
        pick -= w;
        if (pick <= 0) {
          length = candLength;
          cells = candCells;
          break;
        }
      }
      for (const [r, c] of cells) occupied.add(key(r, c));
      remaining.splice(remaining.indexOf(length), 1);
      for (const [r, c] of cells) uncovered.delete(key(r, c));
      ships.push(cells);
    }

    for (const length of remaining) {
      const cells = this.pickFromPool(validByLength.get(length), occupied);
      if (cells === null) return null;
      for (const [r, c] of cells) occupied.add(key(r, c));
      ships.push(cells);
    }

    return ships;
  }

  makeParticle(ships) {
    const occupied = new Set();
    for (const cells of ships) for (const [r, c] of cells) occupied.add(key(r, c));
    return { ships, occupied };
  }

  pickFromPool(pool, occupied, maxAttempts = PARTICLE_MAX_POOL_PICK_ATTEMPTS) {
    const n = pool.length;
    if (n === 0) return null;
    for (let i = 0; i < Math.min(maxAttempts, n); i++) {
      const cells = pool[randInt(n)];
      if (this.cellsFree(cells, occupied)) return cells;
    }
    return null;
  }

  allValidPlacements(length, blocked) {
    const placements = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS - length; c++) {
        const cells = [];
        for (let i = 0; i < length; i++) cells.push([r, c + i]);
        if (this.cellsFree(cells, blocked)) placements.push(cells);
      }
    }
    for (let r = 0; r <= ROWS - length; r++) {
      for (let c = 0; c < COLS; c++) {
        const cells = [];
        for (let i = 0; i < length; i++) cells.push([r + i, c]);
        if (this.cellsFree(cells, blocked)) placements.push(cells);
      }
    }
    return placements;
  }

  cellsFree(cells, ...blockers) {
    for (const [r, c] of cells) {
      const k = key(r, c);
      for (const blocker of blockers) {
        if (blocker.has(k)) return false;
      }
    }
    return true;
  }
}

/* ---------------- PlacementAI ---------------- */

class PlacementAI {
  constructor({ restarts = 10, gamesPerCandidate = 3 } = {}) {
    this.restarts = restarts;
    this.gamesPerCandidate = gamesPerCandidate;
  }

  placeShips(fleetSizes) {
    const sizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    let bestLayout = null;
    let bestAvg = -Infinity;
    for (let i = 0; i < this.restarts; i++) {
      const layout = this.randomLegalLayout(sizes);
      if (!layout) continue;
      const avg = this.evaluate(layout, sizes);
      if (avg > bestAvg) {
        bestAvg = avg;
        bestLayout = layout;
      }
    }
    if (!bestLayout) throw new Error("Could not find a legal ship layout");
    return bestLayout;
  }

  evaluate(layout, sizes) {
    const ships = this.shipCellSet(layout);
    let total = 0;
    for (let i = 0; i < this.gamesPerCandidate; i++) total += this.simulateGame(ships, sizes);
    return total / this.gamesPerCandidate;
  }

  simulateGame(ships, sizes) {
    // Uses the fast heuristic AI (not BayesianAI) as the internal evaluator
    // -- BayesianAI is ~100x slower per game, which would make this search
    // (dozens of simulated games) take minutes instead of ~1 second. A
    // layout that resists ProbabilityAI well also resists BayesianAI well
    // in practice, since both ultimately concentrate fire the same way
    // once a hit is found.
    const board = makeEmptyBoard();
    const attacker = new ProbabilityAI(sizes);
    let shots = 0;
    let remaining = ships.size;
    const maxShots = ROWS * COLS;
    while (remaining > 0 && shots < maxShots) {
      const [r, c] = attacker.selectNextMove(board);
      shots++;
      const k = key(r, c);
      if (ships.has(k)) {
        board[r][c] = "hit";
        remaining--;
      } else {
        board[r][c] = "miss";
      }
    }
    return shots;
  }

  shipCellSet(layout) {
    const cells = new Set();
    for (const { r, c, length, orientation } of layout) {
      for (const [rr, cc] of shipCells(r, c, length, orientation)) cells.add(key(rr, cc));
    }
    return cells;
  }

  randomLegalLayout(sizes, maxAttempts = 500) {
    const occupied = new Set();
    const layout = [];
    const sorted = [...sizes].sort((a, b) => b - a);
    for (const length of sorted) {
      let placed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const orientation = Math.random() < 0.5 ? "H" : "V";
        let r, c;
        if (orientation === "H") {
          r = randInt(ROWS);
          c = randInt(COLS - length + 1);
        } else {
          r = randInt(ROWS - length + 1);
          c = randInt(COLS);
        }
        const cells = shipCells(r, c, length, orientation);
        if (cells.some(([rr, cc]) => occupied.has(key(rr, cc)))) continue;
        layout.push({ r, c, length, orientation });
        for (const [rr, cc] of cells) occupied.add(key(rr, cc));
        placed = true;
        break;
      }
      if (!placed) return null;
    }
    return layout;
  }
}
