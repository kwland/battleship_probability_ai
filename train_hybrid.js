#!/usr/bin/env node
"use strict";

/*
 * Dependency-free self-play tuner for HybridAI's compact shot-ranking model.
 *
 * The trainer uses two disjoint fleet sets:
 *   - training fleets rank a small, interpretable policy grid;
 *   - held-out fleets choose between the finalists and the untouched baseline.
 *
 * A candidate is saved only if it beats the baseline on the held-out games.
 * This guard prevents the tiny learned component from weakening the exact /
 * Bayesian part of the algorithm through overfitting.
 *
 * Usage:
 *   node train_hybrid.js --quick
 *   node train_hybrid.js --full
 */

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
global.performance = performance;

const ROOT = __dirname;
const source = fs.readFileSync(path.join(ROOT, "ai.js"), "utf8");
const api = new Function(
  source +
    "; return {ROWS,COLS,STANDARD_FLEET_SIZES,makeEmptyBoard,shipCells,key,PlacementAI,HybridAI,DEFAULT_HYBRID_MODEL};"
)();
const {
  ROWS,
  COLS,
  STANDARD_FLEET_SIZES,
  makeEmptyBoard,
  shipCells,
  key,
  PlacementAI,
  HybridAI,
  DEFAULT_HYBRID_MODEL,
} = api;

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeLayout(raw) {
  return raw.map((item) => {
    if (Array.isArray(item)) {
      const [r, c, length, orientation] = item;
      return { r, c, length, orientation };
    }
    return { r: item.r, c: item.c, length: item.length, orientation: item.orientation };
  });
}

function createLayouts(count, seed) {
  const oldRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    const randomPlacer = new PlacementAI({ strategy: "random" });
    const layouts = [];
    const randomCount = Math.ceil(count * 0.7);
    for (let i = 0; i < randomCount; i++) {
      layouts.push(randomPlacer.randomLegalLayout(STANDARD_FLEET_SIZES));
    }

    const poolData = JSON.parse(fs.readFileSync(path.join(ROOT, "layouts.json"), "utf8"));
    const elite = (poolData.layouts || []).map((entry) => normalizeLayout(entry.layout || entry));
    for (let i = randomCount; i < count; i++) layouts.push(elite[(i - randomCount) % elite.length]);
    return layouts;
  } finally {
    Math.random = oldRandom;
  }
}

function playGame(model, rawLayout) {
  const layout = rawLayout.map((ship) => ({
    ...ship,
    cells: shipCells(ship.r, ship.c, ship.length, ship.orientation),
  }));
  const occupied = new Set();
  for (const ship of layout) for (const [r, c] of ship.cells) occupied.add(key(r, c));

  const board = makeEmptyBoard();
  const ai = new HybridAI(STANDARD_FLEET_SIZES, {
    particles: 100,
    minParticles: 16,
    simulations: 0,
    horizon: 1,
    generationAttempts: 5,
    deadlineMs: 40,
    exactUnknownThreshold: 17,
    exactMaxParticles: 2200,
    exactBudgetMs: 3,
    enablePlanning: false,
    model,
  });

  let remaining = occupied.size;
  let shots = 0;
  while (remaining > 0 && shots < ROWS * COLS) {
    const [r, c] = ai.selectNextMove(board);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== null) {
      throw new Error(`Invalid move returned during training: ${r},${c}`);
    }
    const hit = occupied.has(key(r, c));
    const struck = hit
      ? layout.find((ship) => ship.cells.some(([rr, cc]) => rr === r && cc === c))
      : null;
    board[r][c] = hit ? "hit" : "miss";
    shots++;
    if (hit) remaining--;
    const sunk = struck && struck.cells.every(([rr, cc]) => board[rr][cc] === "hit") ? struck : null;
    ai.recordShotResult({
      row: r,
      col: c,
      hit,
      sunkLength: sunk ? sunk.length : null,
      sunkCells: sunk ? sunk.cells : null,
    });
  }
  return shots;
}

