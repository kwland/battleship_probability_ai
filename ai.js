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
  constructor(fleetSizes) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.remainingSizes = [...this.fleetSizes];
    this.resolvedSunkCells = new Set();
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
      this.updateSunkShips(board);

      let density = this.computeDensity(board, false);

      const hitCells = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (board[r][c] === "hit" && !this.resolvedSunkCells.has(key(r, c))) {
            hitCells.push([r, c]);
          }
        }
      }

      if (hitCells.length > 0) {
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
    this.updateSunkShips(board);
    let density = this.computeDensity(board, false);
    const hitCells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "hit" && !this.resolvedSunkCells.has(key(r, c))) hitCells.push([r, c]);
      }
    }
    if (hitCells.length > 0) {
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

  computeDensity(board, requireHit) {
    const density = new Map();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) density.set(key(r, c), 0);
    }

    const lengths = new Set(this.remainingSizes);
    for (const length of lengths) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= COLS - length; c++) {
          const cells = [];
          for (let i = 0; i < length; i++) cells.push([r, c + i]);
          this.scorePlacement(cells, board, density, requireHit);
        }
      }
      for (let r = 0; r <= ROWS - length; r++) {
        for (let c = 0; c < COLS; c++) {
          const cells = [];
          for (let i = 0; i < length; i++) cells.push([r + i, c]);
          this.scorePlacement(cells, board, density, requireHit);
        }
      }
    }
    return density;
  }

  scorePlacement(cells, board, density, requireHit) {
    let hasHit = false;
    for (const [r, c] of cells) {
      const state = board[r][c];
      const k = key(r, c);
      if (state === "miss" || this.resolvedSunkCells.has(k)) return;
      if (state === "hit") hasHit = true;
    }
    if (requireHit && !hasHit) return;
    for (const [r, c] of cells) {
      const k = key(r, c);
      density.set(k, density.get(k) + 1);
    }
  }

  updateSunkShips(board) {
    const runCells = (r, c, dr, dc) => {
      const cells = [];
      let rr = r,
        cc = c;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === "hit") {
        cells.push([rr, cc]);
        rr += dr;
        cc += dc;
      }
      return cells;
    };
    const isCapped = ([rr, cc]) => {
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) return true;
      return board[rr][cc] === "miss";
    };
    const maybeMarkSunk = (cells, before, after) => {
      const length = cells.length;
      const idx = this.remainingSizes.indexOf(length);
      if (idx === -1) return;
      if (isCapped(before) && isCapped(after)) {
        this.remainingSizes.splice(idx, 1);
        for (const [r, c] of cells) this.resolvedSunkCells.add(key(r, c));
      }
    };

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== "hit" || this.resolvedSunkCells.has(key(r, c))) continue;
        if (c === 0 || board[r][c - 1] !== "hit") {
          const cells = runCells(r, c, 0, 1);
          const before = [r, c - 1];
          const last = cells[cells.length - 1];
          const after = [last[0], last[1] + 1];
          maybeMarkSunk(cells, before, after);
        }
        if (r === 0 || board[r - 1][c] !== "hit") {
          const cells = runCells(r, c, 1, 0);
          const before = [r - 1, c];
          const last = cells[cells.length - 1];
          const after = [last[0] + 1, last[1]];
          maybeMarkSunk(cells, before, after);
        }
      }
    }
  }
}

/* ---------------- BayesianAI ---------------- */

const BAYES_TIME_BUDGET_MS = 3000;
const BAYES_SAFETY_MARGIN_MS = 500;
const BAYES_SOFT_TIME_BUDGET_MS = 500;
const BAYES_MAX_SAMPLES = 1500;
const BAYES_MAX_TOTAL_ATTEMPTS = 60000;
const BAYES_MAX_POOL_PICK_ATTEMPTS = 40;

class BayesianAI {
  /*
   * Shot-selection AI using Monte Carlo configuration-space sampling to
   * approximate the true Bayesian posterior probability that each cell
   * holds a ship, given the remaining fleet and the board's hit/miss
   * history.
   *
   * Exact enumeration of every way the whole remaining fleet could be
   * arranged is combinatorially infeasible even on this small 88-cell
   * board, so this samples instead: each sample is one complete,
   * internally consistent arrangement of every remaining ship -- no two
   * ships overlap, none crosses a confirmed miss or an already-sunk
   * ship's cells, and every unresolved hit cell is covered by exactly one
   * of the sampled ships. Tallying which cells appear across thousands of
   * such valid samples gives a much sharper, *jointly* consistent
   * probability estimate than scoring each ship length in isolation (see
   * ProbabilityAI): it correctly accounts for ships blocking each other
   * and for multiple simultaneous hit clusters needing to be explained by
   * different ships at once.
   *
   * Sampling a configuration:
   *   Phase A -- cover every currently unresolved hit. Repeatedly pick an
   *   uncovered hit cell, enumerate every (remaining ship length,
   *   placement) pair that legally covers it, and pick one at random.
   *   This is what lets the AI reason "a length-4 ship covering both of
   *   these hits, with a gap between them, is possible" without any
   *   hardcoded direction logic -- the placement enumeration naturally
   *   allows it.
   *   Phase B -- place whatever ships are left (not needed to explain a
   *   hit) at random legal positions in the remaining free space, drawn
   *   from a precomputed pool of legal placements (not blind random
   *   guesses across the whole board) so sampling stays fast even
   *   late-game when most coordinates are already known misses.
   */

