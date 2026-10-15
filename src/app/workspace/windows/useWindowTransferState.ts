import { useState, type Dispatch, type SetStateAction } from "react";
import type { PendingWindowMoves } from "../../model/windowTransferPopout";

/** Tab ids whose multi-window move is in flight (composer and tab locking). */
export function useMovingWindowsState(): {
  movingWindows: Set<string>;
  setMovingWindows: Dispatch<SetStateAction<Set<string>>>;
} {
  const [movingWindows, setMovingWindows] = useState<Set<string>>(new Set());
  return { movingWindows, setMovingWindows };
}

/** Moves queued until their turn finishes or their session settles. */
export function usePendingWindowMovesState(): {
  pendingWindowMoves: PendingWindowMoves;
  setPendingWindowMoves: Dispatch<SetStateAction<PendingWindowMoves>>;
} {
  const [pendingWindowMoves, setPendingWindowMoves] = useState<PendingWindowMoves>({});
  return { pendingWindowMoves, setPendingWindowMoves };
}
