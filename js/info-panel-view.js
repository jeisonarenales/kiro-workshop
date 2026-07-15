// info-panel-view.js
//
// InfoPanelView renders the difficulty/timer/mistakes/completion cards. It
// subscribes to GameState's 'change' and 'tick' events and is entirely
// read-only with respect to state — it never mutates GameState.

import { SIZE } from './sudoku-engine.js';

export class InfoPanelView {
  /**
   * @param {{ difficultyEl: HTMLElement, timerEl: HTMLElement, mistakesEl: HTMLElement, completionPctEl: HTMLElement, completionFillEl: HTMLElement }} elements
   * @param {import('./game-state.js').GameState} state
   */
  constructor(elements, state) {
    this.elements = elements;
    this.state = state;

    state.on('change', () => this.render());
    state.on('tick', ({ secondsElapsed }) => this._renderTimer(secondsElapsed));

    this.render();
  }

  render() {
    const { state } = this;
    this._renderTimer(state.secondsElapsed);
    this.elements.mistakesEl.textContent = String(state.mistakes);
    this.elements.difficultyEl.textContent = this._capitalize(state.difficulty);

    if (state.puzzle.length) {
      const { filledCorrect } = state.computeBoardStats();
      this._renderCompletion(filledCorrect);
    }
  }

  _renderTimer(secondsElapsed) {
    this.elements.timerEl.textContent = formatTime(secondsElapsed);
  }

  _renderCompletion(filledCorrect) {
    const pct = Math.round((filledCorrect / (SIZE * SIZE)) * 100);
    this.elements.completionPctEl.textContent = `${pct}%`;
    this.elements.completionFillEl.style.width = `${pct}%`;
  }

  _capitalize(level) {
    return level ? level.charAt(0).toUpperCase() + level.slice(1) : '';
  }
}

export function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
