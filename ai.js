/*
 * Battleship AI engine for an 8 x 11 board.
 *
 * The strongest opponent is BayesianAI. It combines:
 *   - exact sunk-ship feedback from the game engine,
 *   - complete-fleet particle filtering,
 *   - constrained resampling and Gibbs rejuvenation,
 *   - target/sink-aware scoring,
 *   - shallow lookahead,
 *   - optional learning from the player's previous layouts.
 */

const ROWS = 8;
const COLS = 11;
const CELL_COUNT = ROWS * COLS;

const STANDARD_FLEET = [
  { name: "Carrier", length: 5 },
  { name: "Battleship", length: 4 },
  { name: "Cruiser", length: 3 },
  { name: "Submarine", length: 3 },
  { name: "Destroyer", length: 2 },
];

const STANDARD_FLEET_SIZES = STANDARD_FLEET.map((s) => s.length);

function key(r, c) {
  return `${r},${c}`;
}

function indexOfCell(r, c) {
  return r * COLS + c;
}

function cellFromIndex(i) {
  return [Math.floor(i / COLS), i % COLS];
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function choice(arr) {
  return arr[randInt(arr.length)];
}

function shuffled(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

function normalizedCellSignature(cells) {
  return cells.map(([r, c]) => key(r, c)).sort().join("|");
}

function layoutToParticle(layout) {
  const ships = layout.map((ship) => {
    if (ship.cells) return ship.cells.map(([r, c]) => [r, c]);
    return shipCells(ship.r, ship.c, ship.length, ship.orientation);
  });
  const occupied = new Set();
  const occupiedIndices = [];
  const shipSignatures = ships.map((cells) => normalizedCellSignature(cells));
  for (const cells of ships) {
    for (const [r, c] of cells) {
      occupied.add(key(r, c));
      occupiedIndices.push(indexOfCell(r, c));
    }
  }
  return { ships, shipSignatures, occupied, occupiedIndices };
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
    if (!candidates.length) throw new Error("No legal moves remain.");
    return choice(candidates);
  }

  recordShotResult() {}
}

/* ---------------- ProbabilityAI ---------------- */

class ProbabilityAI {
  constructor(fleetSizes) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.remainingSizes = [...this.fleetSizes];
    this.resolvedSunkCells = new Set();
    this.cachedSignature = null;
    this.cachedDensity = null;
  }

  recordShotResult({ sunkLength = null, sunkCells = null } = {}) {
    if (sunkLength && Array.isArray(sunkCells)) {
      const idx = this.remainingSizes.indexOf(sunkLength);
      if (idx !== -1) this.remainingSizes.splice(idx, 1);
      for (const [r, c] of sunkCells) this.resolvedSunkCells.add(key(r, c));
      this.cachedSignature = null;
      this.cachedDensity = null;
    }
  }

  boardSignature(board) {
    let s = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = key(r, c);
        if (this.resolvedSunkCells.has(k)) s += "S";
        else s += board[r][c] === "hit" ? "H" : board[r][c] === "miss" ? "M" : ".";
      }
    }
    s += `|${this.remainingSizes.slice().sort((a, b) => a - b).join(",")}`;
    return s;
  }

  selectNextMove(board) {
    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (board[r][c] === null) unknown.push([r, c]);
    }
    if (!unknown.length) throw new Error("No legal moves remain.");

    try {
      const density = this.currentDensityMap(board);
      let best = -Infinity;
      let bestCells = [];
      for (const [r, c] of unknown) {
        const score = density.get(key(r, c)) || 0;
        if (score > best + 1e-12) {
          best = score;
          bestCells = [[r, c]];
        } else if (Math.abs(score - best) <= 1e-12) {
          bestCells.push([r, c]);
        }
      }
      return choice(bestCells.length ? bestCells : unknown);
    } catch (error) {
      return choice(unknown);
    }
  }

  currentDensityMap(board) {
    const signature = this.boardSignature(board);
    if (signature === this.cachedSignature && this.cachedDensity) return this.cachedDensity;

    let hasActiveHit = false;
    for (let r = 0; r < ROWS && !hasActiveHit; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === "hit" && !this.resolvedSunkCells.has(key(r, c))) {
          hasActiveHit = true;
          break;
        }
      }
    }

    let density = this.computeDensity(board, hasActiveHit);
    let positiveUnknown = false;
    if (hasActiveHit) {
      for (let r = 0; r < ROWS && !positiveUnknown; r++) {
        for (let c = 0; c < COLS; c++) {
          if (board[r][c] === null && (density.get(key(r, c)) || 0) > 0) {
            positiveUnknown = true;
            break;
          }
        }
      }
      if (!positiveUnknown) density = this.computeDensity(board, false);
    }

    this.cachedSignature = signature;
    this.cachedDensity = density;
    return density;
  }

  computeDensity(board, targetMode) {
    const density = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) density.set(key(r, c), 0);

    const lengthCounts = new Map();
    for (const length of this.remainingSizes) lengthCounts.set(length, (lengthCounts.get(length) || 0) + 1);

    for (const [length, multiplicity] of lengthCounts) {
      for (const cells of this.allPlacements(length)) {
        let hitCount = 0;
        const unknown = [];
        let legal = true;
        for (const [r, c] of cells) {
          const k = key(r, c);
          if (board[r][c] === "miss" || this.resolvedSunkCells.has(k)) {
            legal = false;
            break;
          }
          if (board[r][c] === "hit") hitCount++;
          else unknown.push([r, c]);
        }
        if (!legal || unknown.length === 0) continue;
        if (targetMode && hitCount === 0) continue;

        // Matching several unresolved hits and being one shot from a sink are
        // much more valuable than a merely possible placement.
        let weight = multiplicity;
        if (hitCount > 0) weight *= 1 + 5 * hitCount * hitCount;
        if (unknown.length === 1 && hitCount > 0) weight *= 3;

        for (const [r, c] of unknown) {
          const k = key(r, c);
          density.set(k, density.get(k) + weight);
        }
      }
    }
    return density;
  }

  allPlacements(length) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS - length; c++) out.push(shipCells(r, c, length, "H"));
    }
    for (let r = 0; r <= ROWS - length; r++) {
      for (let c = 0; c < COLS; c++) out.push(shipCells(r, c, length, "V"));
    }
    return out;
  }
}

