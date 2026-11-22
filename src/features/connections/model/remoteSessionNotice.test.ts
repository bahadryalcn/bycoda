import { expect, it } from "vitest";
import { classifyQueueReadFailure, queueReadFailureDetail } from "./remoteQueueReadFailure";
import { remoteQueueReadNotice } from "./remoteSessionNotice";

const context = { machineId: "m1", environmentId: "env-1", sessionId: "s1", at: 1_000 };

it("classifies a queue read failure as transient or not", () => {
  expect(classifyQueueReadFailure("Host read capacity is busy", context)).toMatchObject({
    code: "QUEUE_READ_TEMPORARY",
    transient: true,
    operation: "queue.read",
  });
  expect(classifyQueueReadFailure("Machine is unreachable", context).transient).toBe(true);
  expect(
    classifyQueueReadFailure(
      "Host identity changed. Add this machine again before continuing.",
      context,
    ),
  ).toMatchObject({
    code: "QUEUE_READ_IDENTITY",
    transient: false,
  });
});

it("keeps machine, environment, session, operation, time and code on the queue card and its history", () => {
  const failure = classifyQueueReadFailure("Host read capacity is busy", context);
  const notice = remoteQueueReadNotice(
    "Host read capacity is busy",
    () => {},
    failure,
    "Office Mac",
  );
  expect(notice.details).toBe(queueReadFailureDetail(failure, "Office Mac"));
  for (const part of [
    "Office Mac",
    "env-1",
    "s1",
    "queue.read",
    "1970-01-01T00:00:01.000Z",
    "QUEUE_READ_TEMPORARY",
  ])
    expect(notice.details).toContain(part);
  expect(notice.history).toContain("QUEUE_READ_TEMPORARY");
  expect(notice.history).toContain("Host read capacity is busy");
});
