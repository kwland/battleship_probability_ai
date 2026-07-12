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

    // Weight each length by its multiplicity in the fleet. The standard
    // fleet has two length-3 ships, so length-3 placements should count
    // double; iterating over new Set(fleetSizes) would collapse them and
    // systematically under-weight the doubled length.
    const counts = new Map();
    for (const length of this.fleetSizes) counts.set(length, (counts.get(length) || 0) + 1);

    for (const [length, count] of counts) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= COLS - length; c++) {
          const cells = [];
          for (let i = 0; i < length; i++) cells.push([r, c + i]);
          this.scorePlacement(cells, board, density, requireActive, count);
        }
      }
      for (let r = 0; r <= ROWS - length; r++) {
        for (let c = 0; c < COLS; c++) {
          const cells = [];
          for (let i = 0; i < length; i++) cells.push([r + i, c]);
          this.scorePlacement(cells, board, density, requireActive, count);
        }
      }
    }
    return density;
  }

  scorePlacement(cells, board, density, requireActive, weight) {
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
      density.set(k, density.get(k) + weight);
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

  constructor(fleetSizes, options = {}) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.particleTarget = options.particles ?? PARTICLE_TARGET;
    this.particleMin = options.minParticles ?? PARTICLE_MIN;
    this.resampleBudgetMs = options.resampleBudgetMs ?? RESAMPLE_SOFT_BUDGET_MS;
    this.poolPickAttempts = options.poolPickAttempts ?? PARTICLE_MAX_POOL_PICK_ATTEMPTS;
    this.particles = null;
    this.processedCells = new Set();
    // Cache the scores map keyed by a board signature. The UI renders the
    // heatmap via currentDensityMap() and then the actual AI move calls
    // selectNextMove() on the *same* board -- without this the (stateful)
    // particle filtering + resampling would run twice per turn and, worse,
    // the heatmap shown would be a different random sample than the one the
    // AI actually acted on. Caching makes them one and the same.
    this.cachedSignature = null;
    this.cachedScores = null;
  }

  static signature(board) {
    let s = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        s += board[r][c] === "hit" ? "H" : board[r][c] === "miss" ? "M" : ".";
      }
    }
    return s;
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
    const signature = BayesianAI.signature(board);
    if (signature === this.cachedSignature && this.cachedScores !== null) {
      return this.cachedScores;
    }

    const start = performance.now();

    if (this.particles === null) {
      this.particles = this.generateParticles(new Set(), new Set(), this.particleTarget, start + this.resampleBudgetMs * 4);
    }

    this.applyNewEvidence(board);
    this.maybeResample(board, start);

    const scores = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) scores.set(key(r, c), 0);

    if (this.particles.length === 0) {
      const fallback = this.fallbackScores(board);
      this.cachedSignature = signature;
      this.cachedScores = fallback;
      return fallback;
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

    this.cachedSignature = signature;
    this.cachedScores = scores;
    return scores;
  }

  lengthCounts() {
    const counts = new Map();
    for (const length of this.fleetSizes) counts.set(length, (counts.get(length) || 0) + 1);
    return counts;
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
    // Weight each length by its multiplicity in the fleet -- the two
    // length-3 ships must contribute twice as much placement mass as a
    // single length, which iterating over new Set(fleetSizes) would miss.
    for (const [length, count] of this.lengthCounts()) {
      for (const cells of this.allValidPlacements(length, blocked)) {
        const hasHit = cells.some(([r, c]) => board[r][c] === "hit");
        const hasUnknown = cells.some(([r, c]) => board[r][c] === null);
        if (hasHit && !hasUnknown) continue;
        for (const [r, c] of cells) {
          const k = key(r, c);
          density.set(k, density.get(k) + count);
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
    if (this.particles.length >= this.particleMin) return;

    const blocked = new Set();
    const activeHits = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "miss") blocked.add(key(r, c));
        else if (board[r][c] === "hit") activeHits.add(key(r, c));
      }
    }

    const deadline = startTime + this.resampleBudgetMs;
    const fresh = this.generateParticles(blocked, activeHits, this.particleTarget - this.particles.length, deadline);
    this.particles = this.particles.concat(fresh);
  }

  generateParticles(blocked, activeHits, targetCount, deadline) {
    const validByLength = new Map();
    for (const length of new Set(this.fleetSizes)) {
      validByLength.set(length, this.allValidPlacements(length, blocked));
    }
    // Static (occupied-agnostic) count of how many placements of each length
    // cover each cell -- used to order hit resolution "most constrained
    // first" without recomputing candidate sets just to decide which hit to
    // tackle. cover is Map(length -> Map(cellKey -> count)).
    const cover = new Map();
    for (const [length, placements] of validByLength) {
      const cc = new Map();
      for (const cells of placements) {
        for (const [r, c] of cells) {
          const k = key(r, c);
          cc.set(k, (cc.get(k) || 0) + 1);
        }
      }
      cover.set(length, cc);
    }

    const particles = [];
    let attempts = 0;
    const maxAttempts = Math.max(targetCount * 25, 20000);
    while (particles.length < targetCount && attempts < maxAttempts) {
      attempts++;
      if (attempts % 300 === 0 && performance.now() > deadline) break;
      const ships = this.tryBuildParticle(activeHits, validByLength, cover);
      if (ships !== null) particles.push(this.makeParticle(ships));
    }
    return particles;
  }

  tryBuildParticle(activeHits, validByLength, cover) {
    const occupied = new Set();
    const remaining = [...this.fleetSizes];
    const uncovered = new Set(activeHits);
    const ships = [];

    while (uncovered.size > 0) {
      // Resolve the MOST CONSTRAINED hit first -- the uncovered hit
      // reachable by the fewest legal ship placements (approximated cheaply
      // from the static cover index, weighted by how many ships of each
      // length remain). Committing to the hardest-to-satisfy hit early
      // prunes dead-end partial configurations that a fixed "first hit"
      // order would only discover after wasted work, cutting failed samples.
      let h = null;
      let hConstraint = Infinity;
      for (const cand of uncovered) {
        let total = 0;
        for (const length of remaining) total += cover.get(length).get(cand) || 0;
        if (total < hConstraint) {
          hConstraint = total;
          h = cand;
        }
      }
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
      const [length, cells] = this.weightedChoice(candidates);
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

  weightedChoice(candidates) {
    let total = 0;
    for (const [, , w] of candidates) total += w;
    let pick = Math.random() * total;
    for (const [length, cells, w] of candidates) {
      pick -= w;
      if (pick <= 0) return [length, cells];
    }
    return [candidates[candidates.length - 1][0], candidates[candidates.length - 1][1]];
  }

  makeParticle(ships) {
    const occupied = new Set();
    for (const cells of ships) for (const [r, c] of cells) occupied.add(key(r, c));
    return { ships, occupied };
  }

  pickFromPool(pool, occupied, quickTries = this.poolPickAttempts) {
    const n = pool.length;
    if (n === 0) return null;
    // Fast path: a few random draws. When the pool is mostly free (early
    // game) this almost always succeeds immediately and avoids scanning the
    // whole pool. Rejection sampling like this is uniform over legal cells.
    for (let i = 0; i < Math.min(quickTries, n); i++) {
      const cells = pool[randInt(n)];
      if (this.cellsFree(cells, occupied)) return cells;
    }
    // Correctness path: exhaustively collect legal placements so we never
    // return null while a legal placement still exists (late game, when
    // most of the pool is blocked). Also uniform over legal.
    const legal = pool.filter((cells) => this.cellsFree(cells, occupied));
    return legal.length ? choice(legal) : null;
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

/* ---------------- POMCPAI ---------------- */

/*
 * Research-inspired online planner based on POMCP (Partially Observable
 * Monte-Carlo Planning). Battleship is naturally a POMDP: the hidden state is
 * the complete enemy fleet, an action is a shot, and the observation is
 * miss/hit/sunk. POMCP samples a possible hidden fleet at the root of each
 * simulation and uses UCT/PUCT tree search over future action-observation
 * histories. This implementation is specialized for the 8x11 board and uses
 * a compact particle belief plus exact sunk-ship announcements from app.js.
 *
 * It deliberately keeps a separate class instead of replacing BayesianAI so
 * the benchmark can compare a greedy posterior policy with an online planner.
 */

const POMCP_CELL_BITS = Array.from({ length: ROWS * COLS }, (_, i) => 1n << BigInt(i));
const POMCP_FULL_MASK = (1n << BigInt(ROWS * COLS)) - 1n;
const POMCP_PLACEMENTS = new Map();

function pomcpIndex(r, c) {
  return r * COLS + c;
}

function pomcpMaskFromCells(cells) {
  let mask = 0n;
  for (const [r, c] of cells) mask |= POMCP_CELL_BITS[pomcpIndex(r, c)];
  return mask;
}

function pomcpPopcount(mask) {
  let n = 0;
  while (mask) {
    mask &= mask - 1n;
    n++;
  }
  return n;
}

function pomcpPlacements(length) {
  if (POMCP_PLACEMENTS.has(length)) return POMCP_PLACEMENTS.get(length);
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - length; c++) {
      const cells = shipCells(r, c, length, "H");
      out.push({ r, c, length, orientation: "H", cells, indices: cells.map(([rr, cc]) => pomcpIndex(rr, cc)), mask: pomcpMaskFromCells(cells) });
    }
  }
  for (let r = 0; r <= ROWS - length; r++) {
    for (let c = 0; c < COLS; c++) {
      const cells = shipCells(r, c, length, "V");
      out.push({ r, c, length, orientation: "V", cells, indices: cells.map(([rr, cc]) => pomcpIndex(rr, cc)), mask: pomcpMaskFromCells(cells) });
    }
  }
  POMCP_PLACEMENTS.set(length, out);
  return out;
}

class POMCPAI {
  constructor(fleetSizes, options = {}) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.options = {
      particles: options.particles ?? 500,
      minParticles: options.minParticles ?? 75,
      simulations: options.simulations ?? 36,
      horizon: options.horizon ?? 6,
      rootCandidates: options.rootCandidates ?? 12,
      nodeCandidates: options.nodeCandidates ?? 8,
      exploration: options.exploration ?? 1.25,
      maxNodeParticles: options.maxNodeParticles ?? 40,
      generationAttempts: options.generationAttempts ?? 14,
    };

    this.particles = [];
    this.sunkEvents = []; // [{length, mask, indices}]
    // Some tournament harnesses provide only the board, with no explicit
    // sunk callback. Until recordShotResult is observed, do not use the
    // negative inference "a fully-hit ship would have been announced sunk".
    this.resultFeedbackObserved = false;
    this.cachedSignature = null;
    this.cachedScores = null;
    this.lastBoardMasks = null;
    this.lastSearchStats = null;
  }

  /* Fast settings used by the 100-200 game browser benchmark. */
  static benchmark(fleetSizes) {
    return new POMCPAI(fleetSizes, {
      particles: 140,
      minParticles: 18,
      simulations: 10,
      horizon: 3,
      rootCandidates: 8,
      nodeCandidates: 5,
      maxNodeParticles: 16,
      generationAttempts: 5,
    });
  }

  /* app.js calls this after the result is known. Exact sunk information is a
   * legal Battleship observation and sharply improves the posterior. */
  recordShotResult({ sunkLength = null, sunkCells = null } = {}) {
    this.resultFeedbackObserved = true;
    if (!sunkLength || !Array.isArray(sunkCells) || sunkCells.length === 0) return;
    const indices = sunkCells.map(([r, c]) => pomcpIndex(r, c)).sort((a, b) => a - b);
    let mask = 0n;
    for (const idx of indices) mask |= POMCP_CELL_BITS[idx];
    if (this.sunkEvents.some((e) => e.mask === mask)) return;
    this.sunkEvents.push({ length: sunkLength, mask, indices });
    this.cachedSignature = null;
    this.cachedScores = null;
  }

  static signature(board, sunkEvents) {
    let s = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        s += board[r][c] === "hit" ? "H" : board[r][c] === "miss" ? "M" : ".";
      }
    }
    if (sunkEvents.length) s += "|" + sunkEvents.map((e) => `${e.length}:${e.mask.toString(16)}`).sort().join(";");
    return s;
  }

  boardMasks(board) {
    let hitMask = 0n;
    let missMask = 0n;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = pomcpIndex(r, c);
        if (board[r][c] === "hit") hitMask |= POMCP_CELL_BITS[idx];
        else if (board[r][c] === "miss") missMask |= POMCP_CELL_BITS[idx];
      }
    }
    let sunkMask = 0n;
    for (const e of this.sunkEvents) sunkMask |= e.mask;
    return { hitMask, missMask, shotMask: hitMask | missMask, sunkMask };
  }

  selectNextMove(board) {
    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (board[r][c] === null) unknown.push(pomcpIndex(r, c));
    }
    if (unknown.length === 0) throw new Error("No legal moves remain: board is full.");

    try {
      const { scores, masks } = this.prepareBelief(board);
      const ranked = unknown.sort((a, b) => scores[b] - scores[a]);
      const candidates = ranked.slice(0, Math.min(this.options.rootCandidates, ranked.length));
      if (candidates.length === 1 || this.particles.length < 2) {
        const idx = candidates[0] ?? choice(unknown);
        return [Math.floor(idx / COLS), idx % COLS];
      }

      const root = this.makeNode(candidates, scores, this.particles);
      for (let i = 0; i < this.options.simulations; i++) {
        const particle = this.particles[randInt(this.particles.length)];
        const simState = {
          hitMask: masks.hitMask,
          missMask: masks.missMask,
          shotMask: masks.shotMask,
          sunkMasks: new Set(this.sunkEvents.map((e) => e.mask.toString())),
        };
        this.simulate(root, particle, simState, this.options.horizon);
      }

      let best = candidates[0];
      let bestVisits = -1;
      let bestQ = -Infinity;
      for (const idx of candidates) {
        const stat = root.actions.get(idx);
        if (stat.n > bestVisits || (stat.n === bestVisits && stat.q > bestQ)) {
          best = idx;
          bestVisits = stat.n;
          bestQ = stat.q;
        }
      }
      this.lastSearchStats = { simulations: root.n, action: best, visits: bestVisits, value: bestQ };
      return [Math.floor(best / COLS), best % COLS];
    } catch (e) {
      const idx = choice(unknown);
      return [Math.floor(idx / COLS), idx % COLS];
    }
  }

  currentDensityMap(board) {
    try {
      const { scores } = this.prepareBelief(board);
      const map = new Map();
      for (let idx = 0; idx < ROWS * COLS; idx++) map.set(key(Math.floor(idx / COLS), idx % COLS), scores[idx]);
      return map;
    } catch (e) {
      const map = new Map();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) map.set(key(r, c), 0);
      return map;
    }
  }

  prepareBelief(board) {
    const signature = POMCPAI.signature(board, this.sunkEvents);
    if (signature === this.cachedSignature && this.cachedScores !== null && this.lastBoardMasks !== null) {
      return { scores: this.cachedScores, masks: this.lastBoardMasks };
    }

    const masks = this.boardMasks(board);
    this.filterParticles(masks);
    if (this.particles.length < this.options.minParticles) this.replenishParticles(masks);
    if (this.particles.length === 0) this.replenishParticles(masks, true);

    const scores = this.scoreBelief(this.particles, masks, this.options.rootCandidates);
    this.cachedSignature = signature;
    this.cachedScores = scores;
    this.lastBoardMasks = masks;
    return { scores, masks };
  }

  filterParticles(masks) {
    if (this.particles.length === 0) return;
    const eventByMask = new Set(this.sunkEvents.map((e) => e.mask.toString()));
    this.particles = this.particles.filter((p) => {
      if ((p.occupied & masks.missMask) !== 0n) return false;
      if ((p.occupied & masks.hitMask) !== masks.hitMask) return false;
      for (const e of this.sunkEvents) {
        if (!p.ships.some((ship) => ship.length === e.length && ship.mask === e.mask)) return false;
      }
      // Negative information matters too: if a hypothetical ship is already
      // fully hit, the game would have announced it sunk. Reject it unless it
      // is one of the exact announced sunk ships.
      if (this.resultFeedbackObserved) {
        for (const ship of p.ships) {
          if ((ship.mask & masks.hitMask) === ship.mask && !eventByMask.has(ship.mask.toString())) return false;
        }
      }
      return true;
    });
  }

  replenishParticles(masks, forceFull = false) {
    const target = forceFull ? this.options.particles : this.options.particles - this.particles.length;
    if (target <= 0) return;
    const fresh = this.generateParticles(masks, target);
    this.particles = forceFull ? fresh : this.particles.concat(fresh);
  }

  generateParticles(masks, targetCount) {
    const fixedShips = [];
    const remaining = [...this.fleetSizes];
    let fixedOccupied = 0n;

    for (const e of this.sunkEvents) {
      const idx = remaining.indexOf(e.length);
      if (idx === -1) return [];
      remaining.splice(idx, 1);
      const placement = pomcpPlacements(e.length).find((p) => p.mask === e.mask);
      if (!placement || (placement.mask & fixedOccupied) !== 0n) return [];
      fixedShips.push(placement);
      fixedOccupied |= placement.mask;
    }

    const pools = new Map();
    for (const length of new Set(remaining)) {
      pools.set(
        length,
        pomcpPlacements(length).filter((p) => (p.mask & masks.missMask) === 0n && (p.mask & fixedOccupied) === 0n)
      );
    }

    const activeHits = masks.hitMask & ~fixedOccupied;
    const out = [];
    const maxAttempts = Math.max(targetCount * this.options.generationAttempts, 800);

    for (let attempt = 0; attempt < maxAttempts && out.length < targetCount; attempt++) {
      const ships = fixedShips.slice();
      const sizes = remaining.slice();
      let occupied = fixedOccupied;
      let uncovered = activeHits;
      let failed = false;

      while (uncovered !== 0n && !failed) {
        let chosenBit = -1;
        let minChoices = Infinity;
        for (let idx = 0; idx < ROWS * COLS; idx++) {
          const bit = POMCP_CELL_BITS[idx];
          if ((uncovered & bit) === 0n) continue;
          let count = 0;
          for (const length of new Set(sizes)) {
            for (const p of pools.get(length) || []) {
              if ((p.mask & bit) !== 0n && (p.mask & occupied) === 0n) count++;
            }
          }
          if (count < minChoices) {
            minChoices = count;
            chosenBit = idx;
          }
        }
        if (chosenBit < 0 || minChoices === 0) {
          failed = true;
          break;
        }

        const bit = POMCP_CELL_BITS[chosenBit];
        const candidates = [];
        let totalWeight = 0;
        for (const length of new Set(sizes)) {
          const multiplicity = sizes.filter((x) => x === length).length;
          for (const p of pools.get(length) || []) {
            if ((p.mask & bit) === 0n || (p.mask & occupied) !== 0n) continue;
            const overlap = pomcpPopcount(p.mask & uncovered);
            const weight = multiplicity * overlap * overlap;
            candidates.push([p, weight]);
            totalWeight += weight;
          }
        }
        if (candidates.length === 0) {
          failed = true;
          break;
        }
        let pick = Math.random() * totalWeight;
        let selected = candidates[candidates.length - 1][0];
        for (const [p, w] of candidates) {
          pick -= w;
          if (pick <= 0) {
            selected = p;
            break;
          }
        }
        ships.push(selected);
        occupied |= selected.mask;
        uncovered &= ~selected.mask;
        sizes.splice(sizes.indexOf(selected.length), 1);
      }

      if (failed) continue;

      // Most constrained remaining length first reduces dead ends.
      while (sizes.length && !failed) {
        let bestLength = sizes[0];
        let bestLegal = null;
        for (const length of new Set(sizes)) {
          const legal = (pools.get(length) || []).filter((p) => (p.mask & occupied) === 0n);
          if (bestLegal === null || legal.length < bestLegal.length) {
            bestLength = length;
            bestLegal = legal;
          }
        }
        if (!bestLegal || bestLegal.length === 0) {
          failed = true;
          break;
        }
        const selected = bestLegal[randInt(bestLegal.length)];
        ships.push(selected);
        occupied |= selected.mask;
        sizes.splice(sizes.indexOf(bestLength), 1);
      }

      if (!failed) out.push({ ships, occupied });
    }
    return out;
  }

  /* Returns one score per board cell. The same posterior scoring is used as
   * a rollout policy and as a prior for PUCT. */
  scoreBelief(particles, masks) {
    const scores = new Float64Array(ROWS * COLS);
    if (!particles || particles.length === 0) return scores;
    const occ = new Uint32Array(ROWS * COLS);
    const active = new Uint32Array(ROWS * COLS);
    const sink = new Uint32Array(ROWS * COLS);
    const sunkSet = masks.sunkMasks instanceof Set ? masks.sunkMasks : new Set(this.sunkEvents.map((e) => e.mask.toString()));

    for (const particle of particles) {
      for (const ship of particle.ships) {
        if (sunkSet.has(ship.mask.toString())) continue;
        let hitCount = 0;
        const unknown = [];
        for (const idx of ship.indices) {
          const bit = POMCP_CELL_BITS[idx];
          if ((masks.hitMask & bit) !== 0n) hitCount++;
          else if ((masks.shotMask & bit) === 0n) unknown.push(idx);
        }
        for (const idx of unknown) occ[idx]++;
        if (hitCount > 0 && unknown.length > 0) {
          for (const idx of unknown) active[idx]++;
          if (unknown.length === 1) sink[unknown[0]]++;
        }
      }
    }

    let hasActive = false;
    for (let i = 0; i < active.length; i++) if (active[i] > 0) { hasActive = true; break; }
    const n = particles.length;
    for (let idx = 0; idx < scores.length; idx++) {
      if ((masks.shotMask & POMCP_CELL_BITS[idx]) !== 0n) {
        scores[idx] = -Infinity;
        continue;
      }
      const p = occ[idx] / n;
      if (hasActive) {
        scores[idx] = 8.0 * (active[idx] / n) + 4.0 * (sink[idx] / n) + 0.75 * p;
      } else {
        const information = 4 * p * (1 - p);
        scores[idx] = p + 0.12 * information;
      }
    }
    return scores;
  }

  makeNode(candidates, scores, particles = []) {
    const actions = new Map();
    let priorTotal = 0;
    const raw = [];
    for (const idx of candidates) {
      const value = Math.max(1e-6, Number.isFinite(scores[idx]) ? scores[idx] : 0);
      raw.push([idx, value]);
      priorTotal += value;
    }
    for (const [idx, value] of raw) {
      actions.set(idx, { n: 0, q: 0, prior: value / priorTotal, children: new Map() });
    }
    const seed = [];
    if (particles.length <= this.options.maxNodeParticles) {
      seed.push(...particles);
    } else {
      const used = new Set();
      while (seed.length < this.options.maxNodeParticles) {
        const i = randInt(particles.length);
        if (used.has(i)) continue;
        used.add(i);
        seed.push(particles[i]);
      }
    }
    return { n: 0, actions, particles: seed };
  }

  particleConsistentWithState(particle, state) {
    if ((particle.occupied & state.missMask) !== 0n) return false;
    if ((particle.occupied & state.hitMask) !== state.hitMask) return false;
    for (const sunk of state.sunkMasks) {
      const mask = BigInt(sunk);
      if (!particle.ships.some((ship) => ship.mask === mask)) return false;
    }
    if (this.resultFeedbackObserved) {
      for (const ship of particle.ships) {
        if ((ship.mask & state.hitMask) === ship.mask && !state.sunkMasks.has(ship.mask.toString())) return false;
      }
    }
    return true;
  }

  sampleBeliefForState(state, target = this.options.maxNodeParticles) {
    const out = [];
    if (this.particles.length === 0) return out;
    const maxTries = Math.min(this.particles.length * 2, target * 20);
    const seen = new Set();
    for (let tries = 0; tries < maxTries && out.length < target; tries++) {
      const i = randInt(this.particles.length);
      if (seen.has(i)) continue;
      seen.add(i);
      const p = this.particles[i];
      if (this.particleConsistentWithState(p, state)) out.push(p);
    }
    if (out.length < Math.min(8, target)) {
      for (let i = 0; i < this.particles.length && out.length < target; i++) {
        if (seen.has(i)) continue;
        const p = this.particles[i];
        if (this.particleConsistentWithState(p, state)) out.push(p);
      }
    }
    return out;
  }

  simulate(node, trueParticle, state, depth) {
    if (depth <= 0 || (trueParticle.occupied & ~state.shotMask) === 0n) {
      return this.leafValue(node.particles, trueParticle, state);
    }

    if (node.particles.length < this.options.maxNodeParticles) node.particles.push(trueParticle);
    if (node.actions.size === 0) {
      const scores = this.scoreBelief(node.particles.length ? node.particles : [trueParticle], {
        hitMask: state.hitMask,
        missMask: state.missMask,
        shotMask: state.shotMask,
        sunkMask: 0n,
        sunkMasks: state.sunkMasks,
      });
      const candidates = [];
      for (let idx = 0; idx < ROWS * COLS; idx++) if ((state.shotMask & POMCP_CELL_BITS[idx]) === 0n) candidates.push(idx);
      candidates.sort((a, b) => scores[b] - scores[a]);
      const fresh = this.makeNode(candidates.slice(0, this.options.nodeCandidates), scores, node.particles);
      node.actions = fresh.actions;
    }

    let selectedIdx = null;
    let selectedStat = null;
    let best = -Infinity;
    const sqrtN = Math.sqrt(node.n + 1);
    for (const [idx, stat] of node.actions) {
      if ((state.shotMask & POMCP_CELL_BITS[idx]) !== 0n) continue;
      const u = stat.q + this.options.exploration * stat.prior * sqrtN / (1 + stat.n);
      if (u > best) {
        best = u;
        selectedIdx = idx;
        selectedStat = stat;
      }
    }
    if (selectedIdx === null) return this.leafValue(node.particles, trueParticle, state);

    const { observation, nextState, immediate } = this.stepParticle(trueParticle, state, selectedIdx);
    let child = selectedStat.children.get(observation);
    let future;
    if (!child) {
      child = { n: 0, actions: new Map(), particles: [] };
      selectedStat.children.set(observation, child);
      future = this.rollout(child, trueParticle, nextState, depth - 1);
    } else {
      future = this.simulate(child, trueParticle, nextState, depth - 1);
    }
    const value = immediate + future;

    node.n++;
    selectedStat.n++;
    selectedStat.q += (value - selectedStat.q) / selectedStat.n;
    return value;
  }

  rollout(node, trueParticle, state, depth) {
    let value = 0;
    let current = state;
    for (let d = 0; d < depth; d++) {
      if ((trueParticle.occupied & ~current.shotMask) === 0n) return value;
      if (node.particles.length < this.options.maxNodeParticles) node.particles.push(trueParticle);
      const belief = node.particles.length ? node.particles : [trueParticle];
      const scores = this.scoreBelief(belief, {
        hitMask: current.hitMask,
        missMask: current.missMask,
        shotMask: current.shotMask,
        sunkMask: 0n,
        sunkMasks: current.sunkMasks,
      });
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let idx = 0; idx < scores.length; idx++) {
        if (scores[idx] > bestScore) {
          bestScore = scores[idx];
          bestIdx = idx;
        }
      }
      if (bestIdx < 0) break;
      const step = this.stepParticle(trueParticle, current, bestIdx);
      value += step.immediate;
      current = step.nextState;
    }
    return value + this.leafValue(node.particles, trueParticle, current);
  }

  stepParticle(particle, state, idx) {
    const bit = POMCP_CELL_BITS[idx];
    const hit = (particle.occupied & bit) !== 0n;
    const nextState = {
      hitMask: state.hitMask,
      missMask: state.missMask,
      shotMask: state.shotMask | bit,
      sunkMasks: new Set(state.sunkMasks),
    };
    let observation = "M";
    let immediate = -1;

    if (hit) {
      nextState.hitMask |= bit;
      observation = "H";
      immediate += 1.2; // finite-horizon shaping: reward progress toward terminal
      const ship = particle.ships.find((s) => (s.mask & bit) !== 0n);
      if (ship && (ship.mask & nextState.hitMask) === ship.mask && !nextState.sunkMasks.has(ship.mask.toString())) {
        nextState.sunkMasks.add(ship.mask.toString());
        observation = `S${ship.length}:${ship.mask.toString(16)}`;
        immediate += 2.2;
      }
    } else {
      nextState.missMask |= bit;
    }

    if ((particle.occupied & ~nextState.shotMask) === 0n) immediate += 12;
    return { observation, nextState, immediate };
  }

  leafValue(belief, trueParticle, state) {
    const remaining = pomcpPopcount(trueParticle.occupied & ~state.shotMask);
    if (remaining === 0) return 0;
    if (!belief || belief.length === 0) return -remaining;

    // Estimate search difficulty from the best posterior hit probability.
    const scores = this.scoreBelief(belief, {
      hitMask: state.hitMask,
      missMask: state.missMask,
      shotMask: state.shotMask,
      sunkMask: 0n,
      sunkMasks: state.sunkMasks,
    });
    let best = 0;
    for (const s of scores) if (Number.isFinite(s) && s > best) best = s;
    const effectiveP = Math.max(0.18, Math.min(1, best));
    return -remaining / effectiveP;
  }
}


