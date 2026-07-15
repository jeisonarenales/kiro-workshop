// game-state.js
//
// GameState is the single source of truth for the game: the puzzle,
// solution, user entries, notes, mistake count, timer, undo history, and
// mode flags (paused/notes/won). It knows nothing about the DOM. Views
// subscribe to its events (via `on`) and re-render in response; controls
// call its methods in response to user input. This Observer-pattern
// separation means BoardView/InfoPanelView never need to be told to
// "re-render" imperatively from scattered call sites — they just listen.

import {
  SIZE, BOX, emptyGrid, emptyNotesGrid, generatePuzzle, getPeerCells,
} from './sudoku-engine.js';
import { saveGame, loadGame, clearSavedGame } from './persistence.js';
import { PuzzleGenerationError, InvalidMoveError, reportError } from './errors.js';

const ERROR_CLEAR_MS = 3000;
const MAX_HISTORY = 200;

/** Minimal pub/sub mixin. Events used: 'change', 'win', 'mistake', 'error'. */
class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach(handler => handler(payload));
  }
}

export class GameState extends Emitter {
  constructor() {
    super();
    this.solution = [];
    this.puzzle = [];
    this.givenMask = [];
    this.userValues = [];
    this.notes = []; // notes[r][c] = Set of candidate numbers
    this.selectedCell = null;
    this.mistakes = 0;
    this.secondsElapsed = 0;
    this.difficulty = 'medium';
    this.gameWon = false;
    this.paused = false;
    this.notesMode = false;

    this._history = []; // undo stack of reversible move records
    this._errorCells = new Set(); // cells currently flagged as errors
    this._errorClearTimers = new Map(); // "r-c" -> timeout id
    this._timerInterval = null;
  }

  // ---------- Derived state helpers ----------

  valueAt(row, col) {
    return this.puzzle[row][col] || this.userValues[row][col];
  }

  isGiven(row, col) {
    return !!this.givenMask[row][col];
  }

  isErrorCell(row, col) {
    return this._errorCells.has(`${row}-${col}`);
  }

  canUndo() {
    return this._history.length > 0;
  }

