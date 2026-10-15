// @vitest-environment happy-dom
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { focusManager } from "@tanstack/react-query";
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPrograms as QueryComponent } from "./SocialPrograms";
import { defaultProgram } from "../model/socialProgram";
import type { SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { setLanguagePreference } from "../../../shared/i18n";
import { SocialPanelActiveContext } from "./socialContext";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
async function render(supported = true, active = true, programProjectId?: string) {
  await setLanguagePreference("en");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const request = vi.fn(async () => []);
  const commits = vi.fn();
  const client = { request, upload: vi.fn(), uploadVideo: vi.fn() } as unknown as SocialClient;
  const snapshot = {
    programsSupported: supported,
    programProjectId,
    accounts: [],
    campaigns: [],
    jobs: [],
    profiles: [],
    approvedCampaignIds: [],
  } as unknown as SocialSnapshot;
  await act(async () => {
    root.render(
      createElement(
        SocialPanelActiveContext.Provider,
        { value: active },
        createElement(
          Profiler,
          { id: "programs", onRender: commits },
          createElement(SocialPrograms, {
            client,
            snapshot,
            projects: [],
            run: async (work) => {
              await work();
              return true;
            },
          }),
        ),
      ),
    );
  });
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, request, commits };
}
describe("Social campaign program UI", () => {
  it("uses the workspace project filter for campaign reads", async () => {
    const { request } = await render(true, true, "selected-project");
    expect(request).toHaveBeenCalledWith("programs.list", { projectId: "selected-project" });
  });
  it("does not expose unsupported controls to an old host", async () => {
    const { host, request } = await render(false);
    expect(host.textContent).toBe("");
    expect(request).not.toHaveBeenCalled();
  });
  it("retains discovery and stops polling when its panel is inactive", async () => {
    const { host, request } = await render(true, false);
    expect(host.textContent).toContain("Create AI campaign");
    expect(request).not.toHaveBeenCalled();
  });
  it("presents independent agents, three schedule modes and owner-controlled approval steps", async () => {
    const { host, request } = await render();
    expect(request).toHaveBeenCalledWith("programs.list", {});
    const content = host.textContent!;
    for (const label of [
      "Text provider",
      "Image provider",
      "Specific times",
      "Intervals",
      "Posting frequency",
      "Approval mode",
      "Final publication",
      "Save paused campaign",
    ]) {
      if (label === "Image provider") expect(content).toContain("Media source");
      else expect(content).toContain(label);
    }
    expect(defaultProgram().approval.mode).toBe("semi");
    expect(defaultProgram().totalPosts).toBe(10);
  });
});

const SocialPrograms = withQueryClient(QueryComponent);

it("does not issue its initial request while the window is hidden", async () => {
  focusManager.setFocused(false);
  const { request } = await render();
  expect(request).not.toHaveBeenCalled();
  await act(async () => focusManager.setFocused(true));
  expect(request).toHaveBeenCalledOnce();
});

it("shares unchanged polling data without rendering and refreshes after hidden time", async () => {
  vi.useFakeTimers();
  const { request, commits } = await render();
  await act(async () => vi.advanceTimersByTimeAsync(10));
  commits.mockClear();
  for (let i = 0; i < 3; i++) await act(async () => vi.advanceTimersByTimeAsync(5_010));
  expect(request).toHaveBeenCalledTimes(4);
  expect(commits).not.toHaveBeenCalled();
  await act(async () => focusManager.setFocused(false));
  const reads = request.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(request).toHaveBeenCalledTimes(reads);
  await act(async () => focusManager.setFocused(true));
  expect(request).toHaveBeenCalledTimes(reads + 1);
});
