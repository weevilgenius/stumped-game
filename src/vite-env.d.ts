/// <reference types="vite/client" />

/** Build-time options supplied by Vite. */
interface ImportMetaEnv {
  /** Collect detailed solve data only when set to the string 'true'. */
  readonly VITE_COLLECT_SOLVE_DATA?: string;
}
