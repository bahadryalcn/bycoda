// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPrograms } from "./SocialPrograms";
import { defaultProgram } from "../model/socialProgram";
import type { SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { setLanguagePreference } from "../../../shared/i18n";
import { SocialPanelActiveContext } from "./socialContext";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});
async function render(supported = true, active = true, programProjectId?: string) {
  await setLanguagePreference("en");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const request = vi.fn(async () => []);
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
    );
  });
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, request };
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
