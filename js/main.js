// main.js
//
// Composition root: looks up all DOM elements once, constructs GameState +
// BoardView + InfoPanelView, wires controls, and kicks off the initial game
// (restoring a saved game if one exists). This is the only module that
// reaches into the DOM to find elements by id — every other module receives
// references passed in, which keeps them testable/reusable independent of
// this specific page's markup.

import { GameState } from './game-state.js';
import { BoardView } from './board-view.js';
import { InfoPanelView } from './info-panel-view.js';
import { initControls } from './controls.js';

function getElements() {
  const byId = (id) => document.getElementById(id);
  return {
    boardEl: byId('board'),
    numpadEl: byId('numpad'),
    statusEl: byId('status'),
    timerEl: byId('timer'),
    mistakesEl: byId('mistakes'),
    infoDifficultyEl: byId('infoDifficulty'),
    completionPctEl: byId('completionPct'),
    completionFillEl: byId('completionFill'),
    difficultySelect: byId('difficulty'),
    notesBtn: byId('notesBtn'),
    pauseBtn: byId('pauseBtn'),
    undoBtn: byId('undoBtn'),
    newGameBtn: byId('newGameBtn'),
    checkBtn: byId('checkBtn'),
    hintBtn: byId('hintBtn'),
    eraseBtn: byId('eraseBtn'),
    solveBtn: byId('solveBtn'),
    resetBtn: byId('resetBtn'),
    winModal: byId('winModal'),
    winTime: byId('winTime'),
    winMistakes: byId('winMistakes'),
    winDifficulty: byId('winDifficulty'),
    winNewGameBtn: byId('winNewGameBtn'),
    winCloseBtn: byId('winCloseBtn'),
  };
}

function createStatusSetter(statusEl) {
  return (msg, cls) => {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  };
}

function main() {
  const elements = getElements();
  const setStatus = createStatusSetter(elements.statusEl);

  const state = new GameState();

  // BoardView needs `handlers` before it can wire cell click/keydown
  // listeners meaningfully; controls.js assigns the real handlers right
  // after construction, before any user interaction is possible.
  const boardView = new BoardView(elements.boardEl, state, {
    onSelect: () => {},
    onDigitKey: () => {},
  });

  const infoPanel = new InfoPanelView({
    difficultyEl: elements.infoDifficultyEl,
    timerEl: elements.timerEl,
    mistakesEl: elements.mistakesEl,
    completionPctEl: elements.completionPctEl,
    completionFillEl: elements.completionFillEl,
  }, state);

  initControls(elements, state, boardView, setStatus);

  elements.undoBtn.disabled = true;

  const restored = state.restore();
  if (!restored) {
    state.newGame(elements.difficultySelect.value);
  }

  // Exposed for debugging/testing via the browser console; not part of the
  // module's public contract.
  window.__sudoku = { state, boardView, infoPanel };
}

main();
