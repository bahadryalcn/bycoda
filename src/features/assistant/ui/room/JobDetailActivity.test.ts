// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistantRequest } from "../../../../shared/model/host-contracts/assistant";
import { JobDetailActivity } from "./JobDetailActivity";

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/**
 * The Room recreates its request helper on every render, and a request can itself make the Room
 * render again. Activity must load once per job and retry, not once per Room render.
 */
it("reads a job's activity once even when the Room re-renders with a new request helper", async () => {
  const calls: AssistantRequest[] = [];
  function Room() {
    const [renders, setRenders] = useState(0);
    const request = async (input: AssistantRequest) => {
      calls.push(input);
      setRenders((value) => value + 1);
      return { ok: true, jobActivity: [] } as never;
    };
    return createElement(
      "div",
      { "data-renders": renders },
      createElement(JobDetailActivity, { jobId: "job-1", request }),
    );
  }
  root = createRoot(container);
  await act(async () => root!.render(createElement(Room)));
  for (let i = 0; i < 5; i++) await act(async () => {});
  expect(calls).toEqual([{ op: "jobs.activity", id: "job-1", limit: 50 }]);
  expect(container.textContent).toContain("No activity yet");
});
