/** Ordered async collection operations for storage-backed predicates/mappers.
 * Sequential evaluation preserves the side-effect order and short-circuiting
 * of the synchronous collection operations they replace. */
export async function mapAsync<T, U>(
  items: readonly T[],
  map: (item: T, index: number, items: readonly T[]) => U | Promise<U>,
): Promise<U[]> {
  const result: U[] = [];
  for (let index = 0; index < items.length; index++)
    result.push(await map(items[index], index, items));
  return result;
}

export async function flatMapAsync<T, U>(
  items: readonly T[],
  map: (
    item: T,
    index: number,
    items: readonly T[],
  ) => U | readonly U[] | Promise<U | readonly U[]>,
): Promise<U[]> {
  const result: U[] = [];
  for (let index = 0; index < items.length; index++) {
    const value = await map(items[index], index, items);
    if (Array.isArray(value)) result.push(...value);
    else result.push(value as U);
  }
  return result;
}

export async function filterAsync<T>(
  items: readonly T[],
  test: (item: T, index: number, items: readonly T[]) => unknown | Promise<unknown>,
): Promise<T[]> {
  const result: T[] = [];
  for (let index = 0; index < items.length; index++)
    if (await test(items[index], index, items)) result.push(items[index]);
  return result;
}

export async function someAsync<T>(
  items: readonly T[],
  test: (item: T, index: number, items: readonly T[]) => unknown | Promise<unknown>,
): Promise<boolean> {
  for (let index = 0; index < items.length; index++)
    if (await test(items[index], index, items)) return true;
  return false;
}

export async function everyAsync<T>(
  items: readonly T[],
  test: (item: T, index: number, items: readonly T[]) => unknown | Promise<unknown>,
): Promise<boolean> {
  for (let index = 0; index < items.length; index++)
    if (!(await test(items[index], index, items))) return false;
  return true;
}

export async function forEachAsync<T>(
  items: readonly T[],
  visit: (item: T, index: number, items: readonly T[]) => unknown | Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < items.length; index++) await visit(items[index], index, items);
}
