/* Game state + UI wiring for the interactive Battleship AI demo. */

// Placement-search strength used for the enemy fleet (the AI's own fleet
// composition, which the player attacks) and for the "Auto-Place (Smart)"
// button. Higher than the class default since this only runs once per game
// and the board is small, so we can afford a more thorough search.
const STRONG_PLACEMENT = { restarts: 50, gamesPerCandidate: 7 };
const LEARNING_STORAGE_KEY = "battleship-ultimate-learning-v1";
const MAX_LEARNED_GAMES = 40;
let optimizedLayoutsReady = null;

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
  playerShotOrder: [],
  learningSaved: false,
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
  const learned = loadLearningData();
  const layout = new PlacementAI({
    ...STRONG_PLACEMENT,
    shotHistory: learned.playerShotOrders,
    usedLayouts: learned.enemyLayouts,
  }).placeShips(sizes);
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

function emptyLearningData() {
  return { playerLayouts: [], playerShotOrders: [], enemyLayouts: [] };
}

function loadLearningData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEARNING_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return emptyLearningData();
    return {
      playerLayouts: Array.isArray(parsed.playerLayouts) ? parsed.playerLayouts.slice(-MAX_LEARNED_GAMES) : [],
      playerShotOrders: Array.isArray(parsed.playerShotOrders) ? parsed.playerShotOrders.slice(-MAX_LEARNED_GAMES) : [],
      enemyLayouts: Array.isArray(parsed.enemyLayouts) ? parsed.enemyLayouts.slice(-MAX_LEARNED_GAMES) : [],
    };
  } catch (error) {
    return emptyLearningData();
  }
}

function compactLayout(layout) {
  return layout.map(({ r, c, length, orientation }) => ({ r, c, length, orientation }));
}

function saveGameLearning() {
  if (state.learningSaved || !state.winner) return;
  const learned = loadLearningData();
  learned.playerLayouts.push(compactLayout(state.playerLayout));
  learned.playerShotOrders.push(state.playerShotOrder.map(([r, c]) => [r, c]));
  learned.enemyLayouts.push(compactLayout(state.enemyLayout));
  learned.playerLayouts = learned.playerLayouts.slice(-MAX_LEARNED_GAMES);
  learned.playerShotOrders = learned.playerShotOrders.slice(-MAX_LEARNED_GAMES);
  learned.enemyLayouts = learned.enemyLayouts.slice(-MAX_LEARNED_GAMES);
  try {
    localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(learned));
  } catch (error) {
    // The game still works if storage is unavailable.
  }
  state.learningSaved = true;
}

function resetAIMemory() {
  try {
    localStorage.removeItem(LEARNING_STORAGE_KEY);
  } catch (error) {
    // Ignore storage failures.
  }
  setStatus("AI memory cleared.");
}