/* ---------------- HybridAI (trained policy + exact belief + POMCP) ---------------- */

/*
 * HybridAI keeps the legal, interpretable POMCP belief, then adds a tiny
 * self-play-trained linear policy. The model never invents moves: it only
 * ranks legal cells using posterior features, and POMCP searches the best
 * ranked candidates. In constrained late games it attempts exact fleet
 * enumeration before falling back to particles.
 *
 * policy_model.json is optional. DEFAULT_HYBRID_MODEL is embedded so a
 * tournament runner that accepts only ai.js still gets the same algorithm.
 */
const HYBRID_FEATURE_NAMES = [
  "bias",
  "occupancy",
  "information",
  "center",
  "edge",
  "parity",
  "neighbor_occupancy",
  "placement_prior",
  "adjacent_hits",
  "line_extension",
  "sink_probability",
  "active_ship_probability",
];

const DEFAULT_HYBRID_MODEL = {
  version: 1,
  name: "hybrid-cem-v1",
  feature_names: HYBRID_FEATURE_NAMES,
  // Seeded from probability theory, then tuned by train_hybrid.js self-play.
  hunt_weights: [0.0, 1.0, 0.0, 0.0, 0.0, 0.12, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  target_weights: [0.0, 0.75, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 5.5, 8.0],
  cell_prior: Array.from({ length: ROWS * COLS }, () => 0.5),
  training: { method: "held-out grid self-play", games: 160, note: "embedded tournament-safe fallback; parity=0.12, sink=5.5" },
};

let HYBRID_MODEL = JSON.parse(JSON.stringify(DEFAULT_HYBRID_MODEL));

function validateHybridModel(model) {
  if (!model || !Array.isArray(model.hunt_weights) || !Array.isArray(model.target_weights)) return false;
  if (model.hunt_weights.length !== HYBRID_FEATURE_NAMES.length) return false;
  if (model.target_weights.length !== HYBRID_FEATURE_NAMES.length) return false;
  if (model.cell_prior && model.cell_prior.length !== ROWS * COLS) return false;
  return model.hunt_weights.every(Number.isFinite) && model.target_weights.every(Number.isFinite);
}

function setHybridModel(model) {
  if (!validateHybridModel(model)) return false;
  HYBRID_MODEL = {
    ...DEFAULT_HYBRID_MODEL,
    ...model,
    feature_names: HYBRID_FEATURE_NAMES,
    hunt_weights: [...model.hunt_weights],
    target_weights: [...model.target_weights],
    cell_prior: Array.isArray(model.cell_prior) ? [...model.cell_prior] : [...DEFAULT_HYBRID_MODEL.cell_prior],
  };
  return true;
}

async function loadHybridModel(url = "policy_model.json") {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return false;
    return setHybridModel(await response.json());
  } catch (error) {
    return false;
  }
}

