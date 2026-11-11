/** Keep removed rows as ordering anchors while any undo notice still owns them. */
export function createQueuedUndoOrder() {
  let order: string[] = [];
  const aliases = new Map<string, string>();
  const active = new Set<{ token: string }>();
  return {
    capture(currentIds: readonly string[], removedId: string, restoredId: string) {
      const canonical = (id: string) =>
        order.find((token) => token === id || aliases.get(token) === id) ?? id;
      const live = currentIds.map(canonical);
      const next = [...live];
      const retained = new Set([...active].map((receipt) => receipt.token));
      // Insert missing anchors backwards so adjacent removals retain their order.
      for (let index = order.length - 1; index >= 0; index--) {
        const token = order[index];
        if (next.includes(token) || !retained.has(token)) continue;
        const following = order.slice(index + 1).find((id) => next.includes(id));
        const preceding = order
          .slice(0, index)
          .reverse()
          .find((id) => next.includes(id));
        const position = following
          ? next.indexOf(following)
          : preceding
            ? next.indexOf(preceding) + 1
            : Math.min(index, next.length);
        next.splice(position, 0, token);
      }
      order = next;
      const token = canonical(removedId);
      const receipt = { token };
      active.add(receipt);
      aliases.set(token, restoredId);
      return {
        ids: (): readonly string[] =>
          order.map((id) => (id === token ? removedId : (aliases.get(id) ?? id))),
        dispose: () => {
          active.delete(receipt);
          if (!active.size) {
            order = [];
            aliases.clear();
          }
        },
      };
    },
  };
}
