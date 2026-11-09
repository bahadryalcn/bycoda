/**
 * Index a radio-group key moves to, or null when the key is not a navigation key or no enabled
 * option is reachable. Arrows wrap and skip disabled options; Home and End take the first and
 * last enabled option.
 */
export function radioKeyTarget(
  key: string,
  index: number,
  count: number,
  isEnabled: (index: number) => boolean = () => true,
): number | null {
  const step = (delta: number): number | null => {
    for (let hop = 1; hop <= count; hop += 1) {
      const next = (((index + delta * hop) % count) + count) % count;
      if (isEnabled(next)) return next;
    }
    return null;
  };
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return step(1);
    case "ArrowLeft":
    case "ArrowUp":
      return step(-1);
    case "Home":
      for (let i = 0; i < count; i += 1) if (isEnabled(i)) return i;
      return null;
    case "End":
      for (let i = count - 1; i >= 0; i -= 1) if (isEnabled(i)) return i;
      return null;
    default:
      return null;
  }
}
