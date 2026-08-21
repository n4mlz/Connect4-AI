import { describe, expect, it } from "vitest";
import { createBoard, dropPiece, isBoardFull, winningCells } from "./game";

describe("Connect Four rules", () => {
  it("drops a piece and rejects a full column", () => {
    const firstMove = dropPiece(createBoard(), 2, "red");
    if (!firstMove) throw new Error("Expected a valid move");
    let board = firstMove;
    expect(board[5][2]).toBe("red");
    for (let i = 0; i < 6; i++) {
      const move = dropPiece(board, 0, i % 2 ? "yellow" : "red");
      if (!move) throw new Error("Expected a valid move");
      board = move;
    }
    expect(dropPiece(board, 0, "red")).toBeNull();
  });
  it("finds horizontal, vertical and diagonal wins", () => {
    const horizontal = createBoard();
    horizontal[5].splice(0, 4, "red", "red", "red", "red");
    expect(winningCells(horizontal, 5, 2)).toHaveLength(4);
    const vertical = createBoard();
    for (let row = 2; row < 6; row++) vertical[row][0] = "yellow";
    expect(winningCells(vertical, 4, 0)).toHaveLength(4);
    const diagonal = createBoard();
    [
      [5, 0],
      [4, 1],
      [3, 2],
      [2, 3],
    ].forEach(([row, column]) => {
      diagonal[row][column] = "red";
    });
    expect(winningCells(diagonal, 3, 2)).toHaveLength(4);
  });
  it("detects a full board", () =>
    expect(
      isBoardFull(createBoard().map((row) => row.map(() => "red" as const))),
    ).toBe(true));
});