/* ---------------- BayesianAI ---------------- */

const PARTICLE_TARGET = 3500;
const PARTICLE_MIN = 300;
const INITIAL_BUILD_BUDGET_MS = 700;
const REFILL_BUDGET_MS = 180;
const GIBBS_MOVES_PER_NEW_PARTICLE = 1;
const LOOKAHEAD_CANDIDATES = 5;
const LOOKAHEAD_WEIGHT = 0.16;
const TARGET_ACTIVE_WEIGHT = 14.0;
const TARGET_SINK_WEIGHT = 7.0;
const TARGET_OCCUPANCY_WEIGHT = 0.12;
const HUNT_INFORMATION_WEIGHT = 0.015;

class BayesianAI {
  constructor(fleetSizes, { historicalLayouts = [] } = {}) {
    this.fleetSizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    this.remainingSizes = [...this.fleetSizes];
    this.resolvedSunkCells = new Set();
    this.sunkShips = [];
    this.sunkSignatures = new Set();

    this.particles = null;
    this.processedCells = new Set();
    this.cachedSignature = null;
    this.cachedScores = null;

    this.historicalParticles = historicalLayouts
      .map((layout) => {
        try {
          return layoutToParticle(layout);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-40);

    // A smoothed cell-frequency prior still helps when the player changes a
    // few ships and none of the exact historical layouts survives filtering.
    this.historicalCellPrior = new Float64Array(CELL_COUNT);
    if (this.historicalParticles.length) {
      for (const particle of this.historicalParticles) {
        for (const idx of particle.occupiedIndices) this.historicalCellPrior[idx] += 1;
      }
      const n = this.historicalParticles.length;
      const baseline = STANDARD_FLEET_SIZES.reduce((a, b) => a + b, 0) / CELL_COUNT;
      for (let i = 0; i < CELL_COUNT; i++) {
        const empirical = this.historicalCellPrior[i] / n;
        this.historicalCellPrior[i] = 0.85 * empirical + 0.15 * baseline;
      }
    }
  }

  recordShotResult({ sunkLength = null, sunkCells = null } = {}) {
    if (!sunkLength || !Array.isArray(sunkCells)) {
      this.cachedSignature = null;
      this.cachedScores = null;
      return;
    }

    const signature = normalizedCellSignature(sunkCells);
    if (this.sunkSignatures.has(signature)) return;

    const idx = this.remainingSizes.indexOf(sunkLength);
    if (idx !== -1) this.remainingSizes.splice(idx, 1);
    const copied = sunkCells.map(([r, c]) => [r, c]);
    this.sunkShips.push(copied);
    this.sunkSignatures.add(signature);
    for (const [r, c] of copied) this.resolvedSunkCells.add(key(r, c));

    if (this.particles) {
      this.particles = this.particles.filter((particle) => this.particleMatchesSunkEvidence(particle));
    }

    this.cachedSignature = null;
    this.cachedScores = null;
  }

  static boardSignature(board) {
    let out = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) out += board[r][c] === "hit" ? "H" : board[r][c] === "miss" ? "M" : ".";
    }
    return out;
  }