class HybridAI extends POMCPAI {
  constructor(fleetSizes, options = {}) {
    super(fleetSizes, {
      particles: options.particles ?? 900,
      minParticles: options.minParticles ?? 120,
      simulations: options.simulations ?? 72,
      horizon: options.horizon ?? 7,
      rootCandidates: options.rootCandidates ?? 12,
      nodeCandidates: options.nodeCandidates ?? 8,
      exploration: options.exploration ?? 1.18,
      maxNodeParticles: options.maxNodeParticles ?? 56,
      generationAttempts: options.generationAttempts ?? 18,
    });
    this.deadlineMs = options.deadlineMs ?? 2650;
    this.exactUnknownThreshold = options.exactUnknownThreshold ?? 34;
    this.exactMaxParticles = options.exactMaxParticles ?? 24000;
    this.exactBudgetMs = options.exactBudgetMs ?? 220;
    this.enablePlanning = options.enablePlanning ?? true;
    this.model = options.model && validateHybridModel(options.model) ? options.model : HYBRID_MODEL;
    this.exactCache = new Map();
    this.lastMode = "particle";
  }

  static benchmark(fleetSizes) {
    return new HybridAI(fleetSizes, {
      particles: 190,
      minParticles: 28,
      simulations: 0,
      horizon: 4,
      rootCandidates: 9,
      nodeCandidates: 6,
      maxNodeParticles: 22,
      generationAttempts: 7,
      deadlineMs: 90,
      exactUnknownThreshold: 23,
      exactMaxParticles: 5000,
      exactBudgetMs: 12,
      enablePlanning: false,
    });
  }

