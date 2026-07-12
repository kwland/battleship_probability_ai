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
