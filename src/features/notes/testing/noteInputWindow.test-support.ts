import { expect } from "vitest";
import { noteActivityOwner } from "../notesInputOwners";
import { invalidateNoteImagePaths } from "../notes";

/** Fresh physical-window fixture after actual promises/DOM teardown settled.
 * No production clear API: a real window owns these process-local keepers.
 */
export function resetNoteInputWindowForTest() {
  invalidateNoteImagePaths();
  const globals = globalThis as Record<PropertyKey, unknown>;
  const owners = globals[Symbol.for("bycoda.notes-input-owners.v1")] as {
    version: number;
    owners: Set<unknown>;
    listeners: Set<unknown>;
    applying?: unknown;
  };
  const core = globals[Symbol.for("bycoda.mounted-notes-input-closure.v1")] as {
    entries: Map<number, { read(): { snapshot: { surface?: string } } }>;
    works: Set<unknown>;
    gate?: unknown;
    leases: number;
    retainedBytes: number;
    epoch: number;
  };
  expect(owners.version).toBe(1);
  expect(core.works.size, "the previous physical window must finish actual accepted work").toBe(0);
  expect(core.gate, "the previous physical window must release its actual gate").toBeUndefined();
  const activity = noteActivityOwner();
  owners.owners.clear();
  owners.owners.add(activity);
  owners.listeners.clear();
  owners.applying = undefined;
  for (const [id, entry] of core.entries) {
    let surface: string | undefined;
    try {
      surface = entry.read().snapshot.surface;
    } catch {
      /* old domain reader */
    }
    if (surface !== "activity" && surface !== "service-intents") core.entries.delete(id);
  }
  core.leases = 0;
  core.retainedBytes = 0;
  core.epoch++;
  const intents = globals[Symbol.for("bycoda.note-service-intents.v1")] as
    | {
        records: Map<number, { pending: boolean }>;
        bytes: number;
        observationUnavailable: boolean;
      }
    | undefined;
  if (intents) {
    expect([...intents.records.values()].some((record) => record.pending)).toBe(false);
    intents.records.clear();
    intents.bytes = 0;
    intents.observationUnavailable = false;
  }
}
