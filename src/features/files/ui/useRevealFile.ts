import { useRef, useState } from "react";
import { revealPath } from "../../../platform/tauri/fs";

/**
 * Reveal-in-file-manager action for a file view. A failed reveal stays in the view as `failure`
 * (raw text, shown behind Details by the caller), never only in the console.
 */
export function useRevealFile(path: string) {
  const [revealing, setRevealing] = useState(false);
  const [failure, setFailure] = useState<string>();
  const running = useRef(false);
  const reveal = async () => {
    if (running.current) return;
    running.current = true;
    setRevealing(true);
    setFailure(undefined);
    try {
      await revealPath(path);
    } catch (error) {
      setFailure(String(error));
    } finally {
      running.current = false;
      setRevealing(false);
    }
  };
  return { reveal, revealing, failure };
}
