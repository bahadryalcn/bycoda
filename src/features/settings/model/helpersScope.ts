import { MODEL_ROUTING_DELEGATION_KEYS } from "../../../shared/model/host-contracts/model-routing";
import type { DraftValue } from "./providerDefaultsDraft";

type Layer = Record<string, string>;

/** Only the helper keys (subagents, advisor, effort ceiling, image models) of a settings record. */
export function helperKeys(values: Record<string, string | undefined> = {}): Layer {
  const next: Layer = {};
  for (const key of MODEL_ROUTING_DELEGATION_KEYS) {
    const value = values[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** The pending helper edits among a change's extras, `null` (reset) included. */
export function pendingHelperEdits(
  extras: Record<string, DraftValue> = {},
): Record<string, DraftValue> {
  return Object.fromEntries(
    Object.entries(extras).filter(([key]) =>
      (MODEL_ROUTING_DELEGATION_KEYS as readonly string[]).includes(key),
    ),
  );
}

/** A stored helper layer with pending edits on top; `null` edits remove the key. */
export function withHelperEdits(
  stored: Layer,
  edits: Record<string, DraftValue> | undefined,
): Layer {
  const next = { ...stored };
  for (const [key, value] of Object.entries(edits ?? {})) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** The edits that turn `stored` into `next`, helper keys only; `undefined` when nothing changed. */
export function helperEdits(
  stored: Layer,
  next: Record<string, string | undefined> = {},
): Record<string, DraftValue> | undefined {
  const edits: Record<string, DraftValue> = {};
  for (const key of MODEL_ROUTING_DELEGATION_KEYS)
    if (stored[key] !== next[key]) edits[key] = next[key] ?? null;
  return Object.keys(edits).length ? edits : undefined;
}
