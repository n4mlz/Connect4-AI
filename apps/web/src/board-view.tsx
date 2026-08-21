import type { CSSProperties, PointerEventHandler } from "react";
import type { Board, Player } from "./game";

type Cell = [number, number];

type BoardViewProps = {
  board: Board;
  currentPlayer: Player;
  hoveredColumn: number | null;
  landingRow: number | null;
  wonCells: Cell[];
  lastMove: Cell | null;
  animatedMove: Cell | null;
  finished: boolean;
  gameOverVisualReady: boolean;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerLeave: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onCellClick: (column: number) => void;
};

export function BoardView({
  board,
  currentPlayer,
  hoveredColumn,
  landingRow,
  wonCells,
  lastMove,
  animatedMove,
  finished,
  gameOverVisualReady,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  onCellClick,
}: BoardViewProps) {
  return (
    <div
      className={`board-wrap ${gameOverVisualReady ? "game-over" : ""}`}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="board">
        {board.map((row, rowIndex) =>
          row.map((cell, columnIndex) => {
            const highlighted = wonCells.some(
              ([rowNumber, column]) =>
                rowNumber === rowIndex && column === columnIndex,
            );
            const isGhost =
              landingRow === rowIndex && hoveredColumn === columnIndex;
            const isLastMove =
              lastMove?.[0] === rowIndex && lastMove?.[1] === columnIndex;
            const isAnimatedMove =
              animatedMove?.[0] === rowIndex &&
              animatedMove?.[1] === columnIndex;
            const isPendingWin = highlighted && animatedMove && !isAnimatedMove;
            const isFaded =
              gameOverVisualReady && (!wonCells.length || !highlighted);
            return (
              <button
                className={`cell ${cell ?? "empty"} ${isGhost ? `ghost ${currentPlayer}` : ""} ${highlighted ? "winner" : ""} ${isPendingWin ? "pending-win" : ""} ${isLastMove ? "last-move" : ""} ${isAnimatedMove ? "dropping" : ""} ${isFaded ? "faded" : ""}`}
                key={`${rowIndex}-${columnIndex}`}
                onClick={() => onCellClick(columnIndex)}
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
  );
}
