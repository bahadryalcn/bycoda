import { useCallback, useRef, useState } from "react";

/**
 * Tracks which diff sections are expanded and near the viewport, for a view that
 * loads bodies lazily (`UnifiedDiffView`'s `onSectionNeeded`). The set outlives
 * any loader, so a loader that is replaced still knows what is on screen; bind
 * the running loader's `pump` to `pumpRef` and it starts when a section appears.
 */
export function useNeededSections() {
  const [needed] = useState(() => new Set<string>());
  const pumpRef = useRef<(() => void) | null>(null);
  const onSectionNeeded = useCallback(
    (id: string, isNeeded: boolean) => {
      if (isNeeded) {
        needed.add(id);
        pumpRef.current?.();
      } else needed.delete(id);
    },
    [needed],
  );
  return { needed, pumpRef, onSectionNeeded };
}
