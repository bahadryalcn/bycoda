/** Wire-safe checkpoint shapes; no desktop runtime dependencies. */
export type CheckpointFile = {
  path: string;
  relative: string;
  status: string;
  additions: number;
  deletions: number;
  /** False when interleaved writes prevent an exact session-owned diff. */
  exact: boolean;
  /** False when restoring could overwrite another writer's change. */
  undoable: boolean;
};
export type CheckpointStatus = { files: CheckpointFile[]; expectedCheckpoint?: string };
export type CheckpointFileDiff = {
  path: string;
  relative: string;
  status: string;
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
  expectedCheckpoint?: string;
};
export type CheckpointApplyResult = { files: string[]; alreadyApplied: number };