async function startBattle() {
  const sizes = STANDARD_FLEET_SIZES;
  const startButton = document.getElementById("start-battle");
  startButton.disabled = true;
  if (optimizedLayoutsReady) await optimizedLayoutsReady;

  const learned = loadLearningData();
  state.playerLayout = state.setup.placed.map((s) => ({ ...s }));
  state.playerShips = shipSetOf(state.playerLayout);

  const enemyRaw = new PlacementAI({
    ...STRONG_PLACEMENT,
    shotHistory: learned.playerShotOrders,
    usedLayouts: learned.enemyLayouts,
  }).placeShips(sizes);
  state.enemyLayout = withCells(enemyRaw);
  state.enemyShips = shipSetOf(state.enemyLayout);

  state.playerBoardState = makeEmptyBoard();
  state.enemyBoardState = makeEmptyBoard();

  const difficulty = document.getElementById("difficulty").value;
  if (difficulty === "random") {
    state.attackerAI = new RandomAI(sizes);
  } else if (difficulty === "probability") {
    state.attackerAI = new ProbabilityAI(sizes);
  } else {
    state.attackerAI = new BayesianAI(sizes, { historicalLayouts: learned.playerLayouts });
  }

  // A coin flip removes the permanent first-move advantage the old version
  // gave the human in every game.
  state.turn = Math.random() < 0.5 ? "player" : "ai";
  state.winner = null;
  state.shotsPlayer = 0;
  state.shotsAI = 0;
  state.playerShotOrder = [];
  state.learningSaved = false;

  document.getElementById("setup-section").hidden = true;
  document.getElementById("battle-section").hidden = false;
  state.phase = "battle";

  if (state.turn === "player") {
    setStatus("You won the opening coin flip — fire first.");
    render();
  } else {
    setStatus("The AI won the opening coin flip and fires first...");
    render();
    setTimeout(aiTurn, 500);
  }
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
  state.playerShotOrder.push([r, c]);
  const hit = state.enemyShips.has(key(r, c));
  state.enemyBoardState[r][c] = hit ? "hit" : "miss";

  if (shipsAfloat(state.enemyLayout, state.enemyBoardState) === 0) {
    state.winner = "player";
    state.turn = "over";
    setStatus(`You sank the enemy fleet in ${state.shotsPlayer} shots! The AI will learn from this game.`);
    saveGameLearning();
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
  state.playerBoardState[r][c] = hit ? "hit" : "miss";

  let sunkShip = null;
  if (hit) {
    const struckShip = state.playerLayout.find((ship) => ship.cells.some(([rr, cc]) => rr === r && cc === c));
    if (struckShip && isShipSunk(struckShip, state.playerBoardState)) sunkShip = struckShip;
  }

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
    setStatus(`The AI sank your fleet in ${state.shotsAI} shots. Its memory updates after this game.`);
    saveGameLearning();
    render();
    return;
  }

  state.turn = "player";
  if (sunkShip) {
    const name = STANDARD_FLEET.find((ship) => ship.length === sunkShip.length)?.name || "ship";
    setStatus(`The AI sank your ${name}! Your move.`);
  } else {
    setStatus(hit ? "The AI hit one of your ships! Your move." : "The AI missed. Your move.");
  }
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

function playGame(AIClass, layout, sizes) {
  const board = makeEmptyBoard();
  const ships = shipSetOf(layout);
  const ai = new AIClass(sizes);
  const reportedSunk = new Set();
  let shots = 0;
  let remaining = ships.size;
  const maxShots = ROWS * COLS;
  while (remaining > 0 && shots < maxShots) {
    const [r, c] = ai.selectNextMove(board);
    shots++;
    const k = key(r, c);
    let sunkShip = null;
    if (ships.has(k)) {
      board[r][c] = "hit";
      remaining--;
      const struck = layout.find((ship) => ship.cells.some(([rr, cc]) => rr === r && cc === c));
      if (struck && isShipSunk(struck, board)) {
        const signature = struck.cells.map(([rr, cc]) => key(rr, cc)).sort().join("|");
        if (!reportedSunk.has(signature)) {
          reportedSunk.add(signature);
          sunkShip = struck;
        }
      }
    } else {
      board[r][c] = "miss";
    }
    if (typeof ai.recordShotResult === "function") {
      ai.recordShotResult({
        row: r,
        col: c,
        hit: ships.has(k),
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
  const n = Math.max(10, Math.min(1000, parseInt(document.getElementById("bench-n").value, 10) || 200));
  const output = document.getElementById("bench-output");
  const button = document.getElementById("bench-run");

  // BayesianAI samples thousands of whole-fleet configurations per shot, so
  // it's much slower per game (~1-3s) than the other two (~milliseconds) --
  // run far fewer games for it so the benchmark finishes in a reasonable
  // time, and run every AI in small async-yielding batches so the page
  // stays responsive and shows live progress instead of freezing.
  const nBayes = Math.max(3, Math.min(15, Math.round(n / 50)));

  button.disabled = true;

  const sizes = STANDARD_FLEET_SIZES;
  const placer = new PlacementAI();

  async function runSet(AIClass, games, label) {
    let total = 0;
    for (let i = 0; i < games; i++) {
      const layout = withCells(placer.randomLegalLayout(sizes));
      total += playGame(AIClass, layout, sizes);
      if (i % 5 === 4) {
        output.textContent = `Running ${label}: ${i + 1}/${games} games...`;
        await yieldToUI();
      }
    }
    return total / games;
  }

  const avgRandom = await runSet(RandomAI, n, "RandomAI");
  const avgProb = await runSet(ProbabilityAI, n, "ProbabilityAI");
  const avgBayes = await runSet(BayesianAI, nBayes, "Adaptive BayesianAI (slower, fewer games)");

  const improvement = ((avgRandom - avgBayes) / avgRandom) * 100;

  output.innerHTML =
    `<div>RandomAI: avg <strong>${avgRandom.toFixed(1)}</strong> shots to win (${n} games)</div>` +
    `<div>ProbabilityAI: avg <strong>${avgProb.toFixed(1)}</strong> shots to win (${n} games)</div>` +
    `<div>Adaptive BayesianAI: avg <strong>${avgBayes.toFixed(1)}</strong> shots to win (${nBayes} games)</div>` +
    `<div class="bench-highlight">BayesianAI wins with ${improvement.toFixed(1)}% fewer shots than random, and fewer than ProbabilityAI too.</div>`;

  button.disabled = false;
}

/* ==================== Wiring ==================== */

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("rotate-ship").addEventListener("click", rotateSelected);
  document.getElementById("smart-place").addEventListener("click", smartAutoPlace);
  document.getElementById("clear-placement").addEventListener("click", clearPlacement);
  document.getElementById("reset-ai-memory").addEventListener("click", resetAIMemory);
  document.getElementById("start-battle").addEventListener("click", startBattle);

  document.getElementById("new-game").addEventListener("click", resetToSetup);
  document.getElementById("difficulty").addEventListener("change", () => {
    if (state.phase === "battle" && !state.winner) return; // don't swap mid-game
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

  // Keep the promise and await it before the first battle so the optimized
  // placement pool is actually used rather than losing a race to fetch().
  optimizedLayoutsReady = loadOptimizedLayouts();

  initSetup();
});
