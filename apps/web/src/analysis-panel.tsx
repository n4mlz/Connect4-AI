import type { AiStats } from "./ai-types";
import type { Player } from "./game";
import type { AnalysisPoint } from "./storage";

type AnalysisPanelProps = {
  computer: Player | null;
  liveAnalysis: AiStats | null;
  moves: number[];
  points: AnalysisPoint[];
};

export function AnalysisPanel({
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
      {chartPoints.length > 0 && (
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
          {labels.map((ply) => (
            <text
              className="chart-label"
              key={ply}
              x={x(ply)}
              y={height - 12}
              textAnchor="middle"
            >
              {ply}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