  /**
   * Computes every board-wide statistic views need in a single pass over
   * the 81 cells (completed rows/cols/boxes, per-digit placement counts,
   * and the count of correctly-filled cells for completion %).
   */
  computeBoardStats() {
    const rowComplete = Array(SIZE).fill(true);
    const colComplete = Array(SIZE).fill(true);
    const boxComplete = Array(SIZE).fill(true);
    const digitCounts = Array(10).fill(0);
    let filledCorrect = 0;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const val = this.valueAt(r, c);
        const correct = val !== 0 && val === this.solution[r][c];
        if (correct) {
          filledCorrect++;
          digitCounts[val]++;
        } else {
          rowComplete[r] = false;
          colComplete[c] = false;
          boxComplete[Math.floor(r / BOX) * BOX + Math.floor(c / BOX)] = false;
        }
      }
    }

    return { rowComplete, colComplete, boxComplete, digitCounts, filledCorrect };
  }

  // ---------- Lifecycle: new game / restore / persistence ----------

  /** Starts a fresh puzzle at the given difficulty, discarding any saved game. */
  newGame(difficulty) {
    this.difficulty = difficulty || this.difficulty;
    try {
      const { puzzle, solution } = generatePuzzle(this.difficulty);
      this.puzzle = puzzle;
      this.solution = solution;
    } catch (error) {
      reportError(
        new PuzzleGenerationError('generatePuzzle failed', { cause: error }),
        (msg) => this.emit('error', msg)
      );
      return false;
    }

    this.givenMask = this.puzzle.map(row => row.map(v => v !== 0));
    this.userValues = emptyGrid();
    this.notes = emptyNotesGrid();
    this.selectedCell = null;
    this.mistakes = 0;
    this.secondsElapsed = 0;
    this.gameWon = false;
    this.paused = false;
    this._history = [];
    this._errorCells.clear();
    this._clearAllErrorTimers();

    this._startTimer();
    this._persist();
    this.emit('change', { reason: 'new-game' });
    return true;
  }

  /** Attempts to restore a previously saved game. Returns true if restored. */
  restore() {
    let saved;
    try {
      saved = loadGame();
    } catch (error) {
      reportError(error, (msg) => this.emit('error', msg));
      return false;
    }
    if (!saved) return false;

    this.puzzle = saved.puzzle;
    this.solution = saved.solution;
    this.givenMask = saved.givenMask || this.puzzle.map(row => row.map(v => v !== 0));
    this.userValues = saved.userValues || emptyGrid();
    this.notes = saved.notes || emptyNotesGrid();
    this.mistakes = saved.mistakes || 0;
    this.secondsElapsed = saved.secondsElapsed || 0;
    this.gameWon = !!saved.gameWon;
    this.difficulty = saved.difficulty || this.difficulty;
    this.selectedCell = null;
    this.paused = false;
    this._history = [];
    this._errorCells.clear();
    this._clearAllErrorTimers();

    if (!this.gameWon) this._startTimer(true);
    this.emit('change', { reason: 'restore' });
    return true;
  }

  _persist() {
    try {
      saveGame({
        puzzle: this.puzzle,
        solution: this.solution,
        givenMask: this.givenMask,
        userValues: this.userValues,
        notes: this.notes,
        mistakes: this.mistakes,
        secondsElapsed: this.secondsElapsed,
        difficulty: this.difficulty,
        gameWon: this.gameWon,
      });
    } catch (error) {
      reportError(error, (msg) => this.emit('error', msg));
    }
  }

  _clearSaved() {
    try {
      clearSavedGame();
    } catch (error) {
      reportError(error, (msg) => this.emit('error', msg));
    }
  }

  // ---------- Selection ----------

  selectCell(row, col) {
    if (this.gameWon || this.paused) return;
    this.selectedCell = { row, col };
    this.emit('change', { reason: 'select' });
  }

  // ---------- Gameplay actions ----------

  /**
   * Places `num` in the currently selected cell (or toggles a pencil-mark
   * note if notes mode is on). `num === 0` erases the cell. No-ops (without
   * throwing) if nothing is selected or the cell is a given clue, mirroring
   * how the UI already prevents those interactions — but still guards here
   * since GameState must be safe to drive programmatically too.
   */
  placeNumber(num) {
    if (!this.selectedCell || this.gameWon || this.paused) return;
    const { row, col } = this.selectedCell;
    if (this.givenMask[row][col]) return;

    if (this.notesMode && num !== 0) {
      this._toggleNote(row, col, num);
      return;
    }

    if (num === 0) {
      this._eraseCell(row, col);
      return;
    }

    this._placeValue(row, col, num);
  }

  _toggleNote(row, col, num) {
    if (this.userValues[row][col] !== 0) return; // no notes on filled cells
    this._pushHistory(row, col);
    if (this.notes[row][col].has(num)) {
      this.notes[row][col].delete(num);
    } else {
      this.notes[row][col].add(num);
    }
    this._persist();
    this.emit('change', { reason: 'note', row, col });
  }

  _eraseCell(row, col) {
    this._pushHistory(row, col);
    this.userValues[row][col] = 0;
    this.notes[row][col] = new Set();
    this._clearErrorTimer(row, col);
    this._errorCells.delete(`${row}-${col}`);
    this._persist();
    this.emit('change', { reason: 'erase', row, col });
  }

  _placeValue(row, col, num) {
    const isCorrect = num === this.solution[row][col];
    // When the placement is correct, that number is no longer a valid
    // candidate for any peer cell (same row/column/box), so clear it from
    // their pencil marks too — snapshot them first so Undo can restore them.
    const peersToClear = isCorrect ? this._findPeerCellsWithNote(row, col, num) : [];
    this._pushHistory(row, col, peersToClear);

    this.userValues[row][col] = num;
    this.notes[row][col] = new Set();
    peersToClear.forEach(({ r, c }) => this.notes[r][c].delete(num));

    const key = `${row}-${col}`;
    if (!isCorrect) {
      this.mistakes++;
      this._errorCells.add(key);
      this._scheduleErrorClear(row, col);
      this.emit('mistake', { row, col });
    } else {
      this._clearErrorTimer(row, col);
      this._errorCells.delete(key);
      this.emit('placed', { row, col });
    }

    this._persist();
    this.emit('change', { reason: 'place', row, col, isCorrect });
    this._checkWin();
  }

  _findPeerCellsWithNote(row, col, num) {
    return getPeerCells(row, col).filter(({ r, c }) => this.notes[r][c] && this.notes[r][c].has(num));
  }

  erase() {
    if (!this.selectedCell) return;
    this.placeNumber(0);
  }

  /** Fills a random incorrect/empty non-given cell with its correct value. */
  hint() {
    if (this.gameWon || this.paused) return null;
    const emptyCells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this.givenMask[r][c] && this.userValues[r][c] !== this.solution[r][c]) {
          emptyCells.push({ r, c });
        }
      }
    }
    if (emptyCells.length === 0) return null;

    const { r, c } = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const hintValue = this.solution[r][c];
    const peersToClear = this._findPeerCellsWithNote(r, c, hintValue);
    this._pushHistory(r, c, peersToClear);
    this.userValues[r][c] = hintValue;
    this.notes[r][c] = new Set();
    peersToClear.forEach(({ r: pr, c: pc }) => this.notes[pr][pc].delete(hintValue));

    this.selectedCell = { row: r, col: c };
    this._persist();
    this.emit('change', { reason: 'hint', row: r, col: c });
    this.emit('placed', { row: r, col: c });
    this._checkWin();
    return { row: r, col: c };
  }

  /** Validates all user-filled cells, flagging any that are incorrect. */
  check() {
    this._errorCells.clear();
    let hasError = false;
    let hasEmpty = false;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.givenMask[r][c]) continue;
        const val = this.userValues[r][c];
        if (val === 0) {
          hasEmpty = true;
          continue;
        }
        if (val !== this.solution[r][c]) {
          hasError = true;
          this._errorCells.add(`${r}-${c}`);
          this._scheduleErrorClear(r, c);
        }
      }
    }

    this.emit('change', { reason: 'check' });

    if (hasError) return 'error';
    if (hasEmpty) return 'incomplete';
    this._checkWin();
    return 'complete';
  }

  /** Reveals the full solution and ends the game (not counted as a win). */
  solve() {
    if (this.gameWon) return;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this.givenMask[r][c]) {
          this.userValues[r][c] = this.solution[r][c];
          this.notes[r][c] = new Set();
        }
      }
    }
    this.gameWon = true;
    this._stopTimer();
    this._history = [];
    this._errorCells.clear();
    this._clearSaved();
    this.emit('change', { reason: 'solve' });
  }

  /** Clears all user entries/notes/mistakes for the current puzzle, keeping the same puzzle. */
  reset() {
    this.userValues = emptyGrid();
    this.notes = emptyNotesGrid();
    this.mistakes = 0;
    this.gameWon = false;
    this._history = [];
    this._errorCells.clear();
    this._clearAllErrorTimers();
    this._startTimer();
    this._persist();
    this.emit('change', { reason: 'reset' });
  }

  toggleNotesMode() {
    this.notesMode = !this.notesMode;
    this.emit('change', { reason: 'notes-mode' });
  }

  setPaused(value) {
    this.paused = value;
    if (this.paused) {
      this._stopTimer();
    } else if (!this.gameWon) {
      this._startTimer(true);
    }
    this.emit('change', { reason: 'pause' });
  }

  // ---------- Undo ----------

  _pushHistory(row, col, extraNoteChanges) {
    this._history.push({
      row,
      col,
      prevValue: this.userValues[row][col],
      prevNotes: new Set(this.notes[row][col]),
      prevMistakes: this.mistakes,
      prevErrorFlag: this._errorCells.has(`${row}-${col}`),
      // Snapshot of any peer cells whose notes are about to change (e.g.
      // when placing a correct number clears that candidate from peer
      // pencil-marks), so Undo can restore them exactly.
      peerNoteSnapshots: (extraNoteChanges || []).map(({ r, c }) => ({ r, c, prevNotes: new Set(this.notes[r][c]) })),
    });
    if (this._history.length > MAX_HISTORY) this._history.shift();
  }

  undo() {
    if (this._history.length === 0 || this.gameWon || this.paused) {
      throw new InvalidMoveError('Nothing to undo.');
    }
    const last = this._history.pop();
    this.userValues[last.row][last.col] = last.prevValue;
    this.notes[last.row][last.col] = last.prevNotes;
    last.peerNoteSnapshots.forEach(({ r, c, prevNotes }) => {
      this.notes[r][c] = prevNotes;
    });
    this.mistakes = last.prevMistakes;

    const key = `${last.row}-${last.col}`;
    this._clearErrorTimer(last.row, last.col);
    if (last.prevErrorFlag) {
      this._errorCells.add(key);
    } else {
      this._errorCells.delete(key);
    }

    this._persist();
    this.emit('change', { reason: 'undo', row: last.row, col: last.col });
  }

  // ---------- Error auto-clear ----------

  _clearErrorTimer(row, col) {
    const key = `${row}-${col}`;
    const timerId = this._errorClearTimers.get(key);
    if (timerId) {
      clearTimeout(timerId);
      this._errorClearTimers.delete(key);
    }
  }

  _clearAllErrorTimers() {
    this._errorClearTimers.forEach(timerId => clearTimeout(timerId));
    this._errorClearTimers.clear();
  }

  _scheduleErrorClear(row, col) {
    this._clearErrorTimer(row, col);
    const key = `${row}-${col}`;
    const timerId = setTimeout(() => {
      this._errorCells.delete(key);
      this._errorClearTimers.delete(key);
      this.emit('change', { reason: 'error-clear', row, col });
    }, ERROR_CLEAR_MS);
    this._errorClearTimers.set(key, timerId);
  }

  // ---------- Win detection ----------

  _checkWin() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.valueAt(r, c) !== this.solution[r][c]) return false;
      }
    }
    this.gameWon = true;
    this._stopTimer();
    this._clearSaved();
    this.emit('win', {
      secondsElapsed: this.secondsElapsed,
      mistakes: this.mistakes,
      difficulty: this.difficulty,
    });
    return true;
  }

  // ---------- Timer ----------

  _startTimer(resumeOnly) {
    this._stopTimer();
    if (!resumeOnly) this.secondsElapsed = 0;
    this._timerInterval = setInterval(() => {
      this.secondsElapsed++;
      this._persist();
      this.emit('tick', { secondsElapsed: this.secondsElapsed });
    }, 1000);
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }
}
