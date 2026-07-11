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
