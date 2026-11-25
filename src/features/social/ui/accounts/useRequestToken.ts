import { useState } from "react";

/**
 * A token object that is replaced whenever one of `deps` changes, so a load can tell its own
 * request from a stale one and mark a scope change as pending. The change is detected while
 * rendering, so there is no frame that shows the new scope with the old token.
 */
export function useRequestToken(deps: readonly unknown[]): object {
  const [state, setState] = useState(() => ({ deps, token: {} }));
  const changed =
    state.deps.length !== deps.length || state.deps.some((dep, i) => !Object.is(dep, deps[i]));
  if (!changed) return state.token;
  const next = { deps, token: {} };
  setState(next);
  return next.token;
}