function evaluate(model, layouts, seed) {
  const oldRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    let total = 0;
    let sumSquares = 0;
    for (const layout of layouts) {
      const shots = playGame(model, layout);
      total += shots;
      sumSquares += shots * shots;
    }
    const average = total / layouts.length;
    const variance = Math.max(0, sumSquares / layouts.length - average * average);
    return { average, sd: Math.sqrt(variance) };
  } finally {
    Math.random = oldRandom;
  }
}

function makeCandidate({ information = 0.12, parity = 0, sink = 4 }) {
  const model = JSON.parse(JSON.stringify(DEFAULT_HYBRID_MODEL));
  model.hunt_weights[2] = information;
  model.hunt_weights[5] = parity;
  model.target_weights[10] = sink;
  model.target_weights[11] = 8;
  model.target_weights[1] = 0.75;
  return model;
}

function main() {
  const full = process.argv.includes("--full");
  const trainingGames = full ? 180 : 60;
  const validationGames = full ? 400 : 100;
  const trainingLayouts = createLayouts(trainingGames, 0x51f15e);
  const validationLayouts = createLayouts(validationGames, 0xbadc0de);
  const started = performance.now();

  const grid = full
    ? [
        ...[0, 0.04, 0.08, 0.12, 0.2].flatMap((information) =>
          [0, 0.03, 0.05, 0.1, 0.18].flatMap((parity) =>
            [2.5, 3, 3.5, 4, 5].map((sink) => ({ information, parity, sink }))
          )
        ),
      ]
    : [
        { information: 0.12, parity: 0, sink: 4 },
        { information: 0, parity: 0, sink: 4 },
        { information: 0, parity: 0.05, sink: 3 },
        { information: 0, parity: 0.12, sink: 5.5 },
        { information: 0, parity: 0.2, sink: 3 },
        { information: 0.06, parity: 0.05, sink: 3.5 },
      ];

  const ranked = grid.map((params) => {
    const model = makeCandidate(params);
    return { params, model, training: evaluate(model, trainingLayouts, 0x123456) };
  }).sort((a, b) => a.training.average - b.training.average);

  const baseline = makeCandidate({ information: 0.12, parity: 0, sink: 4 });
  const finalists = [
    { params: { information: 0.12, parity: 0, sink: 4 }, model: baseline, baseline: true },
    ...ranked.slice(0, full ? 12 : 4),
  ];
  for (const finalist of finalists) {
    finalist.validation = evaluate(finalist.model, validationLayouts, 0x777777);
  }
  finalists.sort((a, b) => a.validation.average - b.validation.average);

  const baselineResult = finalists.find((entry) => entry.baseline)?.validation || evaluate(baseline, validationLayouts, 0x777777);
  let selected = finalists[0];
  if (selected.validation.average > baselineResult.average) {
    selected = { params: { information: 0.12, parity: 0, sink: 4 }, model: baseline, validation: baselineResult, baseline: true };
  }

  selected.model.version = 1;
  selected.model.name = selected.baseline ? "hybrid-posterior-baseline-v1" : "hybrid-heldout-grid-v1";
  selected.model.training = {
    method: "held-out grid self-play",
    generated_at: new Date().toISOString(),
    training_games: trainingGames,
    validation_games: validationGames,
    selected_parameters: selected.params,
    baseline_validation_average: baselineResult.average,
    selected_validation_average: selected.validation.average,
    selected_validation_sd: selected.validation.sd,
    elapsed_seconds: (performance.now() - started) / 1000,
  };

  fs.writeFileSync(path.join(ROOT, "policy_model.json"), JSON.stringify(selected.model, null, 2) + "\n");
  fs.writeFileSync(
    path.join(ROOT, "training_results.json"),
    JSON.stringify({
      selected: selected.model.training,
      finalists: finalists.map((entry) => ({ params: entry.params, baseline: Boolean(entry.baseline), validation: entry.validation })),
    }, null, 2) + "\n"
  );

  console.log(`Selected ${selected.model.name}`);
  console.log(`Baseline: ${baselineResult.average.toFixed(3)} shots`);
  console.log(`Selected: ${selected.validation.average.toFixed(3)} shots`);
  console.log(`Wrote policy_model.json and training_results.json`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
