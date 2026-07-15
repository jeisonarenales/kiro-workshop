// sudoku-engine.js
//
// Pure Sudoku game logic: grid utilities, the bitmask/MRV backtracking
// solver, and the puzzle generator. This module has zero DOM references and
// zero dependencies on browser globals (aside from Math.random for
// shuffling), so it can be unit-tested or reused headlessly.

export const SIZE = 9;
export const BOX = 3;

export function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

export function emptyNotesGrid() {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => new Set()));
}

export function cloneGrid(grid) {
  return grid.map(row => row.slice());
}

export function boxIndexOf(row, col) {
  return Math.floor(row / BOX) * BOX + Math.floor(col / BOX);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Linear-scan validity check, kept for clarity/testing purposes. The hot
 * paths (fillGrid/countSolutions) use the bitmask-based solver core below
 * instead, since this is O(SIZE) per call.
 */
export function isValidPlacement(grid, row, col, num) {
  for (let i = 0; i < SIZE; i++) {
    if (grid[row][i] === num || grid[i][col] === num) return false;
  }
  const boxRow = Math.floor(row / BOX) * BOX;
  const boxCol = Math.floor(col / BOX) * BOX;
  for (let r = 0; r < BOX; r++) {
    for (let c = 0; c < BOX; c++) {
      if (grid[boxRow + r][boxCol + c] === num) return false;
    }
  }
  return true;
}

// ---------- Bitmask solver core ----------
//
// rowMask[r]/colMask[c]/boxMask[b] each track, via bit (1 << num), which
// digits 1-9 are already used in that row/column/box. Placement validity and
// candidate enumeration become O(1) bitwise operations instead of O(SIZE)
// linear scans, and cells are chosen using minimum-remaining-candidates
// (MRV) ordering to prune the search tree aggressively — this is what keeps
// "hard" generation consistently fast instead of occasionally hitting a
// slow, deeply-backtracked branch.

function createMaskState() {
  return {
    rowMask: new Array(SIZE).fill(0),
    colMask: new Array(SIZE).fill(0),
    boxMask: new Array(SIZE).fill(0),
  };
}

function maskStateFromGrid(grid) {
  const state = createMaskState();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const num = grid[r][c];
      if (num !== 0) {
        const bit = 1 << num;
        const b = boxIndexOf(r, c);
        state.rowMask[r] |= bit;
        state.colMask[c] |= bit;
        state.boxMask[b] |= bit;
      }
    }
  }
  return state;
}

function candidateMask(state, row, col) {
  const b = boxIndexOf(row, col);
  const used = state.rowMask[row] | state.colMask[col] | state.boxMask[b];
  return 0x3FE & ~used; // bits 1..9, excluding already-used digits
}

function popCount(mask) {
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count++;
  }
  return count;
}

/**
 * Finds the empty cell with the fewest remaining valid candidates (MRV
 * heuristic). Returns null if the grid is fully filled, or an object with
 * `dead: true` if some empty cell has zero valid candidates (dead end).
 */
function findMrvCell(grid, state) {
  let best = null;
  let bestCount = 10;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] !== 0) continue;
      const mask = candidateMask(state, r, c);
      const count = popCount(mask);
      if (count === 0) return { row: r, col: c, mask, dead: true };
      if (count < bestCount) {
        bestCount = count;
        best = { row: r, col: c, mask, dead: false };
        if (count === 1) return best; // can't do better than a single candidate
      }
    }
  }
  return best;
}

function maskToShuffledNums(mask) {
  const nums = [];
  for (let n = 1; n <= 9; n++) {
    if (mask & (1 << n)) nums.push(n);
  }
  return shuffle(nums);
}

/**
 * Fills `grid` in place with a complete, valid, randomized Sudoku solution
 * using MRV-ordered backtracking. Returns true on success.
 */
