/** Same equivalence the desktop uses: Claude ids appear dotted and CLI-style. */
function preferenceKey(value: string): string {
  return value.startsWith("claude:")
    ? value.replace(/^claude:claude-/, "claude:").replace(/\./g, "-")
    : value;
}

/**
 * Drops the models the owner turned off in the desktop. A provider whose every model is off keeps
 * its list (an empty list reads as "no catalog yet"), matching the desktop picker.
 */
export function applyDisabledModels<T extends object>(
  catalog: T,
  disabled: readonly string[] | undefined,
): T {
  const models = (catalog as { models?: Record<string, Array<{ id?: string }>> }).models;
  if (!disabled?.length || !models || typeof models !== "object") return catalog;
  const off = new Set(disabled.map(preferenceKey));
  return {
    ...catalog,
    models: Object.fromEntries(
      Object.entries(models).map(([provider, list]) => {
        if (!Array.isArray(list)) return [provider, list];
        const kept = list.filter((model) => !model.id || !off.has(preferenceKey(model.id)));
        return [provider, kept.length > 0 ? kept : list];
      }),
    ),
  };
}
