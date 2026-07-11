/* Game state + UI wiring for the interactive Battleship AI demo. */

const state = {
  playerShips: null, // Set<"r,c"> -- your fleet, attacked by the AI
  enemyShips: null, // Set<"r,c"> -- enemy fleet, attacked by you
  playerBoardState: null, // grid the AI has fired at (your fleet's perspective)
  enemyBoardState: null, // grid you have fired at (enemy fleet's perspective)
  attackerAI: null,
  turn: "player", // "player" | "ai" | "over"
  winner: null,
  shotsPlayer: 0,
  shotsAI: 0,
  heatmapOn: true,
};

function cellSetToBoard(cellSet, board) {
  // used only for rendering "your fleet" ship silhouettes
  return board;
}

function allSunk(shipSet, boardState) {
  for (const k of shipSet) {
    const [r, c] = k.split(",").map(Number);
    if (boardState[r][c] !== "hit") return false;
  }
  return true;
}

function newGame() {
  const sizes = STANDARD_FLEET_SIZES;

  const placer = new PlacementAI();
  const playerLayout = placer.placeShips(sizes);
  const enemyLayout = placer.placeShips(sizes);

  state.playerShips = placer.shipCellSet(playerLayout);
  state.enemyShips = placer.shipCellSet(enemyLayout);
  state.playerBoardState = makeEmptyBoard();
  state.enemyBoardState = makeEmptyBoard();

  const difficulty = document.getElementById("difficulty").value;
  state.attackerAI = difficulty === "random" ? new RandomAI(sizes) : new ProbabilityAI(sizes);

  state.turn = "player";
  state.winner = null;
  state.shotsPlayer = 0;
  state.shotsAI = 0;

  setStatus("Your move — fire on the enemy waters.");
  render();
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

  if (allSunk(state.enemyShips, state.enemyBoardState)) {
    state.winner = "player";
    state.turn = "over";
    setStatus(`You sank the enemy fleet in ${state.shotsPlayer} shots! 🎉`);
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

  if (allSunk(state.playerShips, state.playerBoardState)) {
    state.winner = "ai";
    state.turn = "over";
    setStatus(`The AI sank your fleet in ${state.shotsAI} shots. Try again!`);
    render();
    return;
  }

  state.turn = "player";
  setStatus(hit ? "The AI hit one of your ships! Your move." : "The AI missed. Your move.");
  render();
}

/* ---------------- Rendering ---------------- */

function render() {
  renderBoard({
    containerId: "player-board",
    boardState: state.playerBoardState,
    shipSet: state.playerShips,
    revealShips: true,
    clickable: false,
    heatmap:
      state.heatmapOn && state.attackerAI instanceof ProbabilityAI && state.turn !== "over"
        ? state.attackerAI.currentDensityMap(state.playerBoardState)
        : null,
  });

  renderBoard({
    containerId: "enemy-board",
    boardState: state.enemyBoardState,
    shipSet: state.enemyShips,
    revealShips: false,
    clickable: state.turn === "player" && !state.winner,
    heatmap: null,
    onClick: onEnemyCellClick,
  });

  document.getElementById("shots-player").textContent = state.shotsPlayer;
  document.getElementById("shots-ai").textContent = state.shotsAI;
  document.getElementById("ships-player").textContent = shipsRemaining(state.playerShips, state.playerBoardState);
  document.getElementById("ships-enemy").textContent = shipsRemaining(state.enemyShips, state.enemyBoardState);
}

function shipsRemaining(shipSet, boardState) {
  // Approximate "ships remaining" by counting how many of the 5 ships still
  // have at least one un-hit cell -- good enough for a scoreboard display.
  // We reconstruct ship groups from the fleet sizes actually placed.
  let hitCells = 0;
  for (const k of shipSet) {
    const [r, c] = k.split(",").map(Number);
    if (boardState[r][c] === "hit") hitCells++;
  }
  const totalCells = shipSet.size;
  const fractionSunk = hitCells / totalCells;
  return Math.max(0, Math.round((1 - fractionSunk) * STANDARD_FLEET.length));
}

function maxDensityValue(densityMap) {
  let max = 0;
  for (const v of densityMap.values()) if (v > max) max = v;
  return max;
}

function renderBoard({ containerId, boardState, shipSet, revealShips, clickable, heatmap, onClick }) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  container.style.setProperty("--cols", COLS);

  const maxDensity = heatmap ? maxDensityValue(heatmap) : 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const state_ = boardState[r][c];
      const isShip = shipSet.has(key(r, c));

      if (state_ === "hit") {
        cell.classList.add(isShip ? "hit" : "hit"); // hit is always a ship cell by construction
      } else if (state_ === "miss") {
        cell.classList.add("miss");
      } else {
        if (revealShips && isShip) cell.classList.add("ship");
        if (heatmap && maxDensity > 0) {
          const v = heatmap.get(key(r, c));
          const intensity = v / maxDensity;
          if (intensity > 0) {
            cell.classList.add("heat");
            cell.style.setProperty("--heat-intensity", (0.15 + intensity * 0.65).toFixed(3));
          }
        }
      }

      if (clickable && state_ === null) {
        cell.classList.add("clickable");
        cell.addEventListener("click", () => onClick(r, c));
      }

      container.appendChild(cell);
    }
  }
}

/* ---------------- Benchmark ---------------- */

function runBenchmark() {
  const n = Math.max(10, Math.min(1000, parseInt(document.getElementById("bench-n").value, 10) || 200));
  const output = document.getElementById("bench-output");
  const button = document.getElementById("bench-run");

  button.disabled = true;
  output.textContent = `Running ${n} games per AI...`;

  setTimeout(() => {
    const sizes = STANDARD_FLEET_SIZES;
    const placer = new PlacementAI();

    function playGame(AIClass, ships) {
      const board = makeEmptyBoard();
      const ai = new AIClass(sizes);
      let shots = 0;
      let remaining = ships.size;
      const maxShots = ROWS * COLS;
      while (remaining > 0 && shots < maxShots) {
        const [r, c] = ai.selectNextMove(board);
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

    let totalRandom = 0;
    let totalProb = 0;
    for (let i = 0; i < n; i++) {
      const layout = placer.randomLegalLayout(sizes);
      const ships = placer.shipCellSet(layout);
      totalRandom += playGame(RandomAI, ships);
      totalProb += playGame(ProbabilityAI, ships);
    }

    const avgRandom = totalRandom / n;
    const avgProb = totalProb / n;
    const improvement = ((avgRandom - avgProb) / avgRandom) * 100;

    output.innerHTML =
      `<div>RandomAI: avg <strong>${avgRandom.toFixed(1)}</strong> shots to win</div>` +
      `<div>ProbabilityAI: avg <strong>${avgProb.toFixed(1)}</strong> shots to win</div>` +
      `<div class="bench-highlight">ProbabilityAI wins with ${improvement.toFixed(1)}% fewer shots on average.</div>`;

    button.disabled = false;
  }, 30);
}

/* ---------------- Wiring ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("new-game").addEventListener("click", newGame);
  document.getElementById("difficulty").addEventListener("change", newGame);
  document.getElementById("heatmap-toggle").addEventListener("change", (e) => {
    state.heatmapOn = e.target.checked;
    render();
  });
  document.getElementById("bench-run").addEventListener("click", runBenchmark);

  newGame();
});
