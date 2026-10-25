// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostTask } from "../model/hostTasks";
import { TaskAcceptanceEvidence } from "./TaskAcceptanceEvidence";

let container: HTMLDivElement;
let root: Root;
const brief = (acceptance = ["Save the report", "Verify the sources"]) =>
  JSON.stringify({
    schema: "bycoda.task.v1",
    objective: "Write a report",
    deliverables: ["report.md"],
    acceptance,
    constraints: [],
    verification: [],
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  task: Pick<HostTask, "prompt" | "verification">,
  onOpenReview = vi.fn(),
  isOpeningSession?: (sessionId: string) => boolean,
) {
  await act(async () =>
    root.render(createElement(TaskAcceptanceEvidence, { task, onOpenReview, isOpeningSession })),
  );
}

it("keeps criteria unverified when a legacy review passed without per-criterion evidence", async () => {
  await render({
    prompt: brief(),
    verification: { review: { verdict: "pass", note: "Looks good", sessionId: "legacy" } },
  });
  expect(container.querySelector("summary")?.textContent).toContain("0/2 verified");
  expect(container.querySelector("summary")?.textContent).toContain("2 unresolved");
  expect(container.querySelectorAll('[data-acceptance-verdict="verified"]')).toHaveLength(0);
  expect(container.textContent).toContain("A passing review alone does not verify these criteria.");
  expect(container.textContent).toContain("Save the report");
  expect(container.textContent).toContain("Verify the sources");
});

it("shows recorded verdicts and inert evidence, with provenance opening only the recorded review", async () => {
  const onOpenReview = vi.fn();
  await render(
    {
      prompt: brief(),
      verification: {
        acceptance: {
          checkedAt: 1_700_000_000_000,
          sessionId: "review-session",
          criteria: [
            {
              criterionIndex: 0,
              criterion: "Save the report",
              verdict: "verified",
              evidence: ["javascript:alert(1)", "<img src=x onerror=alert(1)>"],
            },
            {
              criterionIndex: 1,
              criterion: "Verify the sources",
              verdict: "failed",
              evidence: ["Source 2 does not support the claim"],
              note: "Replace the unsupported claim.",
            },
          ],
        },
      },
    },
    onOpenReview,
  );
  expect(container.querySelector("summary")?.textContent).toContain("1/2 verified");
  expect(container.querySelector("summary")?.textContent).toContain("1 failed");
  expect(container.querySelector("a, img, script")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(container.textContent).toContain("Replace the unsupported claim.");
  expect(container.textContent).toContain("Files may have changed since this review.");
  expect(container.querySelector("time")?.dateTime).toBe("2023-11-14T22:13:20.000Z");
  await act(async () => container.querySelector("button")?.click());
  expect(onOpenReview).toHaveBeenCalledExactlyOnceWith("review-session");
});

it("invalidates saved evidence when acceptance instructions change", async () => {
  await render({
    prompt: brief(["Save a different report"]),
    verification: {
      acceptance: {
        checkedAt: 1_700_000_000_000,
        sessionId: "old-review",
        criteria: [
          {
            criterionIndex: 0,
            criterion: "Save the report",
            verdict: "verified",
            evidence: ["report.md"],
          },
        ],
      },
    },
  });
  expect(container.querySelector("summary")?.textContent).toContain("0/1 verified");
  expect(container.textContent).toContain("does not match the current acceptance criteria");
  expect(container.textContent).not.toContain("report.md");
  expect(container.querySelector("button")).toBeNull();
});

it("does not count a verified verdict with blank evidence and prevents duplicate provenance opens", async () => {
  const onOpenReview = vi.fn();
  await render(
    {
      prompt: brief(["Save the report"]),
      verification: {
        acceptance: {
          checkedAt: 1_700_000_000_000,
          sessionId: "review-session",
          criteria: [
            {
              criterionIndex: 0,
              criterion: "Save the report",
              verdict: "verified",
              evidence: ["  "],
            },
          ],
        },
      },
    },
    onOpenReview,
    () => true,
  );
  expect(container.querySelector("summary")?.textContent).toContain("0/1 verified");
  await act(async () => container.querySelector("button")?.click());
  expect(onOpenReview).not.toHaveBeenCalled();
  await render(
    {
      prompt: brief(["Save the report"]),
      verification: {
        acceptance: {
          checkedAt: 1_700_000_000_000,
          sessionId: "review-session",
          criteria: [
            {
              criterionIndex: 0,
              criterion: "Save the report",
              verdict: "verified",
              evidence: ["report.md"],
            },
          ],
        },
      },
    },
    onOpenReview,
    () => true,
  );
  expect(container.querySelector("button")).not.toBeNull();
  await act(async () => container.querySelector("button")?.click());
  expect(onOpenReview).not.toHaveBeenCalled();
});

it.each([
  { checkedAt: 1e100, sessionId: "review", criteria: [] },
  { checkedAt: "not a date", sessionId: "review", criteria: [] },
  { checkedAt: 1_700_000_000_000, sessionId: "review", criteria: null },
  { checkedAt: 1_700_000_000_000, sessionId: "review", criteria: [null] },
])(
  "treats malformed incoming host evidence as unverified without crashing: %j",
  async (acceptance) => {
    await render({
      prompt: brief(),
      verification: { acceptance } as unknown as HostTask["verification"],
    });
    expect(container.querySelector("summary")?.textContent).toContain("0/2 verified");
    expect(container.querySelector("time")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  },
);

it("adds no empty evidence panel to plain legacy tasks or briefs without acceptance criteria", async () => {
  await render({ prompt: "Legacy task" });
  expect(container.childElementCount).toBe(0);
  await render({ prompt: brief([]) });
  expect(container.childElementCount).toBe(0);
});

it("keeps unavailable file freshness visible even when the evidence disclosure is closed", async () => {
  const acceptance = {
    checkedAt: 1_700_000_000_000,
    sessionId: "review-session",
    criteria: [
      {
        criterionIndex: 0,
        criterion: "Save the report",
        verdict: "verified" as const,
        evidence: ["report.md"],
      },
    ],
  };
  await render({ prompt: brief(["Save the report"]), verification: { acceptance } });
  expect(container.querySelector("details")?.open).toBe(false);
  const warning = container.querySelector('[role="status"]');
  expect(warning?.textContent).toContain(
    "File freshness could not be checked. Recheck changed outputs before relying on this evidence.",
  );
  expect(warning?.closest("details")).toBeNull();
  await render({
    prompt: brief(["Save the report"]),
    verification: { acceptance: { ...acceptance, workspaceFingerprint: "recorded-snapshot" } },
  });
  expect(container.querySelector('[role="status"]')).toBeNull();
});
