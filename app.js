/* Game state + UI wiring for the interactive Battleship AI demo. */

// Placement-search strength used for the enemy fleet (the AI's own fleet
// composition, which the player attacks) and for the "Auto-Place (Smart)"
// button. Higher than the class default since this only runs once per game
// and the board is small, so we can afford a more thorough search.
const STRONG_PLACEMENT = { restarts: 25, gamesPerCandidate: 5 };

const ICON_HIT = `<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" style="fill:var(--hit-glow);opacity:0.35"/>
  <path d="M12 2 L14.2 9.2 L21 8 L15.8 13 L18.5 20 L12 15.8 L5.5 20 L8.2 13 L3 8 L9.8 9.2 Z" style="fill:var(--hit-core);stroke:var(--hit-glow);stroke-width:0.6;stroke-linejoin:round"/>
</svg>`;

const ICON_MISS = `<svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="2.6" style="fill:var(--miss-ring)"/>
  <circle cx="12" cy="12" r="6.5" style="fill:none;stroke:var(--miss-ring);stroke-width:1.3;opacity:0.65"/>
  <circle cx="12" cy="12" r="10" style="fill:none;stroke:var(--miss-ring);stroke-width:1;opacity:0.35"/>
</svg>`;

const state = {
  phase: "setup", // "setup" | "battle"
  setup: {
    placed: [null, null, null, null, null], // index-aligned with STANDARD_FLEET
    selected: 0,
    orientation: "H",
    hover: null, // [r, c]
  },
  playerLayout: [], // [{ r, c, length, orientation, cells: [[r,c], ...] }]
  enemyLayout: [],
  playerShips: null, // Set<"r,c">
  enemyShips: null,
  playerBoardState: null,
  enemyBoardState: null,
  attackerAI: null,
  turn: "player", // "player" | "ai" | "over"
  winner: null,
  shotsPlayer: 0,
  shotsAI: 0,
  heatmapOn: true,
};

let setupCellEls = []; // [r][c] -> DOM element, built once per setup session

/* ==================== Setup / placement phase ==================== */

function setupOccupiedSet() {
  const occupied = new Set();
  for (const ship of state.setup.placed) {
    if (!ship) continue;
    for (const [r, c] of ship.cells) occupied.add(key(r, c));
  }
  return occupied;
}

function inBounds(cells) {
  return cells.every(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS);
}

function initSetup() {
  state.setup = { placed: [null, null, null, null, null], selected: 0, orientation: "H", hover: null };
  buildSetupBoardCells();
  renderSetupAll();
}

function buildSetupBoardCells() {
  const container = document.getElementById("setup-board");
  container.innerHTML = "";
  container.style.setProperty("--cols", COLS);
  container.style.setProperty("--rows", ROWS);
  setupCellEls = [];

  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell clickable";
      cell.addEventListener("click", () => onSetupCellClick(r, c));
      cell.addEventListener("mouseenter", () => {
        state.setup.hover = [r, c];
        renderSetupShipLayer();
      });
      cell.addEventListener("mouseleave", () => {
        if (state.setup.hover && state.setup.hover[0] === r && state.setup.hover[1] === c) {
          state.setup.hover = null;
          renderSetupShipLayer();
        }
      });
      container.appendChild(cell);
      row.push(cell);
    }
    setupCellEls.push(row);
  }
}

function onSetupCellClick(r, c) {
  const pickIdx = state.setup.placed.findIndex((s) => s && s.cells.some(([rr, cc]) => rr === r && cc === c));
  if (pickIdx !== -1) {
    state.setup.placed[pickIdx] = null;
    state.setup.selected = pickIdx;
    renderSetupAll();
    return;
  }

  const sel = state.setup.selected;
  if (sel === null || sel === undefined || state.setup.placed[sel]) return;

  const length = STANDARD_FLEET[sel].length;
  const cells = shipCells(r, c, length, state.setup.orientation);
  if (!inBounds(cells)) return;
  const occupied = setupOccupiedSet();
  if (cells.some(([rr, cc]) => occupied.has(key(rr, cc)))) return;

  state.setup.placed[sel] = { r, c, length, orientation: state.setup.orientation, cells };

  let next = null;
  for (let i = 0; i < STANDARD_FLEET.length; i++) {
    const idx = (sel + 1 + i) % STANDARD_FLEET.length;
    if (!state.setup.placed[idx]) {
      next = idx;
      break;
    }
  }
  state.setup.selected = next;
  renderSetupAll();
}

