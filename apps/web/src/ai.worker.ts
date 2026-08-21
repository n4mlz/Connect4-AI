type SolverModule = {
  default: (input?: string | URL) => Promise<unknown>;
  Solver: new () => SolverInstance;
};

type SolverInstance = {
  best_move: (history: Uint8Array, timeMs: number, maxDepth: number) => number;
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
  | { type: "result"; id: number; column: number }
  | { type: "error"; id: number; message: string };

let solver: Promise<SolverModule> | null = null;
let solverInstance: SolverInstance | null = null;
let activeSearch = 0;

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
      const column = solverInstance.best_move(
        Uint8Array.from(data.history),
        data.timeMs,
        data.maxDepth,
      );
      if (searchId === activeSearch)
        worker.postMessage({ type: "result", id: data.id, column });
      return;
    }

    if (data.legalColumns.length === 0) return;
    while (searchId === activeSearch) {
      for (const column of data.legalColumns) {
        if (searchId !== activeSearch) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (searchId !== activeSearch) return;
        const history = [...data.baseHistory, column];
        solverInstance.best_move(
          Uint8Array.from(history),
          data.timeMs,
          data.maxDepth,
        );
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
