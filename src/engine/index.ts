/* ========================================================= *\
 *  Stumped puzzle engine: rules, solver, generator, and     *
 *  seed codes. Pure TypeScript with no UI imports, so it    *
 *  can run in a Web Worker.                                 *
\* ========================================================= */

export * from './board';
export {
  applyStep, countSolutions, describeStep, findSolutions, nextStep, solve, STUMP_NAMES, stepTier,
  type BlockingStep, type ChainStep, type ConfinementStep, type EliminationStep, type ForcedStep,
  type PieceNames, type SolveResult, type Step,
} from './solver';
export { generate, randomSettings } from './generator';
export { decodeSeedCode, encodeSeedCode, type SeedCode } from './seedCode';