  static policyOnly(fleetSizes, model = HYBRID_MODEL) {
    return new HybridAI(fleetSizes, {
      particles: 150,
      minParticles: 24,
      simulations: 0,
      horizon: 1,
      rootCandidates: 10,
      nodeCandidates: 5,
      generationAttempts: 6,
      deadlineMs: 50,
      exactUnknownThreshold: 19,
      exactMaxParticles: 2500,
      exactBudgetMs: 5,
      enablePlanning: false,
      model,
    });
  }

  selectNextMove(board) {
    const started = performance.now();
    const hardDeadline = started + Math.max(10, this.deadlineMs);
    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (board[r][c] === null) unknown.push(pomcpIndex(r, c));
    }
    if (unknown.length === 0) throw new Error("No legal moves remain: board is full.");

    // A valid answer is maintained from the first millisecond. Any timeout or
    // internal error returns this rather than triggering the tournament's
    // random fallback.
    let bestLegal = unknown[0];
    try {
      const { scores, masks } = this.prepareBelief(board, hardDeadline);
      const ranked = unknown.slice().sort((a, b) => scores[b] - scores[a]);
      if (ranked.length) bestLegal = ranked[0];
      const candidates = ranked.slice(0, Math.min(this.options.rootCandidates, ranked.length));

      if (!this.enablePlanning || this.options.simulations <= 0 || candidates.length <= 1 || this.particles.length < 2) {
        return [Math.floor(bestLegal / COLS), bestLegal % COLS];
      }

      const root = this.makeNode(candidates, scores, this.particles);
      let simulations = 0;
      while (simulations < this.options.simulations && performance.now() < hardDeadline - 3) {
        const particle = this.particles[randInt(this.particles.length)];
        const simState = {
          hitMask: masks.hitMask,
          missMask: masks.missMask,
          shotMask: masks.shotMask,
          sunkMasks: new Set(this.sunkEvents.map((event) => event.mask.toString())),
        };
        this.simulate(root, particle, simState, this.options.horizon);
        simulations++;
      }

      // The learned posterior policy is already strong. Planning is allowed
      // to override it only when the searched value is clearly better; this
      // prevents a small, noisy tree from making the hybrid weaker than its
      // own trained fallback.
      const policyBest = bestLegal;
      const policyStat = root.actions.get(policyBest);
      let plannedBest = policyBest;
      let plannedQ = policyStat?.q ?? -Infinity;
      let plannedVisits = policyStat?.n ?? 0;
      for (const idx of candidates) {
        const stat = root.actions.get(idx);
        if (!stat || stat.n < 2) continue;
        if (stat.q > plannedQ) {
          plannedBest = idx;
          plannedQ = stat.q;
          plannedVisits = stat.n;
        }
      }
      const policyQ = policyStat?.q ?? -Infinity;
      if (plannedBest !== policyBest && plannedVisits >= 3 && plannedQ > policyQ + 0.35) {
        bestLegal = plannedBest;
      }
      this.lastSearchStats = { simulations, action: bestLegal, visits: plannedVisits, value: plannedQ, mode: this.lastMode };
    } catch (error) {
      // bestLegal is guaranteed to remain an unknown cell.
    }
    return [Math.floor(bestLegal / COLS), bestLegal % COLS];
  }

  prepareBelief(board, hardDeadline = performance.now() + this.deadlineMs) {
    const signature = POMCPAI.signature(board, this.sunkEvents);
    if (signature === this.cachedSignature && this.cachedScores !== null && this.lastBoardMasks !== null) {
      return { scores: this.cachedScores, masks: this.lastBoardMasks };
    }

    const masks = this.boardMasks(board);
    this.filterParticles(masks);
    const unknownCount = ROWS * COLS - pomcpPopcount(masks.shotMask);
    let exact = null;
    if (unknownCount <= this.exactUnknownThreshold && performance.now() < hardDeadline - 8) {
      exact = this.tryExactEnumeration(masks, signature, Math.min(hardDeadline - 5, performance.now() + this.exactBudgetMs));
    }

    if (exact && exact.complete && exact.particles.length) {
      this.particles = exact.particles;
      this.lastMode = "exact";
    } else {
      if (this.particles.length < this.options.minParticles && performance.now() < hardDeadline - 5) this.replenishParticles(masks);
      if (this.particles.length === 0 && performance.now() < hardDeadline - 5) this.replenishParticles(masks, true);
      this.lastMode = "particle";
    }

    const scores = this.scoreBelief(this.particles, masks);
    this.cachedSignature = signature;
    this.cachedScores = scores;
    this.lastBoardMasks = masks;
    return { scores, masks };
  }

  tryExactEnumeration(masks, signature, deadline) {
    if (this.exactCache.has(signature)) return this.exactCache.get(signature);

    const fixedShips = [];
    const remaining = [...this.fleetSizes];
    let fixedOccupied = 0n;
    for (const event of this.sunkEvents) {
      const sizeIndex = remaining.indexOf(event.length);
      if (sizeIndex < 0) return null;
      remaining.splice(sizeIndex, 1);
      const placement = pomcpPlacements(event.length).find((p) => p.mask === event.mask);
      if (!placement || (placement.mask & fixedOccupied) !== 0n) return null;
      fixedShips.push(placement);
      fixedOccupied |= placement.mask;
    }

    const activeHits = masks.hitMask & ~fixedOccupied;
    const slots = remaining.slice().sort((a, b) => b - a);
    const pools = slots.map((length) => pomcpPlacements(length).filter((placement) =>
      (placement.mask & masks.missMask) === 0n && (placement.mask & fixedOccupied) === 0n
    ));
    const particles = [];
    let complete = true;

    const suffixCover = new Array(slots.length + 1).fill(0n);
    for (let i = slots.length - 1; i >= 0; i--) {
      let union = suffixCover[i + 1];
      for (const placement of pools[i]) union |= placement.mask;
      suffixCover[i] = union;
    }

    const dfs = (slot, occupied, coveredHits, ships, previousSameIndex) => {
      if (performance.now() >= deadline || particles.length >= this.exactMaxParticles) {
        complete = false;
        return;
      }
      const uncovered = activeHits & ~coveredHits;
      if ((uncovered & ~suffixCover[slot]) !== 0n) return;
      if (slot === slots.length) {
        if (uncovered !== 0n) return;
        const allShips = fixedShips.concat(ships);
        if (this.resultFeedbackObserved) {
          const announced = new Set(this.sunkEvents.map((event) => event.mask.toString()));
          for (const ship of allShips) {
            if ((ship.mask & masks.hitMask) === ship.mask && !announced.has(ship.mask.toString())) return;
          }
        }
        particles.push({ ships: allShips, occupied });
        return;
      }

      const length = slots[slot];
      const sameAsPrevious = slot > 0 && slots[slot - 1] === length;
      const startIndex = sameAsPrevious ? previousSameIndex + 1 : 0;
      const pool = pools[slot];
      for (let i = startIndex; i < pool.length; i++) {
        const placement = pool[i];
        if ((placement.mask & occupied) !== 0n) continue;
        dfs(slot + 1, occupied | placement.mask, coveredHits | placement.mask, ships.concat(placement), i);
        if (!complete) return;
      }
    };

    dfs(0, fixedOccupied, fixedOccupied & masks.hitMask, [], -1);
    const result = { complete, particles };
    if (complete) {
      this.exactCache.set(signature, result);
      if (this.exactCache.size > 8) this.exactCache.delete(this.exactCache.keys().next().value);
    }
    return result;
  }

  activeHitMask(masks) {
    let sunkMask = 0n;
    for (const event of this.sunkEvents) sunkMask |= event.mask;
    return masks.hitMask & ~sunkMask;
  }

  static dot(weights, features) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i] * features[i];
    return total;
  }

  scoreBelief(particles, masks) {
    const scores = new Float64Array(ROWS * COLS);
    if (!particles || particles.length === 0) return scores;

    const occupancy = new Uint32Array(ROWS * COLS);
    const active = new Uint32Array(ROWS * COLS);
    const sink = new Uint32Array(ROWS * COLS);
    const announced = masks.sunkMasks instanceof Set
      ? masks.sunkMasks
      : new Set(this.sunkEvents.map((event) => event.mask.toString()));

    for (const particle of particles) {
      for (const ship of particle.ships) {
        if (announced.has(ship.mask.toString())) continue;
        let hitCount = 0;
        const unknown = [];
        for (const idx of ship.indices) {
          const bit = POMCP_CELL_BITS[idx];
          if ((masks.hitMask & bit) !== 0n) hitCount++;
          else if ((masks.shotMask & bit) === 0n) unknown.push(idx);
        }
        for (const idx of unknown) occupancy[idx]++;
        if (hitCount > 0 && unknown.length > 0) {
          for (const idx of unknown) active[idx]++;
          if (unknown.length === 1) sink[unknown[0]]++;
        }
      }
    }

    const n = particles.length;
    const activeHits = this.activeHitMask(masks);
    let hasActive = false;
    for (const value of active) if (value > 0) { hasActive = true; break; }

    const remainingSizes = [...this.fleetSizes];
    for (const event of this.sunkEvents) {
      const index = remainingSizes.indexOf(event.length);
      if (index >= 0) remainingSizes.splice(index, 1);
    }
    const minRemaining = Math.max(2, Math.min(...remainingSizes, 2));
    const prior = Array.isArray(this.model.cell_prior) ? this.model.cell_prior : DEFAULT_HYBRID_MODEL.cell_prior;

    for (let idx = 0; idx < ROWS * COLS; idx++) {
      const bit = POMCP_CELL_BITS[idx];
      if ((masks.shotMask & bit) !== 0n) {
        scores[idx] = -Infinity;
        continue;
      }
      const r = Math.floor(idx / COLS);
      const c = idx % COLS;
      const p = occupancy[idx] / n;
      const a = active[idx] / n;
      const s = sink[idx] / n;
      const information = 4 * p * (1 - p);
      const centerDistance = Math.abs(r - (ROWS - 1) / 2) / ((ROWS - 1) / 2) + Math.abs(c - (COLS - 1) / 2) / ((COLS - 1) / 2);
      const center = Math.max(0, 1 - centerDistance / 2);
      const edgeDistance = Math.min(r, ROWS - 1 - r, c, COLS - 1 - c);
      const edge = 1 - edgeDistance / Math.max(1, Math.min((ROWS - 1) / 2, (COLS - 1) / 2));
      const parity = (r + c) % minRemaining === 0 ? 1 : 0;

      let neighborTotal = 0;
      let neighborCount = 0;
      let adjacentHits = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        const neighborIdx = pomcpIndex(rr, cc);
        neighborTotal += occupancy[neighborIdx] / n;
        neighborCount++;
        if ((activeHits & POMCP_CELL_BITS[neighborIdx]) !== 0n) adjacentHits++;
      }
      const neighborOccupancy = neighborCount ? neighborTotal / neighborCount : 0;

      const contiguous = (dr, dc) => {
        let count = 0;
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
          const neighborIdx = pomcpIndex(rr, cc);
          if ((activeHits & POMCP_CELL_BITS[neighborIdx]) === 0n) break;
          count++;
          rr += dr;
          cc += dc;
        }
        return count;
      };
      const horizontal = contiguous(0, -1) + contiguous(0, 1);
      const vertical = contiguous(-1, 0) + contiguous(1, 0);
      const lineExtension = Math.min(1, Math.max(horizontal, vertical) / 3);

      const features = [
        1,
        p,
        information,
        center,
        edge,
        parity,
        neighborOccupancy,
        Number.isFinite(prior[idx]) ? prior[idx] : 0.5,
        Math.min(1, adjacentHits / 2),
        lineExtension,
        s,
        a,
      ];
      const weights = hasActive ? this.model.target_weights : this.model.hunt_weights;
      const raw = HybridAI.dot(weights, features);
      scores[idx] = Math.max(1e-8, raw);
    }
    return scores;
  }
}


