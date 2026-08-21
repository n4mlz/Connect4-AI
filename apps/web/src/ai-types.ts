export type AiStats = {
  depth: number;
  evaluation: number;
  predictedEmptyCells: number | null;
  predictedSign: number;
  complete: boolean;
};
