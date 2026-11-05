import type { ServerBindings } from "./bindings";

type Readers = { [K in keyof ServerBindings]: () => ServerBindings[K] };
type Writers = {
  [K in "closing" | "observationCoverage" | "heartbeatEffects"]: (value: ServerBindings[K]) => void;
};

// Install accessors without reading them: several original closures refer to
// services created later, and shutdown must update their original live bindings.
export function createServerBindings(readers: Readers, writers: Writers): ServerBindings {
  const descriptors = Object.fromEntries(
    Object.entries(readers).map(([key, get]) => [
      key,
      { enumerable: true, get, set: writers[key as keyof Writers] },
    ]),
  );
  return Object.defineProperties({}, descriptors) as ServerBindings;
}