/* ---------------- PlacementAI ---------------- */

/*
 * Strong placement is a MIXED strategy, not one fixed layout. layouts.json is
 * produced by optimize_placement.js, which evolves legal fleets against an
 * ensemble of attack policies and solves a finite maximin linear program for
 * the sampling weights. The aggregate occupancy constraints stop the mixed
 * strategy from developing obvious hot cells.
 *
 * At runtime the adversarial strategy can also use prior firing sequences from
 * this browser. That adaptation never makes a layout deterministic: historical
 * performance only tilts the maximin weights, and recent layouts are penalized
 * so a repeat opponent cannot memorize one board.
 */
let OPTIMIZED_LAYOUTS = null; // [{id, weight, robustScore, layout:[ship,...]}]
let OPTIMIZED_LAYOUT_META = null;

function normalizeLoadedLayout(rawLayout) {
  return rawLayout
    .map((item) => {
      if (Array.isArray(item)) {
        const [r, c, length, orientation] = item;
        return { r, c, length, orientation };
      }
      return { r: item.r, c: item.c, length: item.length, orientation: item.orientation };
    })
    .sort((a, b) => b.length - a.length || a.r - b.r || a.c - b.c);
}

async function loadOptimizedLayouts(url = "layouts.json") {
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return false;
    const data = await resp.json();
    const raw = data.layouts || [];
    const entries = raw.map((item, i) => {
      // Schema 2 stores metadata per layout. Schema 1 was a plain array and is
      // still accepted so older layout pools remain usable.
      const layoutRaw = Array.isArray(item) ? item : item.layout;
      return {
        id: item.id || `layout-${i + 1}`,
        weight: Number.isFinite(item.weight) ? Math.max(0, item.weight) : 1,
        robustScore: Number.isFinite(item.robust_score) ? item.robust_score : null,
        expectedShots: Number.isFinite(item.expected_shots) ? item.expected_shots : null,
        layout: normalizeLoadedLayout(layoutRaw),
      };
    }).filter((x) => x.layout.length > 0);
    if (!entries.length) return false;
    const total = entries.reduce((sum, x) => sum + x.weight, 0) || entries.length;
    for (const entry of entries) entry.weight = (entry.weight || 1) / total;
    OPTIMIZED_LAYOUTS = entries;
    OPTIMIZED_LAYOUT_META = data;
    return true;
  } catch (e) {
    OPTIMIZED_LAYOUTS = null;
    OPTIMIZED_LAYOUT_META = null;
    return false;
  }
}