function renderSetupAll() {
  renderFleetList();
  renderSetupShipLayer();
  updateSetupCellTransparency();
  document.getElementById("start-battle").disabled = !state.setup.placed.every(Boolean);
}

function updateSetupCellTransparency() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) setupCellEls[r][c].classList.remove("transparent");
  }
  const occupied = setupOccupiedSet();
  for (const k of occupied) {
    const [r, c] = k.split(",").map(Number);
    setupCellEls[r][c].classList.add("transparent");
  }
}

function renderFleetList() {
  const list = document.getElementById("fleet-list");
  list.innerHTML = "";
  STANDARD_FLEET.forEach((ship, i) => {
    const li = document.createElement("li");
    li.className = "fleet-item" + (state.setup.selected === i ? " selected" : "") + (state.setup.placed[i] ? " placed" : "");

    const swatch = document.createElement("div");
    swatch.className = "fleet-swatch";
    for (let k = 0; k < ship.length; k++) swatch.appendChild(document.createElement("i"));

    const name = document.createElement("span");
    name.className = "fleet-name";
    name.textContent = `${ship.name} (${ship.length})`;

    const status = document.createElement("span");
    status.className = "hint";
    status.textContent = state.setup.placed[i] ? "placed" : "";

    li.appendChild(swatch);
    li.appendChild(name);
    li.appendChild(status);

    li.addEventListener("click", () => {
      if (state.setup.placed[i]) {
        state.setup.placed[i] = null;
      }
      state.setup.selected = i;
      renderSetupAll();
    });

    list.appendChild(li);
  });
}

function renderSetupShipLayer() {
  const layer = document.getElementById("setup-ship-layer");
  layer.innerHTML = "";
  layer.style.setProperty("--cols", COLS);
  layer.style.setProperty("--rows", ROWS);

  for (const ship of state.setup.placed) {
    if (ship) layer.appendChild(buildHullElement(ship, false));
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) setupCellEls[r][c].classList.remove("hover-invalid");
  }

  const sel = state.setup.selected;
  const hover = state.setup.hover;
  if (sel === null || sel === undefined || state.setup.placed[sel] || !hover) return;

  const [hr, hc] = hover;
  const length = STANDARD_FLEET[sel].length;
  const cells = shipCells(hr, hc, length, state.setup.orientation);

  if (!inBounds(cells)) {
    setupCellEls[hr][hc].classList.add("hover-invalid");
    return;
  }

  const occupied = setupOccupiedSet();
  const legal = !cells.some(([rr, cc]) => occupied.has(key(rr, cc)));
  const previewShip = { r: hr, c: hc, length, orientation: state.setup.orientation, cells };
  const hull = buildHullElement(previewShip, false);
  hull.classList.add("preview");
  if (!legal) hull.classList.add("invalid");
  layer.appendChild(hull);
}

function rotateSelected() {
  state.setup.orientation = state.setup.orientation === "H" ? "V" : "H";
  renderSetupShipLayer();
}

function smartAutoPlace() {
  const sizes = STANDARD_FLEET_SIZES;
  const layout = new PlacementAI(STRONG_PLACEMENT).placeShips(sizes);
  // STANDARD_FLEET is already sorted largest-to-smallest, matching the
  // descending sort PlacementAI uses internally, so indices line up 1:1.
  state.setup.placed = layout.map((s) => ({ ...s, cells: shipCells(s.r, s.c, s.length, s.orientation) }));
  state.setup.selected = null;
  renderSetupAll();
}

function clearPlacement() {
  state.setup.placed = [null, null, null, null, null];
  state.setup.selected = 0;
  renderSetupAll();
}

/* ==================== Battle phase ==================== */

function withCells(layoutArr) {
  return layoutArr.map((s) => ({ ...s, cells: shipCells(s.r, s.c, s.length, s.orientation) }));
}

function shipSetOf(layout) {
  const set = new Set();
  for (const ship of layout) for (const [r, c] of ship.cells) set.add(key(r, c));
  return set;
}

function isShipSunk(ship, boardState) {
  return ship.cells.every(([r, c]) => boardState[r][c] === "hit");
}

function shipsAfloat(layout, boardState) {
  return layout.filter((ship) => !isShipSunk(ship, boardState)).length;
}

