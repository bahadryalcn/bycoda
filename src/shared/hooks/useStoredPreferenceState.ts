import { useEffect, useState } from "react";

/** Editable UI state that follows the owning shared preference without writing back. */
export function useStoredPreferenceState<T>(load: () => T, subscribe: (onChange: () => void) => () => void) {
  const [value, setValue] = useState(load);
  useEffect(() => {
    const refresh = () => setValue(load());
    const stop = subscribe(refresh);
    refresh();
    return stop;
  }, [load, subscribe]);
  return [value, setValue] as const;
}