function weightedEntryChoice(entries, weights) {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (!(total > 0)) return choice(entries);
  let x = Math.random() * total;
  for (let i = 0; i < entries.length; i++) {
    x -= Math.max(0, weights[i]);
    if (x <= 0) return entries[i];
  }
  return entries[entries.length - 1];
}

class PlacementAI {
  constructor({
    restarts = 10,
    gamesPerCandidate = 3,
    strategy = "adversarial",
    shotHistory = [],
    recentLayoutIds = [],
    adaptationStrength = 1.35,
  } = {}) {
    this.restarts = restarts;
    this.gamesPerCandidate = gamesPerCandidate;
    this.strategy = strategy;
    this.shotHistory = Array.isArray(shotHistory) ? shotHistory.slice(-30) : [];
    this.recentLayoutIds = Array.isArray(recentLayoutIds) ? recentLayoutIds.slice(-12) : [];
    this.adaptationStrength = adaptationStrength;
    this.lastSelection = null;
  }

  static poolInfo() {
    return OPTIMIZED_LAYOUTS
      ? {
          loaded: true,
          count: OPTIMIZED_LAYOUTS.length,
          method: OPTIMIZED_LAYOUT_META?.method || "optimized mixed strategy",
          maximinValue: OPTIMIZED_LAYOUT_META?.maximin_value ?? null,
          occupancy: OPTIMIZED_LAYOUT_META?.occupancy ?? null,
        }
      : { loaded: false, count: 0 };
  }