function startBattle() {
  const sizes = STANDARD_FLEET_SIZES;

  state.playerLayout = state.setup.placed.map((s) => ({ ...s }));
  state.playerShips = shipSetOf(state.playerLayout);

  const enemyRaw = new PlacementAI(STRONG_PLACEMENT).placeShips(sizes);
  state.enemyLayout = withCells(enemyRaw);
  state.enemyShips = shipSetOf(state.enemyLayout);

  state.playerBoardState = makeEmptyBoard();
  state.enemyBoardState = makeEmptyBoard();

  const difficulty = document.getElementById("difficulty").value;
  if (difficulty === "random") {
    state.attackerAI = new RandomAI(sizes);
  } else if (difficulty === "probability") {
    state.attackerAI = new ProbabilityAI(sizes);
  } else if (difficulty === "bayesian") {
    state.attackerAI = new BayesianAI(sizes);
  } else {
    state.attackerAI = new POMCPAI(sizes);
  }

  state.turn = "player";
  state.winner = null;
  state.shotsPlayer = 0;
  state.shotsAI = 0;

  document.getElementById("setup-section").hidden = true;
  document.getElementById("battle-section").hidden = false;
  state.phase = "battle";

  setStatus("Your move — fire on the enemy waters.");
  render();
}

function resetToSetup() {
  state.phase = "setup";
  document.getElementById("battle-section").hidden = true;
  document.getElementById("setup-section").hidden = false;
  initSetup();
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function onEnemyCellClick(r, c) {
  if (state.turn !== "player" || state.winner) return;
  if (state.enemyBoardState[r][c] !== null) return;

  state.shotsPlayer++;
  const hit = state.enemyShips.has(key(r, c));
  state.enemyBoardState[r][c] = hit ? "hit" : "miss";

  if (shipsAfloat(state.enemyLayout, state.enemyBoardState) === 0) {
    state.winner = "player";
    state.turn = "over";
    setStatus(`You sank the enemy fleet in ${state.shotsPlayer} shots!`);
    render();
    return;
  }

  state.turn = "ai";
  setStatus(hit ? "Direct hit! AI is thinking..." : "Miss. AI is thinking...");
  render();
  setTimeout(aiTurn, 500);
}

function aiTurn() {
  if (state.winner) return;

  const [r, c] = state.attackerAI.selectNextMove(state.playerBoardState);
  state.shotsAI++;
  const hit = state.playerShips.has(key(r, c));
  const struckShip = hit
    ? state.playerLayout.find((ship) => ship.cells.some(([rr, cc]) => rr === r && cc === c))
    : null;
  state.playerBoardState[r][c] = hit ? "hit" : "miss";
  const sunkShip = struckShip && isShipSunk(struckShip, state.playerBoardState) ? struckShip : null;

  if (typeof state.attackerAI.recordShotResult === "function") {
    state.attackerAI.recordShotResult({
      row: r,
      col: c,
      hit,
      sunkLength: sunkShip ? sunkShip.length : null,
      sunkCells: sunkShip ? sunkShip.cells : null,
    });
  }

  if (shipsAfloat(state.playerLayout, state.playerBoardState) === 0) {
    state.winner = "ai";
    state.turn = "over";
    setStatus(`The AI sank your fleet in ${state.shotsAI} shots. Try again!`);
    render();
    return;
  }

  state.turn = "player";
  setStatus(
    sunkShip
      ? `The AI sank your ${STANDARD_FLEET.find((s) => s.length === sunkShip.length)?.name || "ship"}! Your move.`
      : hit
        ? "The AI hit one of your ships! Your move."
        : "The AI missed. Your move."
  );
  render();
}

/* ==================== Rendering (battle) ==================== */

function maxDensityValue(densityMap) {
  let max = 0;
  for (const v of densityMap.values()) if (v > max) max = v;
  return max;
}

function buildHullElement(ship, sunk) {
  const el = document.createElement("div");
  el.className = "ship-hull" + (ship.orientation === "V" ? " vertical" : "") + (sunk ? " wreck" : "");
  if (ship.orientation === "H") {
    el.style.gridRow = `${ship.r + 1}`;
    el.style.gridColumn = `${ship.c + 1} / span ${ship.length}`;
  } else {
    el.style.gridRow = `${ship.r + 1} / span ${ship.length}`;
    el.style.gridColumn = `${ship.c + 1}`;
  }
  for (let i = 0; i < ship.length; i++) {
    el.appendChild(document.createElement("span")).className = "porthole";
  }
  return el;
}

function renderShipLayer(layerId, layout, boardState, revealAll) {
  const layer = document.getElementById(layerId);
  layer.innerHTML = "";
  layer.style.setProperty("--cols", COLS);
  layer.style.setProperty("--rows", ROWS);
  for (const ship of layout) {
    const sunk = isShipSunk(ship, boardState);
    if (!revealAll && !sunk) continue;
    layer.appendChild(buildHullElement(ship, sunk));
  }
}

function renderBoard({ containerId, shipLayerId, boardState, shipSet, layout, own, clickable, heatmap, onClick }) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  container.style.setProperty("--cols", COLS);
  container.style.setProperty("--rows", ROWS);

  const maxDensity = heatmap ? maxDensityValue(heatmap) : 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const cellState = boardState[r][c];
      const isShip = shipSet.has(key(r, c));

      if (cellState === "hit") {
        const sunk = layout.some((ship) => isShipSunk(ship, boardState) && ship.cells.some(([rr, cc]) => rr === r && cc === c));
        if (sunk) {
          cell.classList.add("sunk");
        } else {
          cell.classList.add("hit");
          cell.innerHTML = ICON_HIT;
        }
      } else if (cellState === "miss") {
        cell.classList.add("miss");
        cell.innerHTML = ICON_MISS;
      } else {
        if (own && isShip) cell.classList.add("transparent");
        if (heatmap && maxDensity > 0) {
          const v = heatmap.get(key(r, c));
          const intensity = v / maxDensity;
          if (intensity > 0) {
            cell.classList.add("heat");
            cell.style.setProperty("--heat-intensity", (0.15 + intensity * 0.65).toFixed(3));
          }
        }
      }

      if (clickable && cellState === null) {
        cell.classList.add("clickable");
        cell.addEventListener("click", () => onClick(r, c));
      }

      container.appendChild(cell);
    }
  }

  renderShipLayer(shipLayerId, layout, boardState, own);
}

