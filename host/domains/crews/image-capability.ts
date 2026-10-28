type Authorize = () => Promise<void>;
type ProbeResult = { available: boolean };

/** Only completed public capability evidence is shared. No grant is shared. */
export function createCrewImageCapabilityProbe(ports: {
  probe(authorize?: Authorize): Promise<ProbeResult>;
  now?: () => number;
}) {
  let cached: { at: number; value: boolean } | undefined;
  let pending: Promise<void> | undefined;
  const now = ports.now ?? Date.now;
  return async (
    candidate: { harness: string },
    capability: string,
    authorize?: Authorize,
  ): Promise<boolean | undefined> => {
    if (candidate.harness !== "codex" || capability !== "image-generation") return undefined;
    for (;;) {
      await authorize?.();
      if (cached && now() - cached.at <= 60_000) return cached.value;
      if (pending) {
        // Wait for settlement, never another request's grant or rejection.
        // The next iteration checks this caller before using public evidence
        // or starting its own probe after an interrupted predecessor.
        await pending;
        continue;
      }
      let settled!: () => void;
      const gate = new Promise<void>((resolve) => {
        settled = resolve;
      });
      pending = gate;
      try {
        const { available } = await ports.probe(authorize);
        cached = { at: now(), value: available };
        await authorize?.();
        return available;
      } finally {
        if (pending === gate) pending = undefined;
        settled();
      }
    }
  };
}
