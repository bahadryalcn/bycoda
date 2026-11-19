import { expect, it } from "vitest";
import { HostTaskSchema } from "../../src/shared/model/host-contracts/tasks";
import { ownerNotice } from "./review-outcomes";

it("lets tasks.list carry the runtime retry notice the scheduler actually writes", () => {
  // Regression: the notice carries `kind`, the strict contract rejected it, and every tasks.list
  // read failed, so phones kept showing the last state ("Running") of a retried task.
  const advisor = {
    requestId: "request",
    sessionId: "session",
    findings: "",
    feedback: "",
    error: "model unavailable",
    fingerprint: "fingerprint",
    runtimeRetryNotice: ownerNotice("auto_continued", "Retried automatically after a runtime error (1/2).", 1, "notice"),
  };
  expect(HostTaskSchema.shape.repairAdvisor.safeParse(advisor).success).toBe(true);
  // Records written before the field existed stay readable.
  const { kind: _kind, ...legacy } = advisor.runtimeRetryNotice;
  expect(HostTaskSchema.shape.repairAdvisor.safeParse({ ...advisor, runtimeRetryNotice: legacy }).success).toBe(true);
});
