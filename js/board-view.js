// board-view.js
//
// BoardView owns all board DOM: creating the 81 cells once, caching
// references (cells + note spans), diff-based re-rendering, and
// highlighting. It reads from a GameState instance and re-renders in
// response to its 'change' events, but never mutates GameState directly —
// user interaction (click/keydown) is reported upward via the `onSelect`/
// `onKeyAction` callbacks supplied at construction, which the controls
// module wires to GameState methods. This keeps rendering and input-to-
// action translation cleanly separated.

import { SIZE, BOX } from './sudoku-engine.js';

export class BoardView {
  /**
   * @param {HTMLElement} boardEl
   * @param {import('./game-state.js').GameState} state
   * @param {{ onSelect: (row: number, col: number) => void, onDigitKey: (row: number, col: number, digit: number) => void }} handlers
   */
  constructor(boardEl, state, handlers) {
    this.boardEl = boardEl;
    this.state = state;
    this.handlers = handlers;

    this.cellEls = [];
    this.cellNoteSpans = [];
    this.prevCellState = [];

    this._buildDom();

    state.on('change', () => this.render());
    state.on('mistake', ({ row, col }) => this._playShakeAnim(row, col));
    state.on('placed', ({ row, col }) => this.playPlacedAnim(row, col));
  }

