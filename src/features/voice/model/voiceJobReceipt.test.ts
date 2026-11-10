import { expect, it, vi } from "vitest";
import { voiceJobReceipt } from "./voiceJobReceipt";

const jobs = [
  { id: "a", title: "A", status: "running" },
  { id: "b", title: "B", status: "queued" },
];

it("reports started and the hold reason with a spoken next hint", async () => {
  const request = vi.fn(async () => ({ snapshot: { jobHolds: { b: "report" as const } } }));
  const receipt = await voiceJobReceipt(jobs, request);
  expect(request).toHaveBeenCalledWith({ op: "snapshot", limit: 100 });
  expect(receipt.jobs).toEqual([
    { id: "a", title: "A", status: "running", started: true },
    { id: "b", title: "B", status: "queued", started: false, holdReason: "report" },
  ]);
  expect(receipt.next).toContain("report mode");
});

it("still returns a receipt when the hold read fails", async () => {
  const receipt = await voiceJobReceipt(jobs.slice(1), async () => {
    throw new Error("offline");
  });
  expect(receipt.jobs[0]).toMatchObject({ started: false });
  expect(receipt.jobs[0]).not.toHaveProperty("holdReason");
});

it.each([
  ["limits", "at its limit"],
  ["noModel", "no model in the pool"],
] as const)("explains the %s model-pool hold", async (reason, text) => {
  const receipt = await voiceJobReceipt(jobs, async () => ({
    snapshot: { jobHolds: { b: reason } },
  }));
  expect(receipt.next).toContain(text);
});
