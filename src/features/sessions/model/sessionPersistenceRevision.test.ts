import { expect, it } from "vitest";
import type { Session } from "./session";
import { sessionPersistenceRevision } from "./sessionPersistenceRevision";

it("retains an immutable snapshot stamp across unrelated store revisions", () => {
  const original = { id: "one", blocks: [] } as unknown as Session;
  const first = sessionPersistenceRevision(original, 10);
  expect(sessionPersistenceRevision(original, 11)).toBe(first);
  expect(sessionPersistenceRevision({ ...original }, 11)).not.toBe(first);
  // Two remote snapshots may arrive within the same local-store revision.
  expect(sessionPersistenceRevision({ ...original }, 11)).not.toBe(
    sessionPersistenceRevision({ ...original }, 11),
  );
});