function render() {
  const heatmap =
    state.heatmapOn && typeof state.attackerAI.currentDensityMap === "function" && state.turn !== "over"
      ? state.attackerAI.currentDensityMap(state.playerBoardState)
      : null;

  renderBoard({
    containerId: "player-board",
    shipLayerId: "player-ship-layer",
    boardState: state.playerBoardState,
    shipSet: state.playerShips,
    layout: state.playerLayout,
    own: true,
    clickable: false,
    heatmap,
    onClick: null,
  });

  renderBoard({
    containerId: "enemy-board",
    shipLayerId: "enemy-ship-layer",
    boardState: state.enemyBoardState,
    shipSet: state.enemyShips,
    layout: state.enemyLayout,
    own: false,
    clickable: state.turn === "player" && !state.winner,
    heatmap: null,
    onClick: onEnemyCellClick,
  });

  document.getElementById("shots-player").textContent = state.shotsPlayer;
  document.getElementById("shots-ai").textContent = state.shotsAI;
  document.getElementById("ships-player").textContent = shipsAfloat(state.playerLayout, state.playerBoardState);
  document.getElementById("ships-enemy").textContent = shipsAfloat(state.enemyLayout, state.enemyBoardState);
}

/* ==================== Benchmark ==================== */

function playGame(aiFactory, rawLayout, sizes) {
  const layout = withCells(rawLayout);
  const ships = shipSetOf(layout);
  const board = makeEmptyBoard();
  const ai = aiFactory(sizes);
  let shots = 0;
  let remaining = ships.size;
  const maxShots = ROWS * COLS;

  while (remaining > 0 && shots < maxShots) {
    const [r, c] = ai.selectNextMove(board);
    if (board[r][c] !== null) throw new Error(`${ai.constructor.name} selected an already-fired cell.`);
    shots++;
    const hit = ships.has(key(r, c));
    const struckShip = hit ? layout.find((ship) => ship.cells.some(([rr, cc]) => rr === r && cc === c)) : null;
    board[r][c] = hit ? "hit" : "miss";
    if (hit) remaining--;
    const sunkShip = struckShip && isShipSunk(struckShip, board) ? struckShip : null;

    if (typeof ai.recordShotResult === "function") {
      ai.recordShotResult({
        row: r,
        col: c,
        hit,
        sunkLength: sunkShip ? sunkShip.length : null,
        sunkCells: sunkShip ? sunkShip.cells : null,
      });
    }
  }
  return shots;
}

