import { describe, expect, it } from "vitest";
import { sessionRowStatusKind, type SessionRowStatusInput } from "./SessionRowStatus";

const base: SessionRowStatusInput = {
  needsApproval: false,
  busy: false,
  opening: false,
  done: false,
  draft: false,
};
const wait = { kind: "commands", count: 1 } as const;
const kind = (patch: Partial<SessionRowStatusInput>) => sessionRowStatusKind({ ...base, ...patch });

describe("sessionRowStatusKind", () => {
  it("ranks failed > interrupted > input > working > waiting > opening > done > draft > idle", () => {
    expect(kind({ issue: "failed", busy: true, wait })).toBe("failed");
    expect(kind({ issue: "retrying" })).toBe("retrying");
    expect(kind({ interrupted: true, wait, done: true })).toBe("interrupted");
    expect(kind({ needsApproval: true, busy: true, wait })).toBe("input");
    expect(kind({ busy: true })).toBe("working");
    expect(kind({ busy: true, wait, done: true, opening: true })).toBe("waiting");
    expect(kind({ opening: true, done: true })).toBe("opening");
    expect(kind({ done: true, draft: true })).toBe("done");
    expect(kind({ draft: true })).toBe("draft");
    expect(kind({})).toBe("idle");
  });

  it("shows a delegated-wait parent that is not busy as waiting, not idle or done", () => {
    expect(kind({ wait: { kind: "delegated", count: 1 }, done: true })).toBe("waiting");
  });
});
