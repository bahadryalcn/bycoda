import { useContext, useLayoutEffect, useState } from "react";
import { TranscriptRetentionContext } from "./TranscriptPool";

/** Disclosure values survive releasing the transcript DOM, without retaining it. */
export function useRetainedDisclosure<T extends boolean | null>(key: string, initial: T) {
  const retained = useContext(TranscriptRetentionContext);
  const [value, setValue] = useState<T>(
    () => (retained?.read().disclosures?.[key] as T | undefined) ?? initial,
  );
  useLayoutEffect(() => {
    retained?.setDisclosure(key, value);
  }, [retained, key, value]);
  return [value, setValue] as const;
}
