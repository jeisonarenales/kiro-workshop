// controls.js
//
// Wires all user-facing controls (toolbar buttons, number pad, win modal,
// global keyboard shortcuts) to GameState methods and BoardView. Each
// handler is kept small and delegates immediately to state/view methods —
// no rendering or game-logic decisions are made here, only translation from
// "the user did X" to "call this one method".

import { InvalidMoveError, reportError } from './errors.js';

/**
 * @param {Object} elements DOM references (see main.js for the full list)
 * @param {import('./game-state.js').GameState} state
 * @param {import('./board-view.js').BoardView} boardView
 * @param {(msg: string, cls?: string) => void} setStatus
 */
export function initControls(elements, state, boardView, setStatus) {
  _wireDifficultySelect(elements, state);
  _wireToolbar(elements, state, setStatus);
  _wireNumpad(elements, state);
  _wireWinModal(elements, state);
  _wireGlobalKeyboard(elements, state);
  _wireBoardSelection(state, boardView);
  _wireStateEvents(elements, state, setStatus);
}

function _wireBoardSelection(state, boardView) {
  boardView.handlers = {
    onSelect: (row, col, opts) => {
      state.selectCell(row, col);
      if (!opts || !opts.skipFocus) boardView.focusCell(row, col);
    },
    onDigitKey: (row, col, digit) => {
      state.selectCell(row, col);
      state.placeNumber(digit);
    },
  };
}

function _wireDifficultySelect(elements, state) {
  // Difficulty only takes effect on the next New Game, matching the
  // original behavior — selecting it doesn't alter the current puzzle.
  elements.difficultySelect.value = state.difficulty;
}

function _wireToolbar(elements, state, setStatus) {
  elements.newGameBtn.addEventListener('click', () => {
    setStatus('');
    state.newGame(elements.difficultySelect.value);
  });

  elements.checkBtn.addEventListener('click', () => {
    const result = state.check();
    if (result === 'error') setStatus('Some cells are incorrect.', 'error-msg');
    else if (result === 'incomplete') setStatus('No mistakes so far, but the grid is not complete yet.');
    // 'complete' triggers the win event/modal separately.
  });

  elements.hintBtn.addEventListener('click', () => {
    const cell = state.hint();
    if (cell) {
      boardViewFocus(elements, cell);
      setStatus('Hint placed.');
    }
  });

  elements.eraseBtn.addEventListener('click', () => state.erase());

  elements.undoBtn.addEventListener('click', () => {
    try {
      state.undo();
    } catch (error) {
      if (error instanceof InvalidMoveError) {
        setStatus(error.message);
      } else {
        reportError(error, setStatus);
      }
    }
  });

  elements.notesBtn.addEventListener('click', () => state.toggleNotesMode());

  elements.pauseBtn.addEventListener('click', () => state.setPaused(!state.paused));

  elements.solveBtn.addEventListener('click', () => {
    state.solve();
    setStatus('Solution revealed.');
  });

  elements.resetBtn.addEventListener('click', () => {
    state.reset();
    setStatus('Board reset.');
  });
}

// Small helper kept local to this module since it only needs the board
// element lookup, not a full BoardView reference, when focusing a hinted
// cell from the toolbar.
function boardViewFocus(elements, { row, col }) {
  const cellEl = elements.boardEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (cellEl) cellEl.focus();
}

function _wireNumpad(elements, state) {
  elements.numpadEl.innerHTML = '';
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.textContent = String(n);
    btn.dataset.num = String(n);
    btn.setAttribute('aria-label', `Place number ${n}`);
    btn.addEventListener('click', () => state.placeNumber(n));
    elements.numpadEl.appendChild(btn);
  }
  const eraseBtn = document.createElement('button');
  eraseBtn.textContent = '⌫';
  eraseBtn.setAttribute('aria-label', 'Erase cell');
  eraseBtn.addEventListener('click', () => state.erase());
  elements.numpadEl.appendChild(eraseBtn);
}

function _updateNumpadDisabled(elements, state) {
  if (!state.puzzle.length) return;
  const { digitCounts } = state.computeBoardStats();
  elements.numpadEl.querySelectorAll('button[data-num]').forEach(btn => {
    const n = Number(btn.dataset.num);
    btn.disabled = digitCounts[n] >= 9;
  });
}

function _wireWinModal(elements, state) {
  elements.winNewGameBtn.addEventListener('click', () => {
    _hideWinModal(elements);
    state.newGame(elements.difficultySelect.value);
  });
  elements.winCloseBtn.addEventListener('click', () => _hideWinModal(elements));
  elements.winModal.addEventListener('click', (e) => {
    if (e.target === elements.winModal) _hideWinModal(elements);
  });
}

function _hideWinModal(elements) {
  elements.winModal.classList.add('hidden');
}

function _showWinModal(elements, { secondsElapsed, mistakes, difficulty }) {
  elements.winTime.textContent = formatTimeLocal(secondsElapsed);
  elements.winMistakes.textContent = String(mistakes);
  elements.winDifficulty.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  elements.winModal.classList.remove('hidden');
}

function formatTimeLocal(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function _wireGlobalKeyboard(elements, state) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.winModal.classList.contains('hidden')) {
      _hideWinModal(elements);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !state.gameWon && !state.paused) {
      state.setPaused(true);
    }
  });
}

function _wireStateEvents(elements, state, setStatus) {
  state.on('change', (payload) => {
    const reason = payload && payload.reason;
    elements.notesBtn.textContent = state.notesMode ? 'Notes: On' : 'Notes: Off';
    elements.notesBtn.classList.toggle('toggle-active', state.notesMode);
    elements.notesBtn.setAttribute('aria-pressed', String(state.notesMode));

    elements.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    elements.boardEl.classList.toggle('paused', state.paused);

    elements.undoBtn.disabled = !state.canUndo();

    _updateNumpadDisabled(elements, state);

    if (reason === 'new-game' || reason === 'restore') {
      _hideWinModal(elements);
      if (reason === 'restore') {
        setStatus(state.gameWon ? 'Loaded a completed puzzle.' : 'Restored your saved game.');
      } else {
        setStatus('');
      }
    }
    if (reason === 'pause') {
      setStatus(state.paused ? 'Paused.' : '');
    }
    if (reason === 'erase' || (reason === 'place' && payload && payload.isCorrect)) {
      setStatus('');
    }
    if (reason === 'undo') {
      setStatus('Move undone.');
    }
  });

  state.on('mistake', () => {
    setStatus('That number conflicts with the solution.', 'error-msg');
  });

  state.on('win', (payload) => {
    setStatus(`Solved in ${formatTimeLocal(payload.secondsElapsed)} with ${payload.mistakes} mistake(s)!`, 'win');
    _showWinModal(elements, payload);
  });

  state.on('error', (message) => {
    setStatus(message, 'error-msg');
  });
}
