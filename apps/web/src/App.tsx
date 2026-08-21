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
import {
  type AnalysisPoint,
  type GameMode,
  type GameSnapshot,
  loadGame,
  type SavedGame,
  saveGame,
} from "./storage";

const makeInitialGame = (mode: GameMode): SavedGame => ({
  history: [createBoard()],
  currentPlayer: "red",
  moves: [],
  mode,
  analysis: [],
  undoStack: [],
});

const initialGame = makeInitialGame("human");

type AiStats = {
  depth: number;
  evaluation: number;
  predictedEmptyCells: number;
  predictedSign: number;
  complete: boolean;
};

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
  const playRef = useRef<
    (column: number, fromAi?: boolean, aiStats?: AiStats) => void
  >(() => undefined);
  const [aiThinking, setAiThinking] = useState(false);
  const [liveAnalysis, setLiveAnalysis] = useState<AiStats | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
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
      column?: number;
      depth?: number;
      evaluation?: number;
      complete?: boolean;
      predictedEmptyCells?: number;
      predictedSign?: number;
      message?: string;
    }>) => {
      if (data.id !== requestId.current) return;
      if (data.type === "ponder-progress") {
        setLiveAnalysis((previous) => {
          const next = {
            depth: data.depth ?? 0,
            evaluation: data.evaluation ?? 0,
            predictedEmptyCells: data.predictedEmptyCells ?? 0,
            predictedSign: data.predictedSign ?? 0,
            complete: data.complete ?? false,
          };
          if (!previous || next.depth >= previous.depth || next.complete)
            return next;
          return previous;
        });
        return;
      }
      setAiThinking(false);
      if (
        data.type === "result" &&
        data.column !== undefined &&
        data.column >= 0
      )
        playRef.current(data.column, true, {
          depth: data.depth ?? 0,
          evaluation: data.evaluation ?? 0,
          predictedEmptyCells: data.predictedEmptyCells ?? 0,
          predictedSign: data.predictedSign ?? 0,
          complete: data.complete ?? false,
        });
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

  const play = (column: number, fromAi = false, aiStats?: AiStats) => {
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
      const analysisPoint: AnalysisPoint = {
        ply: game.moves.length + 1,
        depth: fromAi && aiStats ? aiStats.depth : null,
        evaluation:
          fromAi && aiStats?.complete
            ? computer === "red"
              ? aiStats.evaluation
              : -aiStats.evaluation
            : null,
        predictedEmptyCells:
          fromAi && aiStats ? aiStats.predictedEmptyCells : null,
        predictedSign:
          fromAi && aiStats
            ? computer === "red"
              ? aiStats.predictedSign
              : -aiStats.predictedSign
            : 0,
        complete: fromAi && aiStats ? aiStats.complete : false,
      };
      setGame({
        history: [...game.history, next],
        currentPlayer: otherPlayer(game.currentPlayer),
        moves: [...game.moves, column],
        mode: game.mode,
        analysis: [...game.analysis, analysisPoint],
        undoStack:
          game.mode === "human" || !fromAi || game.moves.length === 0
            ? [...game.undoStack, toSnapshot(game)]
            : game.undoStack,
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
      setAiThinking(true);
      setLiveAnalysis(null);
      workerRef.current.postMessage({
        type: "think",
        id: requestId.current,
        history: game.moves,
        solverUrl,
        timeMs: 1_500,
        maxDepth: 42,
      });
      return;
    }

    if (ponderingPosition.current === positionKey) return;
    ponderingPosition.current = positionKey;
    requestId.current += 1;
    setAiThinking(false);
    setLiveAnalysis(null);
    const legalColumns = Array.from(
      { length: COLUMNS },
      (_, column) => column,
    ).filter((column) => dropPiece(board, column, game.currentPlayer));
    workerRef.current.postMessage({
      type: "ponder",
      id: requestId.current,
      baseHistory: game.moves,
      legalColumns,
      solverUrl,
      timeMs: 100,
      maxDepth: 42,
    });
  }, [board, computer, finished, game.currentPlayer, game.mode, game.moves]);

  const undo = () => {
    const previous = game.undoStack.at(-1);
    if (!previous) return;
    requestId.current += 1;
    requestedPosition.current = "";
    ponderingPosition.current = "";
    workerRef.current?.postMessage({ type: "cancel" });
    setAiThinking(false);
    setLiveAnalysis(null);
    setAnimatedMove(null);
    setGame({
      ...previous,
      undoStack: game.undoStack.slice(0, -1),
    });
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
    workerRef.current?.postMessage({ type: "cancel" });
    setAiThinking(false);
    setAnimatedMove(null);
    setHoveredColumn(null);
    setGame({
      ...makeInitialGame(mode),
      undoStack: [...game.undoStack, toSnapshot(game)],
    });
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
            disabled={game.undoStack.length === 0}
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
        {game.mode !== "human" && (
          <section className="analysis-section" aria-label="AI探索情報">
            <button
              className="analysis-toggle"
              onClick={() => setShowAnalysis((visible) => !visible)}
              type="button"
              aria-expanded={showAnalysis}
            >
              <span>AI探索情報</span>
              <span aria-hidden="true">{showAnalysis ? "−" : "+"}</span>
            </button>
            {showAnalysis && (
              <AnalysisPanel
                computer={computer}
                liveAnalysis={liveAnalysis}
                moves={game.moves}
                points={game.analysis}
              />
            )}
          </section>
        )}
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

function toSnapshot(game: SavedGame): GameSnapshot {
  return {
    history: game.history,
    currentPlayer: game.currentPlayer,
    moves: game.moves,
    mode: game.mode,
    analysis: game.analysis,
  };
}

type AnalysisPanelProps = {
  computer: Player | null;
  liveAnalysis: AiStats | null;
  moves: number[];
  points: AnalysisPoint[];
};

function AnalysisPanel({
  computer,
  liveAnalysis,
  moves,
  points,
}: AnalysisPanelProps) {
  const latest = [...points].reverse().find((point) => point.depth !== null);
  const chartPoints = points.filter(
    (point): point is AnalysisPoint & { evaluation: number } =>
      point.evaluation !== null,
  );
  const current = liveAnalysis
    ? {
        complete: liveAnalysis.complete,
        depth: liveAnalysis.depth,
        evaluation:
          liveAnalysis.complete && computer === "red"
            ? liveAnalysis.evaluation
            : liveAnalysis.complete
              ? -liveAnalysis.evaluation
              : null,
        predictedEmptyCells: liveAnalysis.predictedEmptyCells,
        predictedSign:
          computer === "red"
            ? liveAnalysis.predictedSign
            : -liveAnalysis.predictedSign,
      }
    : latest;
  const width = 640;
  const height = 250;
  const margin = { top: 18, right: 14, bottom: 38, left: 46 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxPly = Math.max(moves.length, 1);
  const x = (ply: number) =>
    margin.left + ((ply - 1) / Math.max(maxPly - 1, 1)) * chartWidth;
  const y = (evaluation: number) =>
    margin.top +
    ((42 - Math.max(-42, Math.min(42, evaluation))) / 84) * chartHeight;
  const line = chartPoints
    .map((point) => `${x(point.ply)},${y(point.evaluation)}`)
    .join(" ");
  const labelStep = Math.max(1, Math.ceil(maxPly / 8));
  const labels = Array.from({ length: maxPly }, (_, index) => index + 1).filter(
    (ply) => ply === 1 || ply === maxPly || ply % labelStep === 0,
  );
  const formatEvaluation = (evaluation: number) => String(Math.abs(evaluation));
  const currentEvaluation =
    current?.complete && current.evaluation !== null
      ? current.evaluation
      : null;
  const currentSign =
    currentEvaluation !== null
      ? Math.sign(currentEvaluation)
      : (current?.predictedSign ?? 0);
  const evaluationLabel =
    currentEvaluation === null
      ? current?.predictedSign === 1
        ? "赤が優勢"
        : current?.predictedSign === -1
          ? "黄が優勢"
          : "未確定"
      : currentEvaluation === 0
        ? "互角"
        : currentEvaluation > 0
          ? "赤が優勢"
          : "黄が優勢";

  return (
    <div className="analysis-panel">
      <div className="analysis-summary">
        <div>
          <span>最終探索深度</span>
          <strong>
            {!current
              ? "—"
              : current.complete
                ? "完全読み"
                : `${current.depth}手先`}
          </strong>
        </div>
        <div>
          <span>盤面評価</span>
          <strong
            className={
              currentSign < 0 ? "yellow" : currentSign > 0 ? "red" : ""
            }
          >
            {!current
              ? "—"
              : `${evaluationLabel}${currentEvaluation === null ? (current.predictedEmptyCells === null ? "" : `（予想 ${formatEvaluation(current.predictedEmptyCells)}）`) : `（${formatEvaluation(currentEvaluation)}）`}`}
          </strong>
        </div>
      </div>
      {chartPoints.length === 0 ? (
        <p className="analysis-empty">AIが着手すると探索結果が表示されます。</p>
      ) : (
        <svg
          className="analysis-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="AI視点の盤面評価値の推移"
        >
          {[42, 0, -42].map((value) => (
            <g key={value}>
              <line
                className={value === 0 ? "chart-zero" : "chart-grid"}
                x1={margin.left}
                x2={width - margin.right}
                y1={y(value)}
                y2={y(value)}
              />
              <text x={margin.left - 8} y={y(value) + 4} textAnchor="end">
                <tspan
                  className={
                    value === 42
                      ? "chart-axis-red"
                      : value === -42
                        ? "chart-axis-yellow"
                        : "chart-axis-neutral"
                  }
                >
                  {value === 42 ? "赤" : value === -42 ? "黄" : "互角"}
                </tspan>
              </text>
            </g>
          ))}
          {line && <polyline className="chart-line" points={line} />}
          {chartPoints.map((point) => (
            <circle
              className={`chart-point ${point.evaluation === 0 ? "neutral" : point.evaluation < 0 ? "yellow" : "red"}`}
              cx={x(point.ply)}
              cy={y(point.evaluation)}
              key={point.ply}
              r="3.5"
            />
          ))}
          {labels.map((ply) => {
            return (
              <text
                className="chart-label"
                key={ply}
                x={x(ply)}
                y={height - 12}
                textAnchor="middle"
              >
                {ply}
              </text>
            );
          })}
        </svg>
      )}
      <p className="analysis-note">
        評価値は先手（赤）基準です。赤が上、黄が下になるよう表示しています。
      </p>
    </div>
  );
}
