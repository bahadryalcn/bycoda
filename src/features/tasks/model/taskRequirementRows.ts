/**
 * Client-only row identities for a draft's required resources. The persisted requirement has no
 * id and the Host strips unknown fields, so keys live beside the draft and never reach storage.
 */
export type RequirementRowKeys = {
  /** Next key to mint. Every key already in use is below it. */
  readonly next: number;
  readonly keys: readonly number[];
};

export const EMPTY_REQUIREMENT_ROW_KEYS: RequirementRowKeys = { next: 0, keys: [] };

/**
 * One key per row. A draft replaced outside this list (a saved workflow, a refresh, another
 * window) keeps keys by position and mints fresh keys for rows it added.
 */
export function alignRequirementRowKeys(
  rows: RequirementRowKeys,
  length: number,
): RequirementRowKeys {
  if (rows.keys.length === length) return rows;
  const keys = rows.keys.slice(0, length);
  let next = rows.next;
  while (keys.length < length) keys.push(next++);
  return { next, keys };
}

export function appendRequirementRowKey(rows: RequirementRowKeys, length: number) {
  const aligned = alignRequirementRowKeys(rows, length);
  return { next: aligned.next + 1, keys: [...aligned.keys, aligned.next] };
}

/** Removing a row drops only its key, so neighbours keep the identity and state they had. */
export function removeRequirementRowKey(rows: RequirementRowKeys, length: number, index: number) {
  const aligned = alignRequirementRowKeys(rows, length);
  return { next: aligned.next, keys: aligned.keys.filter((_, at) => at !== index) };
}
