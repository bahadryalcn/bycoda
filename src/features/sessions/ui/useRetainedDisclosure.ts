import { TranscriptVirtualizationContext } from "./transcriptVirtualization";
import { useContext, useLayoutEffect, useState } from "react";
import { TranscriptRetentionContext } from "./TranscriptPool";

/** Disclosure values survive releasing the transcript DOM, without retaining it. */
export function useRetainedDisclosure<T extends boolean | null>(key: string, initial: T) {
  const retained = useContext(TranscriptRetentionContext);
  const virtual = useContext(TranscriptVirtualizationContext);
  const [value, setValue] = useState<T>(
    () =>
      (retained?.read().disclosures?.[key] as T | undefined) ??
      (virtual?.disclosures.get(key) as T | undefined) ??
      initial,
  );
  useLayoutEffect(() => {
    retained?.setDisclosure(key, value);
    virtual?.disclosures.set(key, value);
  }, [retained, virtual, key, value]);
  return [value, setValue] as const;
}
