import { expect, it } from "vitest";
import {
  jobStatusFailureSummary,
  listAssistantJobActivity,
  recordJobProblemActivity,
  type JobStatusFailurePorts,
} from "./assistant-job-activity";

function fakeDb(rows: unknown[]) {
  const calls: unknown[][] = [];
  return {
    calls,
    db: {
      prepare: (sql: string) => ({
        all: (...args: unknown[]) => {
          calls.push([sql, ...args]);
          return rows;
        },
      }),
    } as never,
  };
}

it("reads job activity filtered by jobId, newest first, with a bounded limit", async () => {
  const row = {
    id: "e1",
    kind: "job.done",
    jobId: "job-1",
    createdAt: 5,
    summary: "Done",
  };
  const { db, calls } = fakeDb([{ value: JSON.stringify(row) }]);
  expect(await listAssistantJobActivity(db, "job-1", 50)).toEqual([row]);
  expect(calls[0][0]).toContain("json_extract(value,'$.jobId')=?");
  expect(calls[0][0]).toContain("ORDER BY json_extract(value,'$.createdAt') DESC");
  expect(calls[0].slice(1)).toEqual(["job-1", 50]);
});

it("summarizes a status failure with its message on one line", () => {
  expect(jobStatusFailureSummary(new Error("goal\n  missing"))).toBe(
    "Job status check failed: goal missing",
  );
  expect(jobStatusFailureSummary("plain")).toBe("Job status check failed: plain");
});

it("records a problem once per distinct message and again when the message changes", async () => {
  const runtime = new Map<string, unknown>();
  const recorded: string[] = [];
  const ports: JobStatusFailurePorts = {
    runtime: async <T>(id: string, fallback: T) =>
      runtime.has(id) ? (runtime.get(id) as T) : fallback,
    setRuntime: async (id, value) => {
      runtime.set(id, value);
    },
    activity: async (_kind, summary) => {
      recorded.push(summary);
      return {} as never;
    },
  };
  expect(await recordJobProblemActivity(ports, "job-1", "Job status check failed: x")).toBe(true);
  expect(await recordJobProblemActivity(ports, "job-1", "Job status check failed: x")).toBe(false);
  expect(await recordJobProblemActivity(ports, "job-1", "Job status check failed: y")).toBe(true);
  expect(await recordJobProblemActivity(ports, "job-2", "Job status check failed: x")).toBe(true);
  expect(recorded).toEqual([
    "Job status check failed: x",
    "Job status check failed: y",
    "Job status check failed: x",
  ]);
});