  matchingPool(sizes) {
    if (!OPTIMIZED_LAYOUTS || !OPTIMIZED_LAYOUTS.length) return [];
    const wanted = [...sizes].sort((a, b) => a - b).join(",");
    return OPTIMIZED_LAYOUTS.filter(
      (entry) => entry.layout.map((s) => s.length).sort((a, b) => a - b).join(",") === wanted
    );
  }

  placeShips(fleetSizes) {
    const sizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    if (this.strategy === "random") {
      const layout = this.randomLegalLayout(sizes);
      this.lastSelection = { strategy: "random", id: null };
      return layout;
    }

    const pool = this.matchingPool(sizes);
    if (pool.length && (this.strategy === "adversarial" || this.strategy === "uniform")) {
      const entry = this.strategy === "uniform" ? choice(pool) : this.chooseAdversarial(pool);
      this.lastSelection = {
        strategy: this.strategy,
        id: entry.id,
        baseWeight: entry.weight,
        robustScore: entry.robustScore,
        adaptiveScore: this.strategy === "adversarial" ? this._lastAdaptiveScore ?? null : null,
      };
      return entry.layout.map((s) => ({ ...s }));
    }

    // "live" and all pool-loading failures use the original game-based search.
    const layout = this.liveSearch(sizes);
    this.lastSelection = { strategy: "live", id: null };
    return layout;
  }

