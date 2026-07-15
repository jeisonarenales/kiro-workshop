// persistence.js
//
// Repository-style wrapper around localStorage: this is the only module
// that touches browser storage directly. GameState depends on this small
// interface (load/save/clear) rather than on localStorage itself, so the
// storage mechanism could be swapped out (e.g. for IndexedDB or a remote
// API) without touching game logic.

import { PersistenceError } from './errors.js';

const STORAGE_KEY = 'sudoku-game-state-v1';

function serializeNotes(notes) {
  return notes.map(row => row.map(set => Array.from(set)));
}

function deserializeNotes(data) {
  return data.map(row => row.map(arr => new Set(arr)));
}

/**
 * Persists a snapshot of the game to localStorage. Throws PersistenceError
 * on failure (e.g. private-browsing mode, storage quota exceeded); callers
 * are expected to catch this and report it via errors.js rather than let it
 * crash the game.
 */
export function saveGame(snapshot) {
  try {
    const payload = {
      puzzle: snapshot.puzzle,
      solution: snapshot.solution,
      givenMask: snapshot.givenMask,
      userValues: snapshot.userValues,
      notes: serializeNotes(snapshot.notes),
      mistakes: snapshot.mistakes,
      secondsElapsed: snapshot.secondsElapsed,
      difficulty: snapshot.difficulty,
      gameWon: snapshot.gameWon,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    throw new PersistenceError('Failed to save game state to localStorage', { cause: error });
  }
}

/**
 * Loads the saved game snapshot, or null if none exists / it is invalid.
 * Deliberately returns null instead of throwing for the "nothing saved yet"
 * and "corrupt JSON" cases, since those are expected, recoverable states
 * (the caller should just start a new game) rather than exceptional ones.
 */
export function loadGame() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new PersistenceError('Failed to read game state from localStorage', { cause: error });
  }
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    if (!data || !data.puzzle || !data.solution) return null;
    return {
      ...data,
      notes: data.notes ? deserializeNotes(data.notes) : null,
    };
  } catch (error) {
    // Corrupt saved data shouldn't block the user from starting a fresh
    // game; treat it as "nothing usable was saved".
    return null;
  }
}

/** Clears any saved game snapshot. Safe to call even if nothing is saved. */
export function clearSavedGame() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    throw new PersistenceError('Failed to clear saved game state', { cause: error });
  }
}
