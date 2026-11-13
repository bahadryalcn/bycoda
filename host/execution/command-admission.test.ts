import { expect, it, vi } from "vitest";
import { composeCommandAdmission } from "./command-admission";

it("runs both exact receipt writers when the first persistence callback rejects", async () => {
  const failure = new Error("Domain receipt write failed");
  const receipt = { commandId: "send", sessionId: "session", runId: "run", revision: 1 };
  const workReceipt = vi.fn(async () => {});
  const admission = composeCommandAdmission(
    {
      check: async () => {},
      onAccepted: async () => {
        throw failure;
      },
    },
    { check: async () => {}, onAccepted: workReceipt },
  );
  await expect(admission.onAccepted!(receipt)).rejects.toThrow(
    "Command receipt persistence failed",
  );
  expect(workReceipt).toHaveBeenCalledWith(receipt);
});

it("never passes an outer admission denial to the inner gate", async () => {
  const inner = vi.fn(async () => {});
  const failure = new Error("Original producer revoked");
  const admission = composeCommandAdmission(
    {
      check: async () => {
        throw failure;
      },
    },
    { check: inner },
  );
  await expect(
    admission.check({ phase: "provider", sessionId: "session", runId: "run" }),
  ).rejects.toBe(failure);
  expect(inner).not.toHaveBeenCalled();
});