  chooseAdversarial(pool) {
    const rawScores = pool.map((entry) => this.historySurvivalScore(entry.layout));
    const mean = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
    const variance = rawScores.reduce((a, b) => a + (b - mean) ** 2, 0) / rawScores.length;
    const sd = Math.sqrt(variance) || 1;
    const recent = [...this.recentLayoutIds].reverse();

    const weights = pool.map((entry, i) => {
      const z = (rawScores[i] - mean) / sd;
      let recencyFactor = 1;
      const age = recent.indexOf(entry.id);
      if (age >= 0 && age < 3) recencyFactor = 0.06;
      else if (age >= 0 && age < 7) recencyFactor = 0.28;
      else if (age >= 0) recencyFactor = 0.65;

      // Keep a 22% untouchable maximin component so sparse or noisy user
      // history cannot collapse the strategy into a predictable response.
      const adaptive = Math.exp(this.adaptationStrength * Math.max(-2.5, Math.min(2.5, z)));
      return entry.weight * recencyFactor * (0.22 + 0.78 * adaptive);
    });
    const selected = weightedEntryChoice(pool, weights);
    const selectedIndex = pool.indexOf(selected);
    this._lastAdaptiveScore = selectedIndex >= 0 ? rawScores[selectedIndex] : null;
    return selected;
  }

  historySurvivalScore(layout) {
    if (!this.shotHistory.length) return 0;
    const occupied = new Set();
    for (const ship of layout) {
      for (const [r, c] of shipCells(ship.r, ship.c, ship.length, ship.orientation)) occupied.add(r * COLS + c);
    }

    let total = 0;
    let totalWeight = 0;
    const histories = this.shotHistory.slice(-24);
    for (let g = 0; g < histories.length; g++) {
      const record = histories[g];
      const shots = Array.isArray(record) ? record : record?.shots;
      if (!Array.isArray(shots) || !shots.length) continue;
      const rank = new Map();
      shots.forEach((idx, i) => rank.set(Number(idx), i + 1));
      const unseenRank = Math.min(ROWS * COLS, shots.length + 16);
      let lastRequired = 0;
      let earlyExposure = 0;
      for (const idx of occupied) {
        const r = rank.get(idx) ?? unseenRank;
        lastRequired = Math.max(lastRequired, r);
        if (rank.has(idx)) earlyExposure += Math.exp(-(r - 1) / 15);
      }
      const survival = lastRequired / ROWS * COLS;
      const danger = earlyExposure / 17;
      const recency = 0.35 + 0.65 * ((g + 1) / histories.length);
      total += recency * (1.15 * survival - 0.55 * danger);
      totalWeight += recency;
    }
    return totalWeight ? total / totalWeight : 0;
  }

  liveSearch(sizes) {
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
/*
 * Minimal tournament-facing wrapper around HybridAI.
 *
 * Adapt the exported names to the instructor's required interface. The core
 * algorithm itself is in ai.js. This wrapper supports both common harnesses:
 *   1. board-only: call nextShot(board) each turn;
 *   2. callback: also call reportShotResult(result) after resolving the shot.
 */

let tournamentAI = new HybridAI(STANDARD_FLEET_SIZES, {
  deadlineMs: 2650, // safety margin below the 3-second tournament limit
});

function resetTournamentAI() {
  tournamentAI = new HybridAI(STANDARD_FLEET_SIZES, { deadlineMs: 2650 });
}

function normalizeTournamentBoard(board) {
  if (!Array.isArray(board) || board.length !== ROWS) {
    throw new Error(`Expected a ${ROWS}x${COLS} board.`);
  }
  return board.map((row) => {
    if (!Array.isArray(row) || row.length !== COLS) {
      throw new Error(`Expected a ${ROWS}x${COLS} board.`);
    }
    return row.map((cell) => {
      // Add aliases here if the tournament uses numeric or differently named
      // states. Unknown must become null; fired water becomes "miss"; fired
      // ship cells become "hit".
      if (cell === null || cell === undefined || cell === "unknown" || cell === 0) return null;
      if (cell === "miss" || cell === "M" || cell === -1) return "miss";
      if (cell === "hit" || cell === "sunk" || cell === "H" || cell === 1) return "hit";
      throw new Error(`Unrecognized board cell: ${String(cell)}`);
    });
  });
}

function nextShot(board) {
  const normalized = normalizeTournamentBoard(board);
  const [row, col] = tournamentAI.selectNextMove(normalized);
  return { row, col }; // Change to [row, col] if that is the required format.
}

function reportShotResult({ row, col, hit, sunkLength = null, sunkCells = null }) {
  tournamentAI.recordShotResult({ row, col, hit, sunkLength, sunkCells });
}

// Browser/global exports. Replace with module.exports/export statements if the
// assignment runner uses CommonJS or ES modules.
globalThis.nextShot = nextShot;
globalThis.reportShotResult = reportShotResult;
globalThis.resetTournamentAI = resetTournamentAI;
