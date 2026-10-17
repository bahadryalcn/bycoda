// @vitest-environment happy-dom
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { focusManager } from "@tanstack/react-query";
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPrograms as QueryComponent } from "./SocialPrograms";
import { defaultProgram, programApprovalSteps } from "../model/socialProgram";
import type { SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { setLanguagePreference } from "../../../shared/i18n";
import { SocialPanelActiveContext } from "./socialContext";
import { chooseSocialValue } from "./socialTestControls";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
async function render(
  supported = true,
  active = true,
  programProjectId?: string,
  withProjects = false,
) {
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
    profiles: withProjects
      ? [
          {
            projectId: "a",
            brandVoice: "Alpha voice",
            facts: [{ id: "fact-a", topic: "Topic", text: "Verified", verifiedAt: 1 }],
          },
          { projectId: "b", brandVoice: "Beta voice", facts: [] },
        ]
      : [],
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
            projects: withProjects
              ? [
                  { id: "a", name: "Alpha", cwd: "/a" },
                  { id: "b", name: "Beta", cwd: "/b" },
                ]
              : [],
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

it("keeps schedule drafts and approval step policy when choosing visible native radio modes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { host, request } = await render();
  const group = (label: string) =>
    Array.from(host.querySelectorAll("fieldset")).find(
      (fieldset) => fieldset.querySelector(":scope > legend")?.textContent === label,
    )!;
  const choose = async (label: string, value: string) => {
    const radio = group(label).querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    await act(async () => radio.click());
    expect(radio.checked).toBe(true);
  };
  const input = (label: string) => {
    const element = Array.from(
      host.querySelectorAll<HTMLLabelElement>(".social-program-field > label"),
    ).find((item) => item.textContent === label)!;
    return document.getElementById(element.htmlFor) as HTMLInputElement;
  };
  await choose("Schedule mode", "times");
  await act(async () => {
    const times = input("Publishing times (HH:mm, comma separated)");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      times,
      "10:00, 14:00",
    );
    times.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await choose("Schedule mode", "interval");
  expect(input("Minimum interval (minutes)")).toBeTruthy();
  await choose("Schedule mode", "frequency");
  expect(input("Posts per period")).toBeTruthy();
  await choose("Schedule mode", "times");
  expect(input("Publishing times (HH:mm, comma separated)").value).toBe("10:00, 14:00");
  for (const mode of ["approved", "automatic", "semi"] as const) {
    await choose("Approval mode", mode);
    const selected = Array.from(
      group("Approval mode").parentElement!.querySelectorAll<HTMLInputElement>(
        '.social-program-days input[type="checkbox"]',
      ),
    ).filter((checkbox) => checkbox.checked);
    expect(selected).toHaveLength(programApprovalSteps(mode).length);
  }
  expect(group("Approval mode").textContent).toContain("Final publication");
  expect(group("Approval mode").textContent).toContain("Automatic after explicit activation");
  expect(request.mock.calls.every(([action]) => action === "programs.list")).toBe(true);
  vi.unstubAllGlobals();
});

it("searches required projects and resets project facts while adopting the new brand voice", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { host } = await render(true, true, undefined, true);
  const project =
    host.querySelector<HTMLSelectElement>("[data-native-searchable-select] select") ??
    host.querySelector<HTMLSelectElement>("select[required]")!;
  expect(project.required).toBe(true);
  const trigger = () =>
    host.querySelector<HTMLButtonElement>('button[aria-label^="Project:"]') ??
    host.querySelector<HTMLButtonElement>('.social-program-field button[aria-haspopup="dialog"]')!;
  await chooseSocialValue(trigger(), "a");
  const facts = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Verified public facts"]',
  )!;
  await chooseSocialValue(facts, "fact-a");
  expect(
    host.querySelector('[aria-label="Verified public facts: seçilenler"]')?.textContent,
  ).toContain("Topic");
  // Multi-selection keeps its popup open until dismissed.
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await chooseSocialValue(trigger(), "b");
  expect(project.value).toBe("b");
  const voiceLabel = Array.from(host.querySelectorAll<HTMLLabelElement>("label")).find(
    (item) => item.textContent === "Brand voice",
  )!;
  expect((document.getElementById(voiceLabel.htmlFor) as HTMLTextAreaElement).value).toBe(
    "Beta voice",
  );
  expect(host.querySelector('[aria-label="Verified public facts: seçilenler"]')).toBeNull();
  vi.unstubAllGlobals();
});

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

it("associates adapter fields with visible labels and retains free-entry model and timezone values", async () => {
  const { host } = await render();
  const field = (text: string) => {
    const label = Array.from(
      host.querySelectorAll<HTMLLabelElement>(".social-program-field > label"),
    ).find((item) => item.textContent === text)!;
    expect(label).toBeTruthy();
    const control = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLSelectElement;
    expect(control).toBeTruthy();
    expect(control.getAttribute("aria-labelledby")?.split(" ")).toContain(label.id);
    return control;
  };
  expect(host.querySelector("label label")).toBeNull();
  const provider = field("Text provider");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      provider,
      "codex",
    );
    provider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const model = field("Text model") as HTMLInputElement;
  expect(model.disabled).toBe(false);
  expect(document.getElementById(model.getAttribute("list")!)?.tagName).toBe("DATALIST");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      model,
      "owner/private-model-v9",
    );
    model.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(model.value).toBe("owner/private-model-v9");
  const timezone = field("Time zone") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      timezone,
      "America/New_York",
    );
    timezone.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(timezone.value).toBe("America/New_York");
});
