// @vitest-environment happy-dom
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { focusManager } from "@tanstack/react-query";
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPrograms as QueryComponent } from "./SocialPrograms";
import { defaultProgram, programApprovalSteps, type ProgramDetail } from "../model/socialProgram";
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
  detail?: ProgramDetail,
  accounts: unknown[] = [],
) {
  await setLanguagePreference("en");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const request = vi.fn(async (action: string, _input?: unknown) =>
    action === "programs.status" ? detail : detail ? [detail.program] : [],
  );
  const commits = vi.fn();
  const client = { request, upload: vi.fn(), uploadVideo: vi.fn() } as unknown as SocialClient;
  const snapshot = {
    programsSupported: supported,
    programProjectId,
    accounts,
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
    expect(host.querySelector('nav[aria-label="Create AI campaign"]')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it("presents independent agents, three schedule modes and owner-controlled approval steps", async () => {
    const { host, request } = await render();
    expect(request).toHaveBeenCalledWith("programs.list", {});
    const content = host.textContent!;
    for (const label of [
      "Text agent and model",
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

it("keeps generated image previews separate and recovers a failed preview without losing content", async () => {
  const program = {
    ...defaultProgram(),
    id: "p",
    name: "Two images",
    revision: 1,
    enabled: false,
    createdAt: 1,
    updatedAt: 1,
    executorId: "test",
    generationCount: 0,
    imageGenerationCount: 0,
    generationDay: "",
    dailyGenerationCount: 0,
    nextSequence: 1,
  };
  const detail: ProgramDetail = {
    program,
    occurrences: [
      {
        id: "o",
        programId: "p",
        programRevision: 1,
        sequence: 0,
        scheduledAt: 1,
        originalAt: 1,
        revision: 1,
        targets: [
          {
            accountId: "a",
            platform: "x",
            status: "review",
            approvals: {},
            generation: { attempts: 0, transitions: [] },
            variant: {
              accountId: "a",
              text: "Keep my content",
              scheduledAt: 1,
              factIds: [],
              media: [
                { kind: "image", uploadId: "a", alt: "First" },
                { kind: "image", uploadId: "b", alt: "Second" },
                { kind: "image", alt: "Missing" },
                { kind: "image", url: "https://example.test/image.png", alt: "Remote" },
              ],
            },
          },
        ],
      },
    ],
  };
  const { host, request } = await render(true, true, undefined, false, detail);
  await vi.waitFor(() => expect(host.textContent).toContain("Two images"));
  const choose = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes("Two images"),
  )!;
  await act(async () => choose.click());
  const previews = () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => b.textContent === "Preview generated image",
    );
  expect(previews()).toHaveLength(2);
  request.mockResolvedValueOnce({ mime: "image/png", base64: "YQ==" } as never);
  await act(async () => previews()[0].click());
  expect(host.querySelectorAll(".social-program-target img")).toHaveLength(2);
  expect(host.querySelector('img[alt="First"]')?.getAttribute("src")).toContain("YQ==");
  expect(previews()).toHaveLength(1);
  request.mockRejectedValueOnce(new Error("offline"));
  await act(async () => previews()[0].click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Failed");
  expect(host.querySelector('img[alt="First"]')).not.toBeNull();
  request.mockResolvedValueOnce({ mime: "image/png", base64: "Yg==" } as never);
  const retry = Array.from(
    host.querySelectorAll<HTMLButtonElement>(".social-program-target button"),
  ).find((b) => b.textContent?.includes("Retry"))!;
  await act(async () => retry.click());
  expect(host.querySelector('img[alt="Second"]')?.getAttribute("src")).toContain("Yg==");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>(".social-program-target textarea")?.value).toBe(
    "Keep my content",
  );
  expect(host.textContent).toContain("No image");
  const first = host.querySelector('img[alt="First"]')!;
  await act(async () => first.dispatchEvent(new Event("error")));
  expect(host.querySelector('img[alt="First"]')).toBeNull();
  expect(host.querySelector('img[alt="Second"]')).not.toBeNull();
  const remote = host.querySelector('img[alt="Remote"]')!;
  await act(async () => remote.dispatchEvent(new Event("error")));
  expect(host.querySelector('img[alt="Remote"]')).toBeNull();
  const retryButtons = Array.from(
    host.querySelectorAll<HTMLButtonElement>(".social-program-target button"),
  ).filter((b) => b.textContent === "Retry");
  const remoteRetry = retryButtons[retryButtons.length - 1];
  await act(async () => remoteRetry.click());
  expect(remoteRetry.getAttribute("aria-busy")).toBe("true");
  await act(async () => host.querySelector('img[alt="Remote"]')!.dispatchEvent(new Event("load")));
  expect(host.querySelector('img[alt="Remote"]')).not.toBeNull();
  expect(
    request.mock.calls.some(
      ([action, args]) =>
        action === "programs.media-preview" && !(args as { uploadId?: string })?.uploadId,
    ),
  ).toBe(false);
});

it("guides first campaign setup inline and preserves content while changing steps", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { host, request } = await render(true, true, undefined, true, undefined, [
    {
      id: "account",
      platform: "x",
      name: "Brand",
      connected: true,
      paused: false,
      grants: { a: ["draft"] },
    },
  ]);
  expect(host.querySelector(".social-program-inline")).toBeTruthy();
  expect(host.querySelector(".social-composer-dialog")).toBeNull();
  const field = (label: string) => {
    const element = Array.from(host.querySelectorAll<HTMLLabelElement>("label")).find(
      (item) => item.textContent === label,
    )!;
    return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
  };
  const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const name = field("Campaign name");
  expect(name.closest("details")).toBeNull();
  const contentOptions = host.querySelector<HTMLDetailsElement>(".social-program-content-options")!;
  expect(contentOptions.open).toBe(false);
  expect(contentOptions.textContent).toContain("Brand voice");
  expect(contentOptions.querySelector("[required]")).toBeNull();
  await type(name, "Launch week");
  const steps = host.querySelectorAll<HTMLButtonElement>(".social-program-steps button");
  const step = (index: number) =>
    host.querySelector<HTMLElement>(`[data-program-step="${index}"]`)!;
  // Later steps stay closed until the purpose step has its required content.
  await act(async () => steps[1].click());
  expect(step(0).hidden).toBe(false);
  expect(step(1).hidden).toBe(true);
  expect(host.textContent).toContain(
    "Complete the name, project, brief and eligible target accounts before continuing.",
  );
  expect(name.value).toBe("Launch week");
  await chooseSocialValue(
    host.querySelector<HTMLButtonElement>('button[aria-label^="Project:"]') ??
      host.querySelector<HTMLButtonElement>(
        '.social-program-field button[aria-haspopup="dialog"]',
      )!,
    "a",
  );
  await type(field("Topic"), "Launch");
  await type(field("Description"), "Announce the launch.");
  await chooseSocialValue(
    host.querySelector<HTMLButtonElement>('button[aria-label^="Target accounts"]')!,
    "account",
  );
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await act(async () => steps[1].click());
  expect(step(0).hidden).toBe(true);
  expect(step(1).hidden).toBe(false);
  await act(async () => steps[0].click());
  expect(name.value).toBe("Launch week");
  expect(step(0).hidden).toBe(false);
  expect(request.mock.calls.every(([action]) => action === "programs.list")).toBe(true);
  vi.unstubAllGlobals();
});

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
    const element = Array.from(host.querySelectorAll<HTMLLabelElement>("label")).find(
      (item) => item.textContent === label,
    )!;
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
    host.querySelector('[aria-label="Verified public facts: selected items"]')?.textContent,
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
  expect(host.querySelector('[aria-label="Verified public facts: selected items"]')).toBeNull();
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

it("associates adapter fields with visible labels and retains the free-entry timezone value", async () => {
  const { host } = await render();
  const field = (text: string) => {
    const label = Array.from(host.querySelectorAll<HTMLLabelElement>("label")).find(
      (item) => item.textContent === text,
    )!;
    expect(label).toBeTruthy();
    const control = document.getElementById(label.htmlFor) as HTMLInputElement | HTMLSelectElement;
    expect(control).toBeTruthy();
    expect(control.labels).toContain(label);
    return control;
  };
  expect(host.querySelector("label label")).toBeNull();
  // The agent and model come from the shared picker, not a provider select or free-text field.
  expect(host.querySelector('[data-model-picker-presentation="field"]')).toBeTruthy();
  expect(host.querySelector('select[name="textProvider"], datalist[id$="-models"]')).toBeNull();
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

it("shows the first listed program without an explicit selection and keeps review confirmation per revision", async () => {
  const program = {
    ...defaultProgram(),
    id: "first",
    name: "First program",
    revision: 1,
    enabled: false,
    createdAt: 1,
    updatedAt: 1,
    executorId: "test",
    generationCount: 0,
    imageGenerationCount: 0,
    generationDay: "",
    dailyGenerationCount: 0,
    nextSequence: 0,
  };
  const { host } = await render(true, true, undefined, false, { program, occurrences: [] });
  await vi.waitFor(() =>
    expect(host.querySelector(".social-program-detail h3")?.textContent).toBe("First program"),
  );
  const activate = () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Activate reviewed campaign",
    )!;
  expect(activate().disabled).toBe(true);
  const confirm = host.querySelector<HTMLInputElement>(".social-program-confirm input")!;
  await act(async () => confirm.click());
  expect(activate().disabled).toBe(false);
});
