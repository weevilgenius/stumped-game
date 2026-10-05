/* ========================================================= *\
 *  Stumped puzzle engine: rules, solver, generator, and     *
 *  seed codes. Pure TypeScript with no UI imports, so it    *
 *  can run in a Web Worker.                                 *
\* ========================================================= */

export * from './board';
export {
  applyStep, countSolutions, describeStep, findSolutions, nextStep, solve, stepTier,
  type BlockingStep, type ChainStep, type ConfinementStep, type EliminationStep, type ForcedStep,
  type SolveResult, type Step,
} from './solver';
export { generate, randomSettings } from './generator';
export { decodeSeedCode, encodeSeedCode, type SeedCode } from './seedCode';