function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runBenchmark() {
  const n = Math.max(100, Math.min(200, parseInt(document.getElementById("bench-n").value, 10) || 100));
  const output = document.getElementById("bench-output");
  const button = document.getElementById("bench-run");
  button.disabled = true;

  const sizes = STANDARD_FLEET_SIZES;
  const placer = new PlacementAI();
  // Every algorithm receives the exact same fleet sequence, reducing benchmark noise.
  const layouts = Array.from({ length: n }, () => placer.randomLegalLayout(sizes));
  const nBayes = n;

  const algorithms = [
    { key: "random", label: "RandomAI", games: n, factory: (fleet) => new RandomAI(fleet) },
    { key: "probability", label: "ProbabilityAI", games: n, factory: (fleet) => new ProbabilityAI(fleet) },
    { key: "bayesian", label: "BayesianAI", games: nBayes, factory: (fleet) => new BayesianAI(fleet, { particles: 220, minParticles: 35, resampleBudgetMs: 8, poolPickAttempts: 12 }) },
    { key: "pomcp", label: "POMCPAI", games: n, factory: (fleet) => POMCPAI.benchmark(fleet) },
  ];

  const results = [];
  try {
    for (const algorithm of algorithms) {
      let total = 0;
      let sumSq = 0;
      const started = performance.now();
      for (let i = 0; i < algorithm.games; i++) {
        const shots = playGame(algorithm.factory, layouts[i], sizes);
        total += shots;
        sumSq += shots * shots;
        if (i % 5 === 4 || i + 1 === algorithm.games) {
          output.textContent = `Running ${algorithm.label}: ${i + 1}/${algorithm.games} games...`;
          await yieldToUI();
        }
      }
      const average = total / algorithm.games;
      const variance = Math.max(0, sumSq / algorithm.games - average * average);
      results.push({
        ...algorithm,
        average,
        sd: Math.sqrt(variance),
        elapsed: performance.now() - started,
      });
    }

    const ranked = [...results].sort((a, b) => a.average - b.average);
    const winner = ranked[0];
    output.innerHTML =
      `<div class="benchmark-table-wrap"><table class="benchmark-table">` +
      `<thead><tr><th>Rank</th><th>Algorithm</th><th>Avg. shots</th><th>SD</th><th>Games</th><th>Runtime</th></tr></thead><tbody>` +
      ranked.map((r, i) =>
        `<tr class="${r.key === "pomcp" ? "pomcp-row" : ""}"><td>${i + 1}</td><td>${r.label}</td>` +
        `<td><strong>${r.average.toFixed(2)}</strong></td><td>${r.sd.toFixed(2)}</td><td>${r.games}</td>` +
        `<td>${(r.elapsed / 1000).toFixed(2)}s</td></tr>`
      ).join("") +
      `</tbody></table></div>` +
      `<div class="bench-highlight">Best result: <strong>${winner.label}</strong> at ${winner.average.toFixed(2)} average shots. ` +
      `Bayesian and POMCP both use reduced particle/search budgets in this 100–200 game speed benchmark; the playable opponents use stronger budgets.</div>`;
  } catch (error) {
    output.textContent = `Benchmark failed: ${error.message}`;
    console.error(error);
  } finally {
    button.disabled = false;
  }
}

/* ==================== Wiring ==================== */

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("rotate-ship").addEventListener("click", rotateSelected);
  document.getElementById("smart-place").addEventListener("click", smartAutoPlace);
  document.getElementById("clear-placement").addEventListener("click", clearPlacement);
  document.getElementById("start-battle").addEventListener("click", startBattle);

  document.getElementById("new-game").addEventListener("click", resetToSetup);
  document.querySelectorAll("[data-ai-value]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.getElementById("difficulty").value = tab.dataset.aiValue;
      document.querySelectorAll("[data-ai-value]").forEach((el) => {
        const active = el === tab;
        el.classList.toggle("active", active);
        el.setAttribute("aria-selected", active ? "true" : "false");
      });
    });
  });
  document.getElementById("heatmap-toggle").addEventListener("change", (e) => {
    state.heatmapOn = e.target.checked;
    if (state.phase === "battle") render();
  });
  document.getElementById("bench-run").addEventListener("click", runBenchmark);

  window.addEventListener("keydown", (e) => {
    if (state.phase !== "setup") return;
    if (e.key === "r" || e.key === "R") rotateSelected();
  });

  // Load the offline-optimized diverse placement pool in the background. If
  // it arrives before the first battle, the enemy fleet and "Auto-Place
  // (Smart)" draw from it; otherwise PlacementAI falls back to a live search.
  loadOptimizedLayouts();

  initSetup();
});
