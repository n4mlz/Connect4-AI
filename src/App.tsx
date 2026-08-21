import { useEffect, useMemo, useState } from "react";
import {
  type Board,
  createBoard,
  dropPiece,
  isBoardFull,
  otherPlayer,
  type Player,
  winningCells,
} from "./game";
import { loadGame, type SavedGame, saveGame } from "./storage";

const initialGame: SavedGame = {
  history: [createBoard()],
  currentPlayer: "red",
};

export default function App() {
  const [game, setGame] = useState<SavedGame>(() => loadGame() ?? initialGame);
  const board = game.history.at(-1) ?? createBoard();
  const previousBoard = game.history.at(-2);
  const lastMove = previousBoard ? findLastMove(previousBoard, board) : null;
  const wonCells = useMemo(
    () => (lastMove ? winningCells(board, lastMove[0], lastMove[1]) : []),
    [board, lastMove],
  );
  const winner: Player | null = wonCells.length
    ? board[wonCells[0][0]][wonCells[0][1]]
    : null;
  const draw = !winner && isBoardFull(board);
  const finished = Boolean(winner || draw);
  useEffect(() => saveGame(game), [game]);

  const play = (column: number) => {
    if (finished) return;
    const next = dropPiece(board, column, game.currentPlayer);
    if (next)
      setGame({
        history: [...game.history, next],
        currentPlayer: otherPlayer(game.currentPlayer),
      });
  };
  const undo = () => {
    if (game.history.length > 1)
      setGame({
        history: game.history.slice(0, -1),
        currentPlayer: otherPlayer(game.currentPlayer),
      });
  };
  const status = winner
    ? `${winner === "red" ? "赤" : "黄"}の勝ち！`
    : draw
      ? "引き分けです"
      : `${game.currentPlayer === "red" ? "赤" : "黄"}の番`;

  return (
    <main className="page-shell">
      <section className="game-card" aria-label="Connect Four">
        <header className="header">
          <div>
            <p className="eyebrow">CLASSIC TWO PLAYER GAME</p>
            <h1>
              Connect <span>Four</span>
            </h1>
          </div>
          <div
            className={`turn-indicator ${winner ?? game.currentPlayer}`}
            aria-live="polite"
          >
            <span className="mini-disc" /> {status}
          </div>
        </header>
        <div className="board-wrap">
          <div className="board">
            {board.map((row, rowIndex) =>
              row.map((cell, columnIndex) => {
                const highlighted = wonCells.some(
                  ([r, c]) => r === rowIndex && c === columnIndex,
                );
                return (
                  <button
                    className={`cell ${cell ?? "empty"} ${highlighted ? "winner" : ""}`}
                    key={`${rowIndex}-${columnIndex}`}
                    onClick={() => play(columnIndex)}
                    aria-label={`${columnIndex + 1}列、${rowIndex + 1}行${cell ? `、${cell === "red" ? "赤" : "黄"}` : "、空き"}`}
                    disabled={finished || cell !== null}
                    type="button"
                  >
                    <span />
                  </button>
                );
              }),
            )}
          </div>
        </div>
        <div className="controls">
          <button
            className="secondary-button"
            onClick={undo}
            disabled={game.history.length === 1}
            type="button"
          >
            ↶ <span>1手戻る</span>
          </button>
          <button
            className="primary-button"
            onClick={() => setGame(initialGame)}
            type="button"
          >
            最初から
          </button>
        </div>
        <p className="hint">列を選んで駒を落としてください</p>
      </section>
      <footer>
        LOCAL GAME <span>•</span> 進行状況はこの端末に保存されます
      </footer>
    </main>
  );
}

function findLastMove(
  previous: Board,
  current: Board,
): [number, number] | null {
  for (let row = 0; row < current.length; row++)
    for (let column = 0; column < current[row].length; column++)
      if (previous[row][column] !== current[row][column]) return [row, column];
  return null;
}
