export type TreeSelectionModifiers = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/** Select ranges in rendered tree order; Ctrl/Cmd+Shift adds a range. */
export function selectTreePaths(
  current: ReadonlySet<string>,
  path: string,
  anchor: string | null,
  visible: readonly string[],
  modifiers: TreeSelectionModifiers = {},
): Set<string> {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  if (modifiers.shiftKey) {
    const start = anchor ? visible.indexOf(anchor) : -1;
    const end = visible.indexOf(path);
    const range =
      start >= 0 && end >= 0
        ? visible.slice(Math.min(start, end), Math.max(start, end) + 1)
        : [path];
    return new Set(additive ? [...current, ...range] : range);
  }
  if (!additive) return new Set([path]);
  const next = new Set(current);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** A selected folder already carries its descendants for filesystem operations. */
export function topLevelTreePaths(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) =>
      !unique.some(
        (parent) =>
          parent !== path &&
          path.replace(/\\/g, "/").startsWith(`${parent.replace(/\\/g, "/").replace(/\/$/, "")}/`),
      ),
  );
}