export function fillGrid(grid) {
  const state = maskStateFromGrid(grid);

  function place(row, col, num) {
    const bit = 1 << num;
    const b = boxIndexOf(row, col);
    grid[row][col] = num;
    state.rowMask[row] |= bit;
    state.colMask[col] |= bit;
    state.boxMask[b] |= bit;
  }

  function unplace(row, col, num) {
    const bit = ~(1 << num);
    const b = boxIndexOf(row, col);
    grid[row][col] = 0;
    state.rowMask[row] &= bit;
    state.colMask[col] &= bit;
    state.boxMask[b] &= bit;
  }

  function solve() {
    const cell = findMrvCell(grid, state);
    if (!cell) return true; // no empty cells left, grid is complete
    if (cell.dead) return false; // an empty cell has no valid candidates

    const nums = maskToShuffledNums(cell.mask);
    for (const num of nums) {
      place(cell.row, cell.col, num);
      if (solve()) return true;
      unplace(cell.row, cell.col, num);
    }
    return false;
  }

  return solve();
}

export function generateSolvedGrid() {
  const grid = emptyGrid();
  fillGrid(grid);
  return grid;
}

/**
 * Counts up to `limit` distinct solutions for `grid` (mutated as scratch
 * space, restored to its original empty cells on return). Used during
 * puzzle generation to verify a candidate puzzle has exactly one solution.
 */
export function countSolutions(grid, limit) {
  let count = 0;
  const state = maskStateFromGrid(grid);

  function place(row, col, num) {
    const bit = 1 << num;
    const b = boxIndexOf(row, col);
    grid[row][col] = num;
    state.rowMask[row] |= bit;
    state.colMask[col] |= bit;
    state.boxMask[b] |= bit;
  }

  function unplace(row, col, num) {
    const bit = ~(1 << num);
    const b = boxIndexOf(row, col);
    grid[row][col] = 0;
    state.rowMask[row] &= bit;
    state.colMask[col] &= bit;
    state.boxMask[b] &= bit;
  }

  function solve() {
    if (count >= limit) return;
    const cell = findMrvCell(grid, state);
    if (!cell) {
      count++;
      return;
    }
    if (cell.dead) return;

    const nums = maskToShuffledNums(cell.mask);
    for (const num of nums) {
      if (count >= limit) return;
      place(cell.row, cell.col, num);
      solve();
      unplace(cell.row, cell.col, num);
    }
  }

  solve();
  return count;
}

// ---------- Difficulty & puzzle generation ----------

export const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

const CLUES_TO_REMOVE = {
  easy: 38,
  medium: 47,
  hard: 55,
};

export function difficultyToClues(level) {
  return CLUES_TO_REMOVE[level] ?? CLUES_TO_REMOVE.medium;
}

/**
 * Generates a puzzle for the given difficulty. Returns { puzzle, solution },
 * where `puzzle` has exactly `81 - difficultyToClues(level)` clues removed
 * while still being guaranteed to have a unique solution.
 */
export function generatePuzzle(level) {
  const solved = generateSolvedGrid();
  const grid = cloneGrid(solved);
  const cellsToRemove = difficultyToClues(level);
  const positions = shuffle(
    Array.from({ length: SIZE * SIZE }, (_, i) => i)
  );

  let removed = 0;
  for (const pos of positions) {
    if (removed >= cellsToRemove) break;
    const row = Math.floor(pos / SIZE);
    const col = pos % SIZE;
    const backup = grid[row][col];
    if (backup === 0) continue;
    grid[row][col] = 0;

    const testGrid = cloneGrid(grid);
    const solutions = countSolutions(testGrid, 2);
    if (solutions !== 1) {
      grid[row][col] = backup;
    } else {
      removed++;
    }
  }

  return { puzzle: grid, solution: solved };
}

/**
 * Returns the list of peer cell coordinates (same row, column, or 3x3 box)
 * for a given cell, excluding the cell itself.
 */
export function getPeerCells(row, col) {
  const peers = [];
  const boxRow = Math.floor(row / BOX) * BOX;
  const boxCol = Math.floor(col / BOX) * BOX;
  for (let i = 0; i < SIZE; i++) {
    if (i !== col) peers.push({ r: row, c: i });
    if (i !== row) peers.push({ r: i, c: col });
  }
  for (let r = boxRow; r < boxRow + BOX; r++) {
    for (let c = boxCol; c < boxCol + BOX; c++) {
      if (r !== row && c !== col) peers.push({ r, c });
    }
  }
  return peers;
}
