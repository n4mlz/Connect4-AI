export const ROWS = 6;
export const COLUMNS = 7;
export type Player = "red" | "yellow";
export type Cell = Player | null;
export type Board = Cell[][];

export const createBoard = (): Board =>
  Array.from({ length: ROWS }, () => Array<Cell>(COLUMNS).fill(null));

export function dropPiece(
  board: Board,
  column: number,
  player: Player,
): Board | null {
  if (column < 0 || column >= COLUMNS) return null;
  const row = board.findLastIndex((cells) => cells[column] === null);
  if (row < 0) return null;
  const next = board.map((cells) => [...cells]);
  next[row][column] = player;
  return next;
}

export function winningCells(
  board: Board,
  row: number,
  column: number,
): [number, number][] {
  const player = board[row]?.[column];
  if (!player) return [];
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of directions) {
    const line: [number, number][] = [[row, column]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = column + dc * sign;
      while (board[r]?.[c] === player) {
        line.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return [];
}

export const isBoardFull = (board: Board) =>
  board[0].every((cell) => cell !== null);
export const otherPlayer = (player: Player): Player =>
  player === "red" ? "yellow" : "red";
