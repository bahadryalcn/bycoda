// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAssistantRoomJobs } from "./useAssistantRoomJobs";
import type { AssistantRoomCore } from "./useAssistantRoomState";

it.each(["working", "doneToday"])("opens exactly the %s counter's jobs", async (filter) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const jobs = [
    { id: "planning", status: "planning", updatedAt: 1 },
    { id: "running", status: "running", updatedAt: 1 },
    { id: "stalled", status: "stalled", updatedAt: 1 },
    { id: "today", status: "done", updatedAt: dayStart, createdAt: 1 },
    { id: "yesterday", status: "done", updatedAt: dayStart - 1 },
  ];
  let visible: string[] = [];
  const core = {
    projects: [],
    snapshot: { jobs },
    selected: new Set(),
    query: "",
    filter,
    view: "Jobs",
    jobProjectFilter: "",
    jobDateFilter: "all",
    jobReview: null,
  } as unknown as AssistantRoomCore;
  function Harness() {
    visible = useAssistantRoomJobs(core).allJobs.map((job) => job.id);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(visible).toEqual(filter === "working" ? ["planning", "running", "stalled"] : ["today"]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each([false, true])("clears only the submitted job brief (newer edit=%s)", async (edited) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let text = "Submitted brief";
  let complete!: (ok: boolean) => void;
  let jobs!: ReturnType<typeof useAssistantRoomJobs>;
  const core = {
    environmentId: "host",
    jobText: text,
    jobReview: null,
    jobReviewFrozen: false,
    jobReviewEnvironment: { current: undefined },
    jobBatch: { current: { start: vi.fn() } },
    jobIntents: { current: {} },
    selected: new Set(),
    projects: [],
    snapshot: undefined,
    setJobReviewFrozen: vi.fn(),
    setJobReview: vi.fn(),
    reviewIntent: () => "intent",
    setJobText: (value: string | ((current: string) => string)) => {
      text = typeof value === "function" ? value(text) : value;
    },
    run: () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  } as unknown as AssistantRoomCore;
  function Harness() {
    jobs = useAssistantRoomJobs(core);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    let pending!: Promise<void>;
    await act(async () => {
      pending = jobs.submitJobs({ rows: [{ id: "draft" } as any], frozen: false });
    });
    if (edited) text = "New unsent brief";
    await act(async () => {
      complete(true);
      await pending;
    });
    expect(text).toBe(edited ? "New unsent brief" : "");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
