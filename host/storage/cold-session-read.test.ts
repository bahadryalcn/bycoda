import { expect, it, vi } from "vitest";
import { SessionReadError } from "../domains/sessions/read-errors";
import type { SessionReadProcesses } from "../session-read-process";
import type { StoreDatabase } from "../store-db";
import { prefetchColdSession } from "./cold-session-read";

const options = (error: Error) => {
  const admit = vi.fn();
  return {
    admit,
    input: {
      id: "s",
      signal: new AbortController().signal,
      path: "host.db",
      processes: { read: () => Promise.reject(error) } as unknown as SessionReadProcesses,
      db: {} as StoreDatabase,
      resident: () => false,
      admit,
    },
  };
};

it("hands a transcript over the child reply budget back to the in-queue read", async () => {
  const { input, admit } = options(new SessionReadError("snapshot-budget"));
  await expect(prefetchColdSession(input)).resolves.toBe("oversized");
  expect(admit).not.toHaveBeenCalled();
});

it("still rejects other child read failures", async () => {
  const { input } = options(new SessionReadError("overloaded"));
  await expect(prefetchColdSession(input)).rejects.toMatchObject({ kind: "overloaded" });
});
