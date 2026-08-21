import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Board,
  COLUMNS,
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
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const animationTimer = useRef<number | undefined>(undefined);
  const [animatedMove, setAnimatedMove] = useState<[number, number] | null>(
    null,
  );
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

  const updateHoveredColumn = (event: React.PointerEvent<HTMLDivElement>) => {
    if (finished) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor(
      ((event.clientX - bounds.left) / bounds.width) * COLUMNS,
    );
    setHoveredColumn(Math.max(0, Math.min(COLUMNS - 1, column)));
  };
  const startPointerTracking = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHoveredColumn(event);
  };
  const endPointerTracking = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (hoveredColumn !== null) {
      suppressClick.current = true;
      play(hoveredColumn);
      setHoveredColumn(null);
    }
  };

  const play = (column: number) => {
    if (finished) return;
    const next = dropPiece(board, column, game.currentPlayer);
    if (next) {
      setAnimatedMove(findLastMove(board, next));
      if (animationTimer.current) window.clearTimeout(animationTimer.current);
      animationTimer.current = window.setTimeout(() => {
        setAnimatedMove(null);
        animationTimer.current = undefined;
      }, 450);
      setHoveredColumn(null);
      setGame({
        history: [...game.history, next],
        currentPlayer: otherPlayer(game.currentPlayer),
      });
    }
  };
  const undo = () => {
    if (game.history.length > 1) {
      setAnimatedMove(null);
      setGame({
        history: game.history.slice(0, -1),
        currentPlayer: otherPlayer(game.currentPlayer),
      });
    }
  };
  const handleCellClick = (column: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    play(column);
  };
  const status = winner
    ? `${winner === "red" ? "赤" : "黄"}の勝ち！`
    : draw
      ? "引き分けです"
      : `${game.currentPlayer === "red" ? "赤" : "黄"}の番`;
  const landingRow =
    hoveredColumn === null
      ? null
      : board.findLastIndex((row) => row[hoveredColumn] === null);

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
        <div
          className="board-wrap"
          onPointerCancel={() => setHoveredColumn(null)}
          onPointerDown={startPointerTracking}
          onPointerLeave={() => setHoveredColumn(null)}
          onPointerMove={updateHoveredColumn}
          onPointerUp={endPointerTracking}
        >
          <div className="board">
            {board.map((row, rowIndex) =>
              row.map((cell, columnIndex) => {
                const highlighted = wonCells.some(
                  ([r, c]) => r === rowIndex && c === columnIndex,
                );
                const isGhost =
                  landingRow === rowIndex && hoveredColumn === columnIndex;
                const isLastMove =
                  lastMove?.[0] === rowIndex && lastMove?.[1] === columnIndex;
                const isAnimatedMove =
                  animatedMove?.[0] === rowIndex &&
                  animatedMove?.[1] === columnIndex;
                const isPendingWin =
                  highlighted && animatedMove && !isAnimatedMove;
                return (
                  <button
                    className={`cell ${cell ?? "empty"} ${isGhost ? `ghost ${game.currentPlayer}` : ""} ${highlighted ? "winner" : ""} ${isPendingWin ? "pending-win" : ""} ${isLastMove ? "last-move" : ""} ${isAnimatedMove ? "dropping" : ""}`}
                    key={`${rowIndex}-${columnIndex}`}
                    onClick={() => handleCellClick(columnIndex)}
                    aria-label={`${columnIndex + 1}列、${rowIndex + 1}行${cell ? `、${cell === "red" ? "赤" : "黄"}` : "、空き"}`}
                    disabled={finished || cell !== null}
                    type="button"
                    style={{ "--drop-rows": rowIndex + 1 } as CSSProperties}
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
            onClick={() => {
              setAnimatedMove(null);
              setGame(initialGame);
            }}
            type="button"
          >
            最初から
          </button>
        </div>
        <p className="hint">列を選んで駒を落としてください</p>
      </section>
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
