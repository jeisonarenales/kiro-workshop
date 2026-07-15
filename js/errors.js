// errors.js
//
// Custom error types for the Sudoku app, plus a small reporter that turns
// caught errors into consistent, user-facing status messages instead of
// failing silently or leaking raw exceptions to the console only.

/** Thrown when the puzzle generator cannot produce a valid puzzle. */
export class PuzzleGenerationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PuzzleGenerationError';
  }
}

/** Thrown when reading/writing/parsing saved game state fails. */
export class PersistenceError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PersistenceError';
  }
}

/** Thrown when a game action is attempted in an invalid state (e.g. placing
 * a number with nothing selected, or mutating a given/won board). */
export class InvalidMoveError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'InvalidMoveError';
  }
}

/**
 * Reports an error to the user via a status-message callback and to the
 * console for diagnostics, without letting the error propagate and break
 * the calling code. Centralizing this avoids scattering try/catch +
 * "fail silently" duplication across every module.
 *
 * @param {unknown} error
 * @param {(message: string) => void} [notify] callback used to surface a
 *   user-facing message (e.g. GameState's status text). Optional so this
 *   can also be used from contexts with no UI available.
 */
export function reportError(error, notify) {
  const message = toUserMessage(error);
  // eslint-disable-next-line no-console
  console.error('[Sudoku]', error);
  if (typeof notify === 'function') {
    notify(message);
  }
}

function toUserMessage(error) {
  if (error instanceof PuzzleGenerationError) {
    return 'Could not generate a puzzle. Please try again.';
  }
  if (error instanceof PersistenceError) {
    return 'Your progress could not be saved or loaded on this device.';
  }
  if (error instanceof InvalidMoveError) {
    return error.message || 'That move is not allowed right now.';
  }
  return 'Something went wrong. Please try again.';
}