  _buildDom() {
    this.boardEl.innerHTML = '';
    this.cellEls = Array.from({ length: SIZE }, () => new Array(SIZE));
    this.cellNoteSpans = Array.from({ length: SIZE }, () => new Array(SIZE));
    this.prevCellState = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));

    for (let r = 0; r < SIZE; r++) {
      const rowEl = document.createElement('div');
      rowEl.setAttribute('role', 'row');
      rowEl.style.display = 'contents';
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('tabindex', '0');
        if ((c + 1) % BOX === 0 && c !== SIZE - 1) cell.classList.add('border-right');
        if ((r + 1) % BOX === 0 && r !== SIZE - 1) cell.classList.add('border-bottom');

        cell.addEventListener('click', () => this.handlers.onSelect(r, c));
        cell.addEventListener('focus', () => this.handlers.onSelect(r, c, { skipFocus: true }));
        cell.addEventListener('keydown', (e) => this._handleKeydown(e, r, c));

        rowEl.appendChild(cell);
        this.cellEls[r][c] = cell;
      }
      this.boardEl.appendChild(rowEl);
    }
  }

  _handleKeydown(e, row, col) {
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      this.handlers.onDigitKey(row, col, Number(e.key));
    } else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      this.handlers.onDigitKey(row, col, 0);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      let r = row, c = col;
      if (e.key === 'ArrowUp') r = Math.max(0, row - 1);
      if (e.key === 'ArrowDown') r = Math.min(SIZE - 1, row + 1);
      if (e.key === 'ArrowLeft') c = Math.max(0, col - 1);
      if (e.key === 'ArrowRight') c = Math.min(SIZE - 1, col + 1);
      this.handlers.onSelect(r, c);
    }
  }

  getCellEl(row, col) {
    return this.cellEls[row][col];
  }

  focusCell(row, col) {
    const cellEl = this.getCellEl(row, col);
    if (cellEl) cellEl.focus();
  }

  setPausedVisual(paused) {
    this.boardEl.classList.toggle('paused', paused);
  }

  _cellLabel(r, c, val) {
    const pos = `Row ${r + 1}, Column ${c + 1}`;
    return val ? `${pos}, value ${val}` : `${pos}, empty`;
  }

  /** Full render pass: diffed per-cell content, then highlight pass. */
  render() {
    const { state } = this;
    if (!state.puzzle.length) return; // nothing generated yet
    const stats = state.computeBoardStats();

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        this._renderCell(r, c, stats);
      }
    }

    this._updateHighlights();
  }

  _renderCell(r, c, stats) {
    const { state } = this;
    const cellEl = this.cellEls[r][c];
    const val = state.valueAt(r, c);
    const boxIndex = Math.floor(r / BOX) * BOX + Math.floor(c / BOX);
    const isGiven = state.isGiven(r, c);
    const isCompletedLine = stats.rowComplete[r] || stats.colComplete[c] || stats.boxComplete[boxIndex];
    const isError = state.isErrorCell(r, c);
    const cellNotes = state.notes[r][c];
    const noteKey = val === 0 && cellNotes && cellNotes.size > 0
      ? Array.from(cellNotes).sort().join(',')
      : '';

    const prev = this.prevCellState[r][c];
    const next = { val, isGiven, isCompletedLine, isError, noteKey };

    // Skip DOM writes entirely when nothing about this cell's visual state
    // has changed since the last render (diff-based rendering).
    if (prev && prev.val === next.val && prev.isGiven === next.isGiven &&
        prev.isCompletedLine === next.isCompletedLine && prev.isError === next.isError &&
        prev.noteKey === next.noteKey) {
      return;
    }
    this.prevCellState[r][c] = next;

    cellEl.classList.toggle('given', isGiven);
    cellEl.classList.toggle('user-filled', !isGiven && val !== 0);
    cellEl.classList.toggle('completed-line', isCompletedLine);
    cellEl.classList.toggle('error', isError);
    cellEl.setAttribute('aria-label', this._cellLabel(r, c, val));

    if (val !== 0) {
      cellEl.textContent = val;
      this.cellNoteSpans[r][c] = null;
    } else if (noteKey) {
      cellEl.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'notes-grid';
      const spans = new Array(9);
      for (let n = 1; n <= 9; n++) {
        const span = document.createElement('span');
        span.textContent = cellNotes.has(n) ? n : '';
        grid.appendChild(span);
        spans[n - 1] = span;
      }
      cellEl.appendChild(grid);
      this.cellNoteSpans[r][c] = spans;
    } else {
      cellEl.textContent = '';
      this.cellNoteSpans[r][c] = null;
    }
  }

  _updateHighlights() {
    const { state } = this;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cellEl = this.cellEls[r][c];
        cellEl.classList.remove('selected', 'peer', 'same-value');
        const spans = this.cellNoteSpans[r][c];
        if (spans) {
          for (let i = 0; i < spans.length; i++) spans[i].classList.remove('note-highlight');
        }
      }
    }

    if (!state.selectedCell) return;
    const { row, col } = state.selectedCell;
    const selectedVal = state.valueAt(row, col);
    const selectedIsCorrect = selectedVal !== 0 && selectedVal === state.solution[row][col];
    const selectedBox = Math.floor(row / BOX) * BOX + Math.floor(col / BOX);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cellEl = this.cellEls[r][c];
        const val = state.valueAt(r, c);
        const sameRow = r === row;
        const sameCol = c === col;
        const sameBox = Math.floor(r / BOX) * BOX + Math.floor(c / BOX) === selectedBox;

        if (r === row && c === col) {
          cellEl.classList.add('selected');
        } else if (sameRow || sameCol || sameBox) {
          cellEl.classList.add('peer');
        }

        if (selectedVal !== 0 && val === selectedVal) {
          cellEl.classList.add('same-value');
        }

        // When the selected cell holds a correct value (a given clue or a
        // correctly-filled entry), highlight that number's pencil mark in
        // every other cell on the board that still has it noted as a
        // candidate — not just row/column/box peers.
        if (selectedIsCorrect && !(r === row && c === col) && val === 0) {
          const spans = this.cellNoteSpans[r][c];
          const cellNotes = state.notes[r][c];
          if (spans && cellNotes && cellNotes.has(selectedVal)) {
            spans[selectedVal - 1].classList.add('note-highlight');
          }
        }
      }
    }
  }

  _playShakeAnim(row, col) {
    const cellEl = this.getCellEl(row, col);
    if (cellEl) this._triggerAnim(cellEl, 'shake-anim');
  }

  playPlacedAnim(row, col) {
    const cellEl = this.getCellEl(row, col);
    if (cellEl) this._triggerAnim(cellEl, 'placed-anim');
  }

  _triggerAnim(cellEl, className) {
    cellEl.classList.remove('placed-anim', 'shake-anim');
    void cellEl.offsetWidth; // force reflow so the animation restarts if re-triggered quickly
    cellEl.classList.add(className);
    cellEl.addEventListener('animationend', () => cellEl.classList.remove(className), { once: true });
  }
}
