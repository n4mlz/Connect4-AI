import type { Board, Player } from "./game";

const STORAGE_KEY = "connect4-game-v1";
export type SavedGame = { history: Board[]; currentPlayer: Player };

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedGame;
    if (!Array.isArray(value.history) || value.history.length === 0)
      return null;
    if (value.currentPlayer !== "red" && value.currentPlayer !== "yellow")
      return null;
    return value;
  } catch {
    return null;
  }
}

export const saveGame = (game: SavedGame) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