  constructor(fleetSizes) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.remainingSizes = [...this.fleetSizes];
    this.resolvedSunkCells = new Set();
  }

  selectNextMove(board) {
    const start = performance.now();

    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === null) unknown.push([r, c]);
      }
    }
    if (unknown.length === 0) throw new Error("No legal moves remain: board is full.");

    try {
      this.updateSunkShips(board);

      if (BAYES_TIME_BUDGET_MS - (performance.now() - start) < BAYES_SAFETY_MARGIN_MS) {
        return choice(unknown);
      }

      let { density, samples } = this.sampleDensity(board, start);
      if (samples === 0) density = this.fallbackDensity(board);

      let bestScore = -1;
      for (const [r, c] of unknown) {
        const d = density.get(key(r, c));
        if (d > bestScore) bestScore = d;
      }
      const bestCells = unknown.filter(([r, c]) => density.get(key(r, c)) === bestScore);
      return choice(bestCells);
    } catch (e) {
      return choice(unknown);
    }
  }

  /** Exposed so the UI can render a live heatmap of the AI's current thinking. */
  currentDensityMap(board) {
    const start = performance.now();
    this.updateSunkShips(board);
    let { density, samples } = this.sampleDensity(board, start);
    if (samples === 0) density = this.fallbackDensity(board);
    return density;
  }

  sampleDensity(board, startTime) {
    const blocked = this.blockedCells(board);
    const activeHits = this.activeHits(board);
    const validByLength = new Map();
    for (const length of new Set(this.remainingSizes)) {
      validByLength.set(length, this.allValidPlacements(length, blocked));
    }

    const density = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) density.set(key(r, c), 0);

    let samples = 0;
    let attempts = 0;
    const softDeadline = startTime + BAYES_SOFT_TIME_BUDGET_MS;
    const hardDeadline = startTime + BAYES_TIME_BUDGET_MS - BAYES_SAFETY_MARGIN_MS;

    while (samples < BAYES_MAX_SAMPLES && attempts < BAYES_MAX_TOTAL_ATTEMPTS) {
      attempts++;
      if (attempts % 64 === 0) {
        const now = performance.now();
        if (now > hardDeadline || (now > softDeadline && samples >= 50)) break;
      }

      const cells = this.tryBuildSample(activeHits, validByLength);
      if (cells === null) continue;
      samples++;
      for (const cell of cells) {
        const k = key(cell[0], cell[1]);
        density.set(k, density.get(k) + 1);
      }
    }

    return { density, samples };
  }

  tryBuildSample(activeHits, validByLength) {
    const occupied = new Set();
    const remaining = [...this.remainingSizes];
    const uncovered = new Set(activeHits);

    while (uncovered.size > 0) {
      const h = uncovered.values().next().value;
      const [hr, hc] = h.split(",").map(Number);
      const candidates = []; // [length, cells]
      for (const length of new Set(remaining)) {
        for (const cells of validByLength.get(length)) {
          if (cells.some(([r, c]) => r === hr && c === hc) && this.cellsFree(cells, occupied)) {
            candidates.push([length, cells]);
          }
        }
      }
      if (candidates.length === 0) return null;
      const [length, cells] = choice(candidates);
      for (const [r, c] of cells) occupied.add(key(r, c));
      remaining.splice(remaining.indexOf(length), 1);
      for (const [r, c] of cells) uncovered.delete(key(r, c));
    }

    for (const length of remaining) {
      const cells = this.pickFromPool(validByLength.get(length), occupied);
      if (cells === null) return null;
      for (const [r, c] of cells) occupied.add(key(r, c));
    }

    return [...occupied].map((k) => k.split(",").map(Number));
  }

  pickFromPool(pool, occupied, maxAttempts = BAYES_MAX_POOL_PICK_ATTEMPTS) {
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
      for (const blocker of blockers) {
        if (blocker.has(key(r, c))) return false;
      }
    }
    return true;
  }

  blockedCells(board) {
    const blocked = new Set(this.resolvedSunkCells);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "miss") blocked.add(key(r, c));
      }
    }
    return blocked;
  }

  activeHits(board) {
    const hits = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "hit" && !this.resolvedSunkCells.has(key(r, c))) hits.add(key(r, c));
      }
    }
    return hits;
  }

  fallbackDensity(board) {
    const blocked = this.blockedCells(board);
    const density = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) density.set(key(r, c), 0);
    for (const length of new Set(this.remainingSizes)) {
      for (const cells of this.allValidPlacements(length, blocked)) {
        for (const [r, c] of cells) {
          const k = key(r, c);
          density.set(k, density.get(k) + 1);
        }
      }
    }
    return density;
  }

  updateSunkShips(board) {
    const runCells = (r, c, dr, dc) => {
      const cells = [];
      let rr = r,
        cc = c;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === "hit") {
        cells.push([rr, cc]);
        rr += dr;
        cc += dc;
      }
      return cells;
    };
    const isCapped = ([rr, cc]) => {
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) return true;
      return board[rr][cc] === "miss";
    };
    const maybeMarkSunk = (cells, before, after) => {
      const length = cells.length;
      const idx = this.remainingSizes.indexOf(length);
      if (idx === -1) return;
      if (isCapped(before) && isCapped(after)) {
        this.remainingSizes.splice(idx, 1);
        for (const [r, c] of cells) this.resolvedSunkCells.add(key(r, c));
      }
    };

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== "hit" || this.resolvedSunkCells.has(key(r, c))) continue;
        if (c === 0 || board[r][c - 1] !== "hit") {
          const cells = runCells(r, c, 0, 1);
          const before = [r, c - 1];
          const last = cells[cells.length - 1];
          const after = [last[0], last[1] + 1];
          maybeMarkSunk(cells, before, after);
        }
        if (r === 0 || board[r - 1][c] !== "hit") {
          const cells = runCells(r, c, 1, 0);
          const before = [r - 1, c];
          const last = cells[cells.length - 1];
          const after = [last[0] + 1, last[1]];
          maybeMarkSunk(cells, before, after);
        }
      }
    }
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
