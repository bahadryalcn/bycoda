import { useEffect, useRef, useState } from "react";
import { openPathWithDefaultApp } from "../../../platform/tauri/fs";
import { errorText } from "../../../shared/lib/errors";

/**
 * "Open in default app" state for one viewer. `owner` identifies the file/source the
 * action started for: a new owner starts clean and a late result from an older owner is
 * dropped. A click while one open is in flight is ignored.
 */
export function useDefaultAppOpen(owner: object, path: string) {
  const [openingOwner, setOpeningOwner] = useState<object | null>(null);
  const [failure, setFailure] = useState<{ owner: object; message: string } | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);

  // Reset the in-flight guard when the owner changes so the new source can open at once.
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    return () => {
      generation.current += 1;
    };
  }, [owner]);

  const open = () => {
    if (busy.current) return;
    busy.current = true;
    const request = generation.current;
    setOpeningOwner(owner);
    setFailure(null);
    void (async () => {
      try {
        await openPathWithDefaultApp(path);
      } catch (cause: unknown) {
        if (request === generation.current)
          setFailure({
            owner,
            message: errorText(cause),
          });
      } finally {
        if (request === generation.current) {
          busy.current = false;
          setOpeningOwner(null);
        }
      }
    })();
  };

  return {
    opening: openingOwner === owner,
    error: failure?.owner === owner ? failure.message : null,
    open,
    dismiss: () => setFailure(null),
  };
}
