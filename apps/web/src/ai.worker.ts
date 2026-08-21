type SolverModule = {
  default: (input?: string | URL) => Promise<unknown>;
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

type WorkerMessage =
  | { type: "ready" }
  | { type: "result"; id: number; column: number }
  | { type: "error"; id: number; message: string };

let solver: Promise<SolverModule> | null = null;

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
  onmessage: ((event: MessageEvent<ThinkRequest>) => void) | null;
  postMessage: (message: WorkerMessage) => void;
};

worker.onmessage = async ({ data }) => {
  if (data.type !== "think") return;
  try {
    const module = await loadSolver(data.solverUrl);
    const column = module.best_move(
      Uint8Array.from(data.history),
      data.timeMs,
      data.maxDepth,
    );
    worker.postMessage({ type: "result", id: data.id, column });
  } catch (error) {
    worker.postMessage({
      type: "error",
      id: data.id,
      message: error instanceof Error ? error.message : "AI solver failed",
    });
  }
};
