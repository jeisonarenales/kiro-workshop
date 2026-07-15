# Sudoku

A Sudoku web application built with plain HTML, CSS, and JavaScript (ES modules) — no build tools, frameworks, or external runtime dependencies required.

## Getting Started

The app is split into ES modules (`js/*.js`), which browsers block from loading over the `file://` protocol for security reasons (CORS). Because of this, you need to serve the folder over HTTP rather than double-clicking `sudoku.html`.

Any static file server works. For example, from the project folder:

```bash
# Python 3
python3 -m http.server 8000

# Node.js (no install needed)
npx serve .
```

Then open:

```
http://localhost:8000/sudoku.html
```

## Features

- **Puzzle generator** — creates a fresh, uniquely-solvable puzzle using a bitmask-based backtracking solver with minimum-remaining-values (MRV) ordering for consistently fast generation, even on Hard
- **Difficulty levels** — Easy, Medium, and Hard (controls how many clues are removed)
- **Input methods**:
  - Click a cell, then click a number on the on-screen number pad
  - Or use your keyboard: `1`-`9` to fill, `0`/`Backspace`/`Delete` to erase, arrow keys to move between cells
- **Pencil-mark notes** — toggle Notes mode to jot candidate numbers into a cell; placing a correct value automatically clears that number from matching notes in the same row/column/box, and selecting any correctly-filled cell highlights matching notes anywhere on the board
- **Highlighting** — selected cell's row, column, and 3x3 box are highlighted, along with matching numbers and completed rows/columns/boxes
- **Check** — validates the current board and flags incorrect entries without revealing the solution
- **Hint** — fills in one random empty or incorrect cell with the correct value
- **Undo** — reverts the last move, including any pencil-marks it cleared
- **Erase** — clears the selected cell
- **Pause** — pauses the timer manually, or automatically when the browser tab loses focus
- **Solve** — reveals the full solution
- **Reset** — clears all your entries and restarts the timer for the current puzzle
- **New Game** — generates a new puzzle at the selected difficulty
- **Game info panel** — live difficulty, timer, mistake count, and completion percentage
- **Autosave** — progress is saved to `localStorage` and restored automatically on reload
- **Animations** — cell placement and mistake feedback
- **Accessible** — full keyboard navigation, ARIA labels/roles, and visible focus states

## How to Play

1. Select a difficulty from the dropdown and click **New Game** (a puzzle is generated automatically on first load as well).
2. Click any empty cell to select it.
3. Enter a number using the number pad or your keyboard.
4. Use **Check** anytime to see if your current entries are correct.
5. The game announces a win automatically once the grid is completely and correctly filled.

## Project Structure

```
sudoku.html              # Markup + CSS, loads js/main.js as an ES module
js/
  sudoku-engine.js        # Pure game logic: grid utilities, bitmask/MRV solver, puzzle generator (no DOM)
  game-state.js           # GameState class — single source of truth for the game; emits events (Observer pattern) instead of calling render directly
  persistence.js          # Repository-style wrapper around localStorage (save/load/clear)
  errors.js               # Custom error types (PuzzleGenerationError, PersistenceError, InvalidMoveError) + a shared error reporter
  board-view.js           # BoardView — builds/caches the board DOM, diff-based rendering, highlighting, animations
  info-panel-view.js      # InfoPanelView — renders difficulty/timer/mistakes/completion
  controls.js             # Wires toolbar, number pad, win modal, and keyboard shortcuts to GameState
  main.js                 # Composition root: constructs everything above and wires it together
README.md                 # This file
```

### Architecture notes

- **Separation of concerns**: `sudoku-engine.js` has zero DOM dependencies and could be reused or unit-tested headlessly. `game-state.js` owns all mutable game state and never touches the DOM. The `*-view.js` modules render based on state and never mutate it directly — they call `GameState` methods in response to user input, which is routed through `controls.js`.
- **Observer pattern**: `GameState` extends a minimal pub/sub `Emitter`. Views subscribe to `'change'`, `'mistake'`, `'placed'`, `'win'`, and `'error'` events rather than being told to re-render from scattered call sites throughout the code.
- **Error handling**: `errors.js` defines typed errors for puzzle generation failures, storage failures, and invalid moves (e.g. undoing with nothing to undo). `GameState` and `persistence.js` catch failures at their boundaries and report them through a consistent path instead of failing silently or throwing uncaught exceptions into the UI.

## Notes

- Given (pre-filled) clues cannot be overwritten.
- All logic runs client-side in the browser; no backend or internet connection is needed once the page and its modules have loaded.
