import type { Board, Player } from "./game";

const STORAGE_KEY = "connect4-game";
export type GameMode = "human" | "ai-first" | "ai-second";
export type AnalysisPoint = {
  ply: number;
  depth: number | null;
  evaluation: number | null;
  predictedEmptyCells: number | null;
  predictedSign: number;
  complete: boolean;
};
export type GameSnapshot = {
  history: Board[];
  currentPlayer: Player;
  moves: number[];
  mode: GameMode;
  analysis: AnalysisPoint[];
};
export type SavedGame = GameSnapshot & { undoStack: GameSnapshot[] };

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedGame;
    if (!Array.isArray(value.history) || value.history.length === 0)
      return null;
    if (value.currentPlayer !== "red" && value.currentPlayer !== "yellow")
      return null;
    const moves = Array.isArray(value.moves)
      ? value.moves.filter(
          (move) => Number.isInteger(move) && move >= 0 && move < 7,
        )
      : inferMoves(value.history);
    const mode =
      value.mode === "ai-first" || value.mode === "ai-second"
        ? value.mode
        : "human";
    const undoStack = Array.isArray(value.undoStack)
      ? value.undoStack.filter(isGameSnapshot).map((snapshot) => ({
          ...snapshot,
          analysis: Array.isArray(snapshot.analysis)
            ? snapshot.analysis
                .filter(isAnalysisPoint)
                .map(normalizeAnalysisPoint)
            : [],
        }))
      : [];
    const analysis = Array.isArray(value.analysis)
      ? value.analysis.filter(isAnalysisPoint).map(normalizeAnalysisPoint)
      : [];
    return {
      history: value.history,
      currentPlayer: value.currentPlayer,
      moves,
      mode,
      analysis,
      undoStack,
    };
  } catch {
    return null;
  }
}

export const saveGame = (game: SavedGame) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));

function inferMoves(history: Board[]): number[] {
  const moves: number[] = [];
  for (let index = 1; index < history.length; index++) {
    const previous = history[index - 1];
    const current = history[index];
    let changedColumn = -1;
    for (let row = 0; row < current.length; row++) {
      for (let column = 0; column < current[row].length; column++) {
        if (current[row][column] !== previous[row][column]) {
          changedColumn = column;
          break;
        }
      }
      if (changedColumn >= 0) break;
    }
    if (changedColumn >= 0) moves.push(changedColumn);
  }
  return moves;
}

function isGameSnapshot(value: unknown): value is GameSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<GameSnapshot>;
  return (
    Array.isArray(snapshot.history) &&
    snapshot.history.length > 0 &&
    (snapshot.currentPlayer === "red" || snapshot.currentPlayer === "yellow") &&
    Array.isArray(snapshot.moves) &&
    (snapshot.analysis === undefined || Array.isArray(snapshot.analysis)) &&
    (snapshot.mode === "human" ||
      snapshot.mode === "ai-first" ||
      snapshot.mode === "ai-second")
  );
}

function isAnalysisPoint(value: unknown): value is AnalysisPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<AnalysisPoint>;
  return (
    typeof point.ply === "number" &&
    Number.isInteger(point.ply) &&
    point.ply > 0 &&
    (point.depth === null || Number.isInteger(point.depth)) &&
    (point.evaluation === null ||
      (typeof point.evaluation === "number" &&
        Number.isFinite(point.evaluation))) &&
    (point.predictedEmptyCells === null ||
      point.predictedEmptyCells === undefined ||
      (typeof point.predictedEmptyCells === "number" &&
        Number.isFinite(point.predictedEmptyCells))) &&
    (point.predictedSign === undefined ||
      (typeof point.predictedSign === "number" &&
        Number.isFinite(point.predictedSign))) &&
    (point.complete === undefined || typeof point.complete === "boolean")
  );
}

function normalizeAnalysisPoint(point: AnalysisPoint): AnalysisPoint {
  const complete = point.complete ?? false;
  return {
    ...point,
    complete,
    evaluation: complete ? point.evaluation : null,
    predictedEmptyCells:
      complete && typeof point.predictedEmptyCells === "number"
        ? point.predictedEmptyCells
        : null,
    predictedSign:
      complete && typeof point.predictedSign === "number"
        ? point.predictedSign
        : 0,
  };
}
