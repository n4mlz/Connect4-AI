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
import { type GameMode, loadGame, type SavedGame, saveGame } from "./storage";

const makeInitialGame = (mode: GameMode): SavedGame => ({
  history: [createBoard()],
  currentPlayer: "red",
  moves: [],
  mode,
});

const initialGame = makeInitialGame("human");

function aiPlayer(mode: GameMode): Player | null {
  if (mode === "ai-first") return "red";
  if (mode === "ai-second") return "yellow";
  return null;
}

export default function App() {
  const [game, setGame] = useState<SavedGame>(() => loadGame() ?? initialGame);
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const animationTimer = useRef<number | undefined>(undefined);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const requestedPosition = useRef("");
  const ponderingPosition = useRef("");
  const ponderCache = useRef(new Map<string, number>());
  const playRef = useRef<(column: number, fromAi?: boolean) => void>(
    () => undefined,
  );
  const [aiThinking, setAiThinking] = useState(false);
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
  const computer = aiPlayer(game.mode);

  useEffect(() => {
    const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({
      data,
    }: MessageEvent<{
      type: string;
      id?: number;
      baseKey?: string;
      moves?: Record<string, number>;
      column?: number;
      message?: string;
    }>) => {
      if (data.type === "ponder-result") {
        if (data.baseKey !== ponderingPosition.current || !data.moves) return;
        for (const [key, column] of Object.entries(data.moves))
          ponderCache.current.set(key, column);
        return;
      }
      if (data.id !== requestId.current) return;
      setAiThinking(false);
      if (
        data.type === "result" &&
        data.column !== undefined &&
        data.column >= 0
      )
        playRef.current(data.column, true);
      if (data.type === "error") console.error(data.message);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

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

  const play = (column: number, fromAi = false) => {
    if (finished || (!fromAi && computer === game.currentPlayer)) return;
    const next = dropPiece(board, column, game.currentPlayer);
    if (next) {
      requestId.current += 1;
      requestedPosition.current = "";
      ponderingPosition.current = "";
      workerRef.current?.postMessage({ type: "cancel" });
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
        moves: [...game.moves, column],
        mode: game.mode,
      });
    }
  };
  useEffect(() => {
    playRef.current = play;
  });

  useEffect(() => {
    if (game.mode === "human" || finished || !workerRef.current) return;
    const positionKey = `${game.mode}:${game.moves.join(",")}`;
    const solverUrl = new URL(
      `${import.meta.env.BASE_URL}solver/solver.js`,
      window.location.origin,
    ).href;

    if (computer === game.currentPlayer) {
      if (requestedPosition.current === positionKey) return;
      requestedPosition.current = positionKey;
      requestId.current += 1;
      const cachedColumn = ponderCache.current.get(game.moves.join(","));
      if (cachedColumn !== undefined) {
        setAiThinking(false);
        window.setTimeout(() => playRef.current(cachedColumn, true), 0);
        return;
      }
      setAiThinking(true);
      workerRef.current.postMessage({
        type: "think",
        id: requestId.current,
        history: game.moves,
        solverUrl,
        timeMs: 650,
        maxDepth: 42,
      });
      return;
    }

    if (ponderingPosition.current === positionKey) return;
    ponderingPosition.current = positionKey;
    requestId.current += 1;
    setAiThinking(false);
    const legalColumns = Array.from(
      { length: COLUMNS },
      (_, column) => column,
    ).filter((column) => dropPiece(board, column, game.currentPlayer));
    workerRef.current.postMessage({
      type: "ponder",
      id: requestId.current,
      baseKey: positionKey,
      baseHistory: game.moves,
      legalColumns,
      solverUrl,
      timeMs: 100,
      maxDepth: 42,
    });
  }, [board, computer, finished, game.currentPlayer, game.mode, game.moves]);

  const undo = () => {
    if (game.history.length > 1) {
      requestId.current += 1;
      requestedPosition.current = "";
      ponderingPosition.current = "";
      ponderCache.current.clear();
      workerRef.current?.postMessage({ type: "cancel" });
      setAiThinking(false);
      const count = game.mode === "human" || game.moves.length < 2 ? 1 : 2;
      const moves = game.moves.slice(0, -count);
      setAnimatedMove(null);
      setGame({
        history: game.history.slice(0, -count),
        currentPlayer: moves.length % 2 === 0 ? "red" : "yellow",
        moves,
        mode: game.mode,
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
  const startGame = (mode: GameMode) => {
    requestId.current += 1;
    requestedPosition.current = "";
    ponderingPosition.current = "";
    ponderCache.current.clear();
    workerRef.current?.postMessage({ type: "cancel" });
    setAiThinking(false);
    setAnimatedMove(null);
    setHoveredColumn(null);
    setGame(makeInitialGame(mode));
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
  const gameOverVisualReady = finished && !animatedMove;

  return (
    <main className="page-shell">
      <section className="game-card" aria-label="Connect Four">
        <fieldset className="mode-selector">
          <legend className="visually-hidden">対戦モード</legend>
          <button
            className={game.mode === "human" ? "selected" : ""}
            onClick={() => startGame("human")}
            type="button"
          >
            対人戦
          </button>
          <button
            className={game.mode === "ai-first" ? "selected" : ""}
            onClick={() => startGame("ai-first")}
            type="button"
          >
            AIが先手
          </button>
          <button
            className={game.mode === "ai-second" ? "selected" : ""}
            onClick={() => startGame("ai-second")}
            type="button"
          >
            AIが後手
          </button>
        </fieldset>
        <header className="header">
          <div>
            <p className="eyebrow">CLASSIC TWO PLAYER GAME</p>
            <h1>
              Connect <span>Four</span>
            </h1>
          </div>
          <div
            className={`turn-indicator ${winner ?? (draw ? "draw" : game.currentPlayer)}`}
            aria-live="polite"
          >
            <span className="mini-disc" /> {aiThinking ? "AIが考え中…" : status}
          </div>
        </header>
        <div
          className={`board-wrap ${gameOverVisualReady ? "game-over" : ""}`}
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
                const isFaded =
                  gameOverVisualReady && (!winner || !highlighted);
                return (
                  <button
                    className={`cell ${cell ?? "empty"} ${isGhost ? `ghost ${game.currentPlayer}` : ""} ${highlighted ? "winner" : ""} ${isPendingWin ? "pending-win" : ""} ${isLastMove ? "last-move" : ""} ${isAnimatedMove ? "dropping" : ""} ${isFaded ? "faded" : ""}`}
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
            onClick={() => startGame(game.mode)}
            type="button"
          >
            {finished ? "もう一度" : "最初から"}
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
