// Publish lexical getters before the factory reaches its first await. Reading a
// getter still observes the original local variable's initialization boundary.
export function createRuntimeSlot<T extends object>() {
  let runtime: T | undefined;
  return {
    publish: (value: T) => {
      if (runtime) throw new Error("Host runtime is already published.");
      runtime = value;
    },
    get current(): T {
      if (!runtime) throw new ReferenceError("Host runtime is not published.");
      return runtime;
    },
  };
}
