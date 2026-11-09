import { expect, it, vi } from "vitest";
import { loadJobActivity } from "./jobActivityLoad";

it("requests the bounded job activity log by job id", async () => {
  const request = vi.fn(async () => ({ jobActivity: [] }));
  await expect(loadJobActivity(request, "job-one")).resolves.toEqual([]);
  expect(request).toHaveBeenCalledWith({ op: "jobs.activity", id: "job-one", limit: 50 });
});

it("returns the Host's rows in the order received", async () => {
  const rows = [{ id: "b" }, { id: "a" }] as never;
  const request = vi.fn(async () => ({ jobActivity: rows }));
  await expect(loadJobActivity(request, "job-one", 2)).resolves.toBe(rows);
});

it("treats a response without the activity list as unconfirmed, not empty", async () => {
  const request = vi.fn(async () => ({}));
  await expect(loadJobActivity(request, "job-one")).rejects.toThrow(
    "Job activity could not be confirmed. Retry.",
  );
});
