/** Merges a local id order into the last host order so that, when nothing
 * changed locally, the result equals the host order exactly. Ids this
 * machine does not own keep their host positions; owned ids refill the
 * owned slots in local order; new owned ids are appended. */
export function mergeIdOrder(
  hostOrder: readonly string[],
  localOrderIds: readonly string[],
  owned: ReadonlySet<string>,
): string[] {
  const localOrder = localOrderIds.filter(
    (id, i) => owned.has(id) && localOrderIds.indexOf(id) === i,
  );
  const hostSet = new Set(hostOrder);
  const localInHost = localOrder.filter((id) => hostSet.has(id));
  const inLocal = new Set(localInHost);
  const queue = [...localInHost];
  const order = hostOrder.map((id) => (owned.has(id) && inLocal.has(id) ? queue.shift()! : id));
  for (const id of localOrder) if (!hostSet.has(id)) order.push(id);
  return order;
}
