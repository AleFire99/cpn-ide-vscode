declare module 'javascript-lp-solver' {
  export interface LPModel {
    optimize?: string;
    opType?: 'max' | 'min';
    constraints: Record<string, { min?: number; max?: number; equal?: number }>;
    variables: Record<string, Record<string, number>>;
    ints?: Record<string, 1>;
    binaries?: Record<string, 1>;
    timeout?: number;
  }
  export interface LPResult {
    feasible: boolean;
    bounded?: boolean;
    result: number;
    [variable: string]: number | boolean | undefined;
  }
  const solver: { Solve(model: LPModel): LPResult };
  export default solver;
}