  stateSignature(board) {
    return `${BayesianAI.boardSignature(board)}|${[...this.sunkSignatures].sort().join(";")}|${this.remainingSizes
      .slice()
      .sort((a, b) => a - b)
      .join(",")}`;
  }

  selectNextMove(board) {
    const unknown = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (board[r][c] === null) unknown.push([r, c]);
    }
    if (!unknown.length) throw new Error("No legal moves remain.");

    try {
      const scores = this.computeScores(board);
      let best = -Infinity;
      let bestCells = [];
      for (const [r, c] of unknown) {
        const score = scores.get(key(r, c)) || 0;
        if (score > best + 1e-12) {
          best = score;
          bestCells = [[r, c]];
        } else if (Math.abs(score - best) <= 1e-12) {
          bestCells.push([r, c]);
        }
      }
      return choice(bestCells.length ? bestCells : unknown);
    } catch (error) {
      const fallback = new ProbabilityAI(this.remainingSizes);
      fallback.resolvedSunkCells = new Set(this.resolvedSunkCells);
      return fallback.selectNextMove(board);
    }
  }

  currentDensityMap(board) {
    try {
      return this.computeScores(board);
    } catch (error) {
      const fallback = new ProbabilityAI(this.remainingSizes);
      fallback.resolvedSunkCells = new Set(this.resolvedSunkCells);
      return fallback.currentDensityMap(board);
    }
  }

  computeScores(board) {
    const signature = this.stateSignature(board);
    if (signature === this.cachedSignature && this.cachedScores) return this.cachedScores;

    const start = performance.now();
    const evidence = this.collectEvidence(board);

    if (this.particles === null) {
      this.particles = this.generateParticles(
        evidence,
        PARTICLE_TARGET,
        start + INITIAL_BUILD_BUDGET_MS
      );
      // These particles already include all current evidence.
      for (const k of evidence.hits) this.processedCells.add(k);
      for (const k of evidence.misses) this.processedCells.add(k);
    } else {
      this.applyNewEvidence(board);
    }

    this.maybeRefill(evidence, start);

    if (!this.particles.length) {
      const fallback = new ProbabilityAI(this.remainingSizes);
      fallback.resolvedSunkCells = new Set(this.resolvedSunkCells);
      const scores = fallback.currentDensityMap(board);
      this.cachedSignature = signature;
      this.cachedScores = scores;
      return scores;
    }

    const historical = this.historicalParticles.filter((particle) => this.particleConsistentWithBoard(particle, board));
    const historyAlpha = historical.length
      ? Math.min(0.48, 0.12 * Math.sqrt(Math.min(this.historicalParticles.length, 16)))
      : 0;

    const weightedParticles = [];
    const genericWeight = (1 - historyAlpha) / this.particles.length;
    for (const particle of this.particles) weightedParticles.push([particle, genericWeight]);
    if (historical.length) {
      const historyWeight = historyAlpha / historical.length;
      for (const particle of historical) weightedParticles.push([particle, historyWeight]);
    }

    const occupancy = new Float64Array(CELL_COUNT);
    const active = new Float64Array(CELL_COUNT);
    const sink = new Float64Array(CELL_COUNT);
    let hasActive = false;

    for (const [particle, weight] of weightedParticles) {
      for (const cells of particle.ships) {
        if (this.sunkShips.length && cells.every(([r, c]) => this.resolvedSunkCells.has(key(r, c)))) continue;

        let hitCount = 0;
        const unknownIndices = [];
        for (const [r, c] of cells) {
          if (this.resolvedSunkCells.has(key(r, c))) continue;
          if (board[r][c] === "hit") hitCount++;
          else if (board[r][c] === null) unknownIndices.push(indexOfCell(r, c));
        }

        for (const idx of unknownIndices) occupancy[idx] += weight;
        if (hitCount > 0 && unknownIndices.length > 0) {
          hasActive = true;
          for (const idx of unknownIndices) active[idx] += weight;
          if (unknownIndices.length === 1) sink[unknownIndices[0]] += weight;
        }
      }
    }

    const base = new Float64Array(CELL_COUNT);
    const candidateIndices = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== null) continue;
        const idx = indexOfCell(r, c);
        candidateIndices.push(idx);
        if (hasActive) {
          base[idx] =
            TARGET_ACTIVE_WEIGHT * active[idx] +
            TARGET_SINK_WEIGHT * sink[idx] +
            TARGET_OCCUPANCY_WEIGHT * occupancy[idx];
        } else {
          const p = occupancy[idx];
          const information = 4 * p * (1 - p);
          const priorAlpha = this.historicalParticles.length
            ? Math.min(0.18, 0.045 * Math.sqrt(this.historicalParticles.length))
            : 0;
          const learnedPrior = this.historicalCellPrior[idx] || p;
          base[idx] = (1 - priorAlpha) * p + priorAlpha * learnedPrior + HUNT_INFORMATION_WEIGHT * information;
        }
      }
    }

    if (!hasActive && candidateIndices.length > 1) {
      const top = [...candidateIndices]
        .sort((a, b) => base[b] - base[a])
        .slice(0, LOOKAHEAD_CANDIDATES);
      for (const idx of top) {
        base[idx] += LOOKAHEAD_WEIGHT * this.expectedNextHitProbability(idx, weightedParticles, board);
      }
    }

    const scores = new Map();
    for (let i = 0; i < CELL_COUNT; i++) {
      const [r, c] = cellFromIndex(i);
      scores.set(key(r, c), base[i]);
    }

    this.cachedSignature = signature;
    this.cachedScores = scores;
    return scores;
  }

  expectedNextHitProbability(shotIndex, weightedParticles, board) {
    const hitCounts = new Float64Array(CELL_COUNT);
    const missCounts = new Float64Array(CELL_COUNT);
    let hitMass = 0;
    let missMass = 0;
    const shotKey = key(...cellFromIndex(shotIndex));

    for (const [particle, weight] of weightedParticles) {
      const isHit = particle.occupied.has(shotKey);
      if (isHit) hitMass += weight;
      else missMass += weight;

      for (const idx of particle.occupiedIndices) {
        const [r, c] = cellFromIndex(idx);
        if (board[r][c] !== null || idx === shotIndex) continue;
        if (isHit) hitCounts[idx] += weight;
        else missCounts[idx] += weight;
      }
    }

    let bestAfterHit = 0;
    let bestAfterMiss = 0;
    if (hitMass > 0) {
      for (let i = 0; i < CELL_COUNT; i++) bestAfterHit = Math.max(bestAfterHit, hitCounts[i] / hitMass);
    }
    if (missMass > 0) {
      for (let i = 0; i < CELL_COUNT; i++) bestAfterMiss = Math.max(bestAfterMiss, missCounts[i] / missMass);
    }
    return hitMass * bestAfterHit + missMass * bestAfterMiss;
  }

  collectEvidence(board) {
    const misses = new Set();
    const hits = new Set();
    const blocked = new Set(this.resolvedSunkCells);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = key(r, c);
        if (board[r][c] === "miss") {
          misses.add(k);
          blocked.add(k);
        } else if (board[r][c] === "hit" && !this.resolvedSunkCells.has(k)) {
          hits.add(k);
        }
      }
    }
    return { misses, hits, blocked };
  }

  applyNewEvidence(board) {
    const newHits = [];
    const newMisses = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === null) continue;
        const k = key(r, c);
        if (this.processedCells.has(k)) continue;
        this.processedCells.add(k);
        if (board[r][c] === "hit") newHits.push(k);
        else newMisses.push(k);
      }
    }

    if (!newHits.length && !newMisses.length) return;
    this.particles = this.particles.filter((particle) => {
      for (const k of newHits) if (!particle.occupied.has(k)) return false;
      for (const k of newMisses) if (particle.occupied.has(k)) return false;
      return this.particleMatchesSunkEvidence(particle);
    });
  }

  maybeRefill(evidence, startTime) {
    if (this.particles.length >= PARTICLE_MIN) return;
    const fresh = this.generateParticles(
      evidence,
      PARTICLE_TARGET - this.particles.length,
      startTime + REFILL_BUDGET_MS
    );
    this.particles = this.particles.concat(fresh);
  }

  generateParticles(evidence, targetCount, deadline) {
    const validByLength = new Map();
    for (const length of new Set(this.remainingSizes)) {
      validByLength.set(length, this.allValidPlacements(length, evidence.blocked));
    }

    const cover = new Map();
    for (const [length, placements] of validByLength) {
      const counts = new Map();
      for (const cells of placements) {
        for (const [r, c] of cells) {
          const k = key(r, c);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
      cover.set(length, counts);
    }

    const particles = [];
    const maxAttempts = Math.max(8000, targetCount * 18);
    let attempts = 0;
    while (particles.length < targetCount && attempts < maxAttempts) {
      attempts++;
      if (attempts % 40 === 0 && performance.now() > deadline) break;
      const ships = this.tryBuildParticle(evidence.hits, validByLength, cover);
      if (!ships) continue;
      const rejuvenated = this.rejuvenateShips(ships, evidence, validByLength, GIBBS_MOVES_PER_NEW_PARTICLE);
      particles.push(this.makeParticle(rejuvenated));
    }
    return particles;
  }

  tryBuildParticle(activeHits, validByLength, cover) {
    const ships = this.sunkShips.map((cells) => cells.map(([r, c]) => [r, c]));
    const occupied = new Set(this.resolvedSunkCells);
    const remaining = [...this.remainingSizes];
    const uncovered = new Set(activeHits);

    while (uncovered.size > 0) {
      let selectedHit = null;
      let constraint = Infinity;
      for (const candidate of uncovered) {
        let total = 0;
        const multiplicities = new Map();
        for (const length of remaining) multiplicities.set(length, (multiplicities.get(length) || 0) + 1);
        for (const [length, count] of multiplicities) total += count * (cover.get(length)?.get(candidate) || 0);
        if (total < constraint) {
          constraint = total;
          selectedHit = candidate;
        }
      }
      if (selectedHit === null) return null;

      const multiplicities = new Map();
      for (const length of remaining) multiplicities.set(length, (multiplicities.get(length) || 0) + 1);
      const candidates = [];
      for (const [length, count] of multiplicities) {
        for (const cells of validByLength.get(length) || []) {
          if (!cells.some(([r, c]) => key(r, c) === selectedHit)) continue;
          if (!this.cellsFree(cells, occupied)) continue;
          const overlap = cells.reduce((sum, [r, c]) => sum + (uncovered.has(key(r, c)) ? 1 : 0), 0);
          const weight = count * Math.pow(Math.max(1, overlap), 3);
          candidates.push([length, cells, weight]);
        }
      }
      if (!candidates.length) return null;

      const [length, cells] = this.weightedChoice(candidates);
      ships.push(cells.map(([r, c]) => [r, c]));
      for (const [r, c] of cells) {
        occupied.add(key(r, c));
        uncovered.delete(key(r, c));
      }
      remaining.splice(remaining.indexOf(length), 1);
    }

    for (const length of shuffled(remaining)) {
      const cells = this.pickLegalPlacement(validByLength.get(length) || [], occupied);
      if (!cells) return null;
      ships.push(cells.map(([r, c]) => [r, c]));
      for (const [r, c] of cells) occupied.add(key(r, c));
    }

    return ships;
  }

  rejuvenateShips(ships, evidence, validByLength, moves) {
    if (moves <= 0) return ships;
    const out = ships.map((cells) => cells.map(([r, c]) => [r, c]));

    for (let move = 0; move < moves; move++) {
      const movable = [];
      for (let i = 0; i < out.length; i++) {
        if (!this.sunkSignatures.has(normalizedCellSignature(out[i]))) movable.push(i);
      }
      if (!movable.length) break;
      const shipIndex = choice(movable);
      const oldCells = out[shipIndex];
      const length = oldCells.length;

      const occupiedOthers = new Set(this.resolvedSunkCells);
      for (let i = 0; i < out.length; i++) {
        if (i === shipIndex) continue;
        for (const [r, c] of out[i]) occupiedOthers.add(key(r, c));
      }

      const requiredHits = oldCells.filter(([r, c]) => evidence.hits.has(key(r, c)));
      const legal = [];
      for (const cells of validByLength.get(length) || []) {
        if (!this.cellsFree(cells, occupiedOthers)) continue;
        let coversRequired = true;
        for (const [r, c] of requiredHits) {
          if (!cells.some(([rr, cc]) => rr === r && cc === c)) {
            coversRequired = false;
            break;
          }
        }
        if (coversRequired) legal.push(cells);
      }
      if (legal.length) out[shipIndex] = choice(legal).map(([r, c]) => [r, c]);
    }
    return out;
  }

  weightedChoice(candidates) {
    let total = 0;
    for (const [, , weight] of candidates) total += weight;
    let pick = Math.random() * total;
    for (const [length, cells, weight] of candidates) {
      pick -= weight;
      if (pick <= 0) return [length, cells];
    }
    const last = candidates[candidates.length - 1];
    return [last[0], last[1]];
  }

  pickLegalPlacement(pool, occupied) {
    if (!pool.length) return null;
    for (let i = 0; i < Math.min(48, pool.length); i++) {
      const cells = pool[randInt(pool.length)];
      if (this.cellsFree(cells, occupied)) return cells;
    }
    const legal = pool.filter((cells) => this.cellsFree(cells, occupied));
    return legal.length ? choice(legal) : null;
  }

  allValidPlacements(length, blocked) {
    const placements = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS - length; c++) {
        const cells = shipCells(r, c, length, "H");
        if (this.cellsFree(cells, blocked)) placements.push(cells);
      }
    }
    for (let r = 0; r <= ROWS - length; r++) {
      for (let c = 0; c < COLS; c++) {
        const cells = shipCells(r, c, length, "V");
        if (this.cellsFree(cells, blocked)) placements.push(cells);
      }
    }
    return placements;
  }

  cellsFree(cells, blocker) {
    for (const [r, c] of cells) if (blocker.has(key(r, c))) return false;
    return true;
  }

  makeParticle(ships) {
    const occupied = new Set();
    const occupiedIndices = [];
    const shipSignatures = ships.map((cells) => normalizedCellSignature(cells));
    for (const cells of ships) {
      for (const [r, c] of cells) {
        occupied.add(key(r, c));
        occupiedIndices.push(indexOfCell(r, c));
      }
    }
    return { ships, shipSignatures, occupied, occupiedIndices };
  }

  particleMatchesSunkEvidence(particle) {
    for (const signature of this.sunkSignatures) {
      if (!particle.shipSignatures.includes(signature)) return false;
    }
    return true;
  }

  particleConsistentWithBoard(particle, board) {
    if (!this.particleMatchesSunkEvidence(particle)) return false;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const state = board[r][c];
        if (state === null) continue;
        const occupied = particle.occupied.has(key(r, c));
        if (state === "hit" && !occupied) return false;
        if (state === "miss" && occupied) return false;
      }
    }
    return true;
  }
}

