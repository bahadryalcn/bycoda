import { describe, expect, it } from "vitest";
import {
  beginActiveSubmit,
  endActiveSubmit,
  hasActiveSubmit,
  repairStaleHandoff,
} from "./activeSubmits";
import { appendPreparingHandoff, isPreparingHandoff, lastHandoffBlock } from "./handoff";
import { newSession } from "./session";
import { getSessions, resetSessionsStore } from "./sessionsStore";

function preparing() {
  const session = newSession("claude", "/tmp/project");
  const prepared = appendPreparingHandoff(
    { ...session, blocks: [{ id: "u1", role: "user", text: "hi" }] },
    "claude",
    "codex",
  );
  resetSessionsStore([prepared]);
  return prepared.id;
}

describe("repairStaleHandoff", () => {
  it("cancels a preparing handoff no submit owns", () => {
    const id = preparing();
    expect(repairStaleHandoff(id)).toBe(true);
    expect(isPreparingHandoff(getSessions()[0])).toBe(false);
    expect(lastHandoffBlock(getSessions()[0].blocks)?.handoff?.status).toBe("cancelled");
  });

  it("leaves a handoff alone while its submit is running", () => {
    const id = preparing();
    beginActiveSubmit(id, 1);
    expect(repairStaleHandoff(id)).toBe(false);
    expect(isPreparingHandoff(getSessions()[0])).toBe(true);
    expect(endActiveSubmit(id, 1)).toBe(true);
    expect(hasActiveSubmit(id)).toBe(false);
  });

  it("lets only the newest submit end the registration", () => {
    const id = preparing();
    beginActiveSubmit(id, 1);
    beginActiveSubmit(id, 2);
    expect(endActiveSubmit(id, 1)).toBe(false);
    expect(hasActiveSubmit(id)).toBe(true);
    expect(endActiveSubmit(id, 2)).toBe(true);
  });
});
