type SolverModule = {
  default: (input?: string | URL) => Promise<unknown>;
  Solver: new () => SolverInstance;
};

type SolverInstance = {
  best_move: (history: Uint8Array, timeMs: number, maxDepth: number) => number;
  best_move_with_stats: (
    history: Uint8Array,
    timeMs: number,
    maxDepth: number,
  ) => Int32Array;
};

type ThinkRequest = {
  type: "think";
  id: number;
  history: number[];
  solverUrl: string;
  timeMs: number;
  maxDepth: number;
};

type PonderRequest = {
  type: "ponder";
  id: number;
  baseHistory: number[];
  legalColumns: number[];
  solverUrl: string;
  timeMs: number;
  maxDepth: number;
};

type CancelRequest = { type: "cancel" };

type WorkerMessage =
  | { type: "ready" }
  | {
      type: "result";
      id: number;
      column: number;
      depth: number;
      evaluation: number;
      complete: boolean;
      predictedEmptyCells: number;
      predictedSign: number;
    }
  | {
      type: "ponder-progress";
      id: number;
      depth: number;
      evaluation: number;
      complete: boolean;
      predictedEmptyCells: number;
      predictedSign: number;
    }
  | { type: "error"; id: number; message: string };

let solver: Promise<SolverModule> | null = null;
let solverInstance: SolverInstance | null = null;
let activeSearch = 0;

type CandidateStats = {
  depth: number;
  evaluation: number;
  complete: boolean;
  predictedEmptyCells: number;
  predictedSign: number;
};

function candidateOrderValue(stats: CandidateStats): number {
  return stats.complete
    ? stats.evaluation
    : stats.predictedSign * stats.predictedEmptyCells;
}

function aggregateCandidateStats(
  candidates: Map<number, CandidateStats>,
  allColumns: number[],
): CandidateStats | null {
  const values = [...candidates.values()];
  if (values.length === 0) return null;
  const selected = values.reduce((best, candidate) =>
    candidateOrderValue(candidate) < candidateOrderValue(best)
      ? candidate
      : best,
  );
  return {
    ...selected,
    complete:
      values.length === allColumns.length &&
      values.every((candidate) => candidate.complete),
  };
}

function loadSolver(url: string): Promise<SolverModule> {
  if (!solver) {
    solver = import(/* @vite-ignore */ url).then(async (module) => {
      const wasmUrl = new URL("./solver_bg.wasm", url);
      await module.default(wasmUrl);
      return module as SolverModule;
    });
  }
  return solver;
}

const worker = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<ThinkRequest | PonderRequest | CancelRequest>,
      ) => void)
    | null;
  postMessage: (message: WorkerMessage) => void;
};

worker.onmessage = async ({ data }) => {
  const searchId = ++activeSearch;
  if (data.type === "cancel") return;
  try {
    const module = await loadSolver(data.solverUrl);
    if (searchId !== activeSearch) return;
    solverInstance ??= new module.Solver();
    if (data.type === "think") {
      const [
        column,
        depth,
        evaluation,
        complete,
        predictedEmptyCells,
        predictedSign,
      ] = solverInstance.best_move_with_stats(
        Uint8Array.from(data.history),
        data.timeMs,
        data.maxDepth,
      );
      if (searchId === activeSearch)
        worker.postMessage({
          type: "result",
          id: data.id,
          column,
          depth,
          evaluation,
          complete: complete === 1,
          predictedEmptyCells,
          predictedSign,
        });
      return;
    }

    if (data.legalColumns.length === 0) return;
    const completedColumns = new Set<number>();
    const candidateStats = new Map<number, CandidateStats>();
    while (searchId === activeSearch) {
      for (const column of data.legalColumns) {
        if (searchId !== activeSearch) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (searchId !== activeSearch) return;
        const history = [...data.baseHistory, column];
        const [
          ,
          depth,
          evaluation,
          complete,
          predictedEmptyCells,
          predictedSign,
        ] = solverInstance.best_move_with_stats(
          Uint8Array.from(history),
          data.timeMs,
          data.maxDepth,
        );
        const stats = {
          depth,
          evaluation,
          complete: complete === 1,
          predictedEmptyCells,
          predictedSign,
        };
        candidateStats.set(column, stats);
        const aggregate = aggregateCandidateStats(
          candidateStats,
          data.legalColumns,
        );
        if (searchId === activeSearch && aggregate)
          worker.postMessage({
            type: "ponder-progress",
            id: data.id,
            depth: aggregate.depth,
            evaluation: aggregate.evaluation,
            complete: aggregate.complete,
            predictedEmptyCells: aggregate.predictedEmptyCells,
            predictedSign: aggregate.predictedSign,
          });
        if (complete === 1) completedColumns.add(column);
        if (completedColumns.size === data.legalColumns.length) return;
      }
    }
  } catch (error) {
    if (searchId !== activeSearch) return;
    worker.postMessage({
      type: "error",
      id: data.id,
      message: error instanceof Error ? error.message : "AI solver failed",
    });
  }
};