/* ---------------- PlacementAI ---------------- */

let OPTIMIZED_LAYOUTS = null;

async function loadOptimizedLayouts(url = "layouts.json") {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${url}`);
    const data = await response.json();
    const layouts = (data.layouts || []).map((layout) =>
      layout.map(([r, c, length, orientation]) => ({ r, c, length, orientation }))
    );
    OPTIMIZED_LAYOUTS = layouts.filter((layout) => PlacementAI.isLegalLayout(layout));
  } catch (error) {
    OPTIMIZED_LAYOUTS = null;
  }
  return OPTIMIZED_LAYOUTS;
}

class PlacementAI {
  constructor({ restarts = 40, gamesPerCandidate = 6, shotHistory = [], usedLayouts = [] } = {}) {
    this.restarts = restarts;
    this.gamesPerCandidate = gamesPerCandidate;
    this.shotHistory = shotHistory.filter(Array.isArray).slice(-30);
    this.usedLayouts = usedLayouts.filter(Array.isArray).slice(-20);
  }

  placeShips(fleetSizes) {
    const sizes = fleetSizes ? [...fleetSizes] : [...STANDARD_FLEET_SIZES];
    const pool = this.matchingOptimizedLayouts(sizes);
    if (pool.length) return this.chooseAdaptiveLayout(pool);

    let bestLayout = null;
    let bestScore = -Infinity;
    for (let i = 0; i < this.restarts; i++) {
      const layout = this.randomLegalLayout(sizes);
      if (!layout) continue;
      const score = this.evaluate(layout, sizes) + 0.8 * this.historySurvivalScore(layout);
      if (score > bestScore) {
        bestScore = score;
        bestLayout = layout;
      }
    }
    if (!bestLayout) throw new Error("Could not find a legal ship layout.");
    return bestLayout;
  }

  matchingOptimizedLayouts(sizes) {
    if (!OPTIMIZED_LAYOUTS?.length) return [];
    const wanted = [...sizes].sort((a, b) => a - b).join(",");
    return OPTIMIZED_LAYOUTS.filter(
      (layout) => layout.map((ship) => ship.length).sort((a, b) => a - b).join(",") === wanted
    );
  }

  chooseAdaptiveLayout(pool) {
    const scored = pool.map((layout) => {
      const history = this.historySurvivalScore(layout);
      const novelty = this.noveltyScore(layout);
      return { layout, score: history + 3.5 * novelty + Math.random() * 1.5 };
    });

    scored.sort((a, b) => b.score - a.score);
    const elite = scored.slice(0, Math.max(8, Math.ceil(scored.length * 0.25)));

    // Softmax sampling keeps a mixed strategy while favoring layouts that
    // specifically resist this player's previous firing patterns.
    const floor = elite[elite.length - 1].score;
    const weights = elite.map((entry) => Math.exp((entry.score - floor) / 4));
    let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < elite.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return elite[i].layout.map((ship) => ({ ...ship }));
    }
    return elite[0].layout.map((ship) => ({ ...ship }));
  }

  historySurvivalScore(layout) {
    if (!this.shotHistory.length) return 0;
    const shipCellsSet = this.shipCellSet(layout);
    const survivals = [];

    for (const order of this.shotHistory) {
      const rank = new Map();
      order.forEach(([r, c], i) => rank.set(key(r, c), i + 1));
      let lastHit = 0;
      for (const k of shipCellsSet) {
        const fallback = Math.min(CELL_COUNT, order.length + 12);
        lastHit = Math.max(lastHit, rank.get(k) || fallback);
      }
      survivals.push(lastHit);
    }

    survivals.sort((a, b) => a - b);
    const average = survivals.reduce((a, b) => a + b, 0) / survivals.length;
    const lowerQuartile = survivals[Math.floor((survivals.length - 1) * 0.25)];
    return 0.7 * average + 0.3 * lowerQuartile;
  }

  noveltyScore(layout) {
    if (!this.usedLayouts.length) return 1;
    const cells = this.shipCellSet(layout);
    let maxSimilarity = 0;
    for (const oldLayout of this.usedLayouts) {
      const oldCells = this.shipCellSet(oldLayout);
      let overlap = 0;
      for (const k of cells) if (oldCells.has(k)) overlap++;
      maxSimilarity = Math.max(maxSimilarity, overlap / cells.size);
    }
    return 1 - maxSimilarity;
  }

  evaluate(layout, sizes) {
    const ships = this.shipCellSet(layout);
    let total = 0;
    for (let i = 0; i < this.gamesPerCandidate; i++) total += this.simulateGame(ships, layout, sizes);
    return total / this.gamesPerCandidate;
  }

  simulateGame(ships, layout, sizes) {
    const board = makeEmptyBoard();
    const attacker = new ProbabilityAI(sizes);
    let remaining = ships.size;
    let shots = 0;
    const sunkReported = new Set();

    while (remaining > 0 && shots < CELL_COUNT) {
      const [r, c] = attacker.selectNextMove(board);
      shots++;
      const k = key(r, c);
      if (ships.has(k)) {
        board[r][c] = "hit";
        remaining--;
        const ship = layout.find((candidate) =>
          shipCells(candidate.r, candidate.c, candidate.length, candidate.orientation).some(
            ([rr, cc]) => rr === r && cc === c
          )
        );
        if (ship) {
          const cells = shipCells(ship.r, ship.c, ship.length, ship.orientation);
          const signature = normalizedCellSignature(cells);
          if (!sunkReported.has(signature) && cells.every(([rr, cc]) => board[rr][cc] === "hit")) {
            sunkReported.add(signature);
            attacker.recordShotResult({ sunkLength: ship.length, sunkCells: cells });
          }
        }
      } else {
        board[r][c] = "miss";
      }
    }
    return shots;
  }

  shipCellSet(layout) {
    const cells = new Set();
    for (const ship of layout) {
      const placed = ship.cells || shipCells(ship.r, ship.c, ship.length, ship.orientation);
      for (const [r, c] of placed) cells.add(key(r, c));
    }
    return cells;
  }

  randomLegalLayout(sizes, maxAttempts = 800) {
    const occupied = new Set();
    const layout = [];
    for (const length of [...sizes].sort((a, b) => b - a)) {
      let placed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const orientation = Math.random() < 0.5 ? "H" : "V";
        const r = orientation === "H" ? randInt(ROWS) : randInt(ROWS - length + 1);
        const c = orientation === "H" ? randInt(COLS - length + 1) : randInt(COLS);
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

  static isLegalLayout(layout) {
    if (!Array.isArray(layout) || layout.length !== STANDARD_FLEET.length) return false;
    const occupied = new Set();
    for (const ship of layout) {
      if (!["H", "V"].includes(ship.orientation)) return false;
      const cells = shipCells(ship.r, ship.c, ship.length, ship.orientation);
      for (const [r, c] of cells) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
        const k = key(r, c);
        if (occupied.has(k)) return false;
        occupied.add(k);
      }
    }
    return true;
  }
}
