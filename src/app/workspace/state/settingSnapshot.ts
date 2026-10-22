/** Cache the app's external-store snapshot until a setting event invalidates it.
 * Keep direct setting.load() behavior unchanged for callers outside the shell. */
export function settingSnapshot<T>(read: () => T, listen: (notify: () => void) => () => void) {
  let cached: { value: T } | undefined;
  const getSnapshot = () => (cached ??= { value: read() }).value;
  const subscribe = (notify: () => void) => {
    cached = undefined;
    return listen(() => {
      cached = undefined;
      notify();
    });
  };
  return { getSnapshot, subscribe };
}
