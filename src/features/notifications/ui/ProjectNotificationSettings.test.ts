// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import { rememberNotificationProjects } from "../model/notificationProjects";
import { ProjectNotificationSettings } from "./ProjectNotificationSettings";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn().mockRejectedValue(new Error("No native bridge")),
}));
vi.mock("../../settings/model/bycodaSoundEngine", () => ({
  play: vi.fn(),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  rememberNotificationProjects([
    {
      id: "repository:github.com/me/private",
      name: "me/private",
      detail: "github.com",
      kind: "repository",
      paths: [],
    },
    {
      id: "repository:github.com/work/app",
      name: "work/app",
      detail: "github.com",
      kind: "repository",
      paths: [],
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Category switches are named by their category; the project is the legend of their group.
function categoryControl(label: string): HTMLInputElement | HTMLButtonElement | null {
  const [category, project] = label.split(" for ");
  if (!project) {
    return container.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"], input[aria-label^="${label} ("]`,
    );
  }
  const group = [...container.querySelectorAll("fieldset")].find((fieldset) =>
    fieldset.querySelector("legend")?.textContent?.startsWith(`${project} (`),
  );
  return (
    [...(group?.querySelectorAll<HTMLButtonElement>('button[role="switch"]') ?? [])].find(
      (button) => button.textContent?.trim() === category,
    ) ?? null
  );
}
function checkbox(label: string): HTMLInputElement | HTMLButtonElement {
  const control = categoryControl(label);
  expect(control, `Missing membership control: ${label}`).not.toBeNull();
  return control!;
}
function checked(control: HTMLInputElement | HTMLButtonElement) {
  return control instanceof HTMLInputElement
    ? control.checked
    : control.getAttribute("aria-checked") === "true";
}

function categoriesButton(project: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label^="Notification categories for ${project} ("]`,
  )!;
}

it("reveals and focuses a requested project even when the search excludes it", async () => {
  await act(async () =>
    root.render(createElement(ProjectNotificationSettings, { cwd: "/work/target" })),
  );
  const search = container.querySelector<HTMLInputElement>(".project-notification-toolbar input")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(search, "me/private");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(categoriesButton("target")).toBeNull();
  await act(async () =>
    root.render(
      createElement(ProjectNotificationSettings, {
        cwd: "/work/target",
        notificationProjectPath: "/work/target",
        notificationSettingsRequest: 1,
      }),
    ),
  );
  expect(search.value).toBe("");
  expect(categoriesButton("target").getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(categoriesButton("target").closest("fieldset"));
});

it("saves only the selected project's categories while preserving its mute deadline", async () => {
  updateNotificationPreferences(["repository:github.com/me/private"], {
    mutedUntil: null,
  });
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));

  act(() => categoriesButton("me/private").click());
  for (const category of [
    "Issues and Linear tasks",
    "Agent finished",
    "Agent approvals and questions",
  ]) {
    act(() => checkbox(`${category} for me/private`).click());
  }

  expect(checked(checkbox("Pull requests / Merge requests for me/private"))).toBe(true);
  expect(checked(checkbox("Issues and Linear tasks for me/private"))).toBe(false);
  expect(loadNotificationPreferences()["repository:github.com/me/private"]).toEqual({
    disabled: ["issues", "agentFinished", "agentInput"],
    mutedUntil: null,
  });
  expect(loadNotificationPreferences()["repository:github.com/work/app"]).toBeUndefined();
});

it("offers only issue notifications for a Linear project", async () => {
  rememberNotificationProjects([
    {
      id: "linear:project:roadmap",
      name: "Roadmap",
      detail: "Linear",
      kind: "linear",
      paths: [],
    },
  ]);
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
  act(() => categoriesButton("Roadmap").click());
  const issue = checkbox("Issues and Linear tasks for Roadmap");
  expect(issue.closest("fieldset")?.querySelectorAll('[role="switch"]')).toHaveLength(1);
  act(() => issue.click());
  expect(loadNotificationPreferences()["linear:project:roadmap"]?.disabled).toEqual(["issues"]);
});

it("keeps local projects while offering only local notification categories", async () => {
  rememberNotificationProjects([
    {
      id: "local:/fun",
      name: "fun",
      detail: "/fun",
      kind: "local",
      paths: ["/fun"],
    },
  ]);
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "/fun" })));

  const local = categoriesButton("fun");
  expect(local.textContent).toContain("All");
  act(() => local.click());
  expect(checked(checkbox("Agent finished for fun"))).toBe(true);
  expect(checked(checkbox("Agent approvals and questions for fun"))).toBe(true);
  expect(checked(checkbox("Reminders for fun"))).toBe(true);
  expect(categoryControl("Pull requests / Merge requests for fun")).toBeNull();
  expect(categoryControl("Issues and Linear tasks for fun")).toBeNull();
});

it("discovers recent projects and focuses the project requested by a quick action", async () => {
  vi.mocked(invoke)
    .mockImplementationOnce(async () => ({
      root: "/newwork",
      commonDir: null,
      remote: null,
    }))
    .mockImplementationOnce(async () => ({
      root: "/newprivate",
      commonDir: null,
      remote: null,
    }));
  await act(async () =>
    root.render(
      createElement(ProjectNotificationSettings, {
        cwd: "/newwork",
        recents: [{ path: "/newprivate", openedAt: 1 }],
        notificationProjectPath: "/newprivate",
      }),
    ),
  );
  expect(container.querySelector('[aria-label^="Agent finished for newwork ("]')).toBeNull();
  const target = checkbox("Agent finished for newprivate").closest("fieldset");
  expect(document.activeElement).toBe(target);
  expect(categoriesButton("newprivate").getAttribute("aria-expanded")).toBe("true");
  expect(categoriesButton("newwork").getAttribute("aria-expanded")).toBe("false");
});

it("mounts categories only for the expanded project and preserves choices when switching projects", async () => {
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
  const personal = categoriesButton("me/private");
  const work = categoriesButton("work/app");
  const categorySwitch = (project: string) =>
    container.querySelector(`[aria-label^="Issues and Linear tasks for ${project} ("]`);
  expect(personal.hasAttribute("aria-controls")).toBe(false);
  expect(work.hasAttribute("aria-controls")).toBe(false);
  expect(categorySwitch("me/private")).toBeNull();
  expect(categorySwitch("work/app")).toBeNull();

  act(() => personal.click());
  const personalPanelId = personal.getAttribute("aria-controls")!;
  expect(document.getElementById(personalPanelId)).not.toBeNull();
  expect(work.hasAttribute("aria-controls")).toBe(false);
  act(() => checkbox("Issues and Linear tasks for me/private").click());
  expect(personal.textContent).toContain("5 categories");
  act(() => work.click());
  expect(document.getElementById(personalPanelId)).toBeNull();
  expect(categorySwitch("me/private")).toBeNull();
  expect(checked(checkbox("Issues and Linear tasks for work/app"))).toBe(true);
  act(() => personal.click());
  expect(checked(checkbox("Issues and Linear tasks for me/private"))).toBe(false);
  act(() => personal.click());
  expect(categorySwitch("me/private")).toBeNull();
  expect(categorySwitch("work/app")).toBeNull();
});

it("mutes several selected projects without changing another project's notifications", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T08:00:00Z"));
  rememberNotificationProjects([
    {
      id: "repository:github.com/me/other",
      name: "me/other",
      detail: "github.com",
      kind: "repository",
      paths: [],
    },
  ]);
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
  expect(container.querySelector('input[aria-label="Select me/private"]')).toBeNull();
  const selectProjects = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Select projects",
  );
  expect(selectProjects).toBeInstanceOf(HTMLButtonElement);
  act(() => selectProjects!.click());
  act(() => checkbox("Select me/private").click());
  act(() => checkbox("Select me/other").click());
  const bulk = container.querySelector('[aria-label="Mute selected projects"]');
  expect(bulk).not.toBeNull();
  act(() =>
    [...bulk!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Mute")!
      .click(),
  );
  const eightHours = [...document.querySelectorAll('[role="menuitem"]')].find((button) =>
    button.textContent?.startsWith("8 hours ("),
  );
  expect(eightHours).toBeInstanceOf(HTMLButtonElement);
  act(() => (eightHours as HTMLButtonElement).click());
  expect(loadNotificationPreferences()["repository:github.com/me/private"]?.mutedUntil).toBe(
    Date.parse("2026-09-14T16:00:00Z"),
  );
  expect(loadNotificationPreferences()["repository:github.com/me/other"]?.mutedUntil).toBe(
    Date.parse("2026-09-14T16:00:00Z"),
  );
  expect(loadNotificationPreferences()["repository:github.com/work/app"]).toBeUndefined();
});

it.each(["manual", "expiry"])(
  "explains the project-wide pause and preserves editable category choices after %s resume",
  async (resumeMode) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-15T12:00:00Z"));
    updateNotificationPreferences(["repository:github.com/me/private"], {
      mutedUntil: resumeMode === "manual" ? null : Date.now() + 60_000,
      disabled: ["issues"],
    });
    await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
    act(() => categoriesButton("me/private").click());
    const project = categoriesButton("me/private").closest("fieldset")!;
    expect(categoriesButton("me/private").textContent).toContain("Muted");
    const pr = checkbox("Pull requests / Merge requests for me/private");
    const description = document.getElementById(pr.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain(
      "Your category choices apply when notifications resume.",
    );
    expect(checked(pr)).toBe(true);
    expect(pr.disabled).toBe(false);
    act(() => checkbox("Reminders for me/private").click());
    expect(categoriesButton("me/private").textContent).toContain("Muted");
    const resume = [...project.querySelectorAll("button")].find(
      (button) => button.textContent === "Resume notifications",
    );
    expect(resume).toBeInstanceOf(HTMLButtonElement);
    if (resumeMode === "manual") {
      act(() => resume!.click());
    } else {
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
    }
    expect(categoriesButton("me/private").textContent).toContain("4 categories");
    expect(project.textContent).not.toContain("Muted");
    expect(pr.hasAttribute("aria-describedby")).toBe(false);
    expect(checked(checkbox("Issues and Linear tasks for me/private"))).toBe(false);
    expect(loadNotificationPreferences()["repository:github.com/me/private"]).toMatchObject({
      disabled: ["issues", "reminders"],
    });
  },
);

it("dismisses the mute menu and custom date picker without changing preferences", async () => {
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
  const project = categoriesButton("me/private").closest("fieldset")!;
  const trigger = project.querySelector<HTMLButtonElement>('[aria-label="Mute notifications"]')!;
  act(() => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);

  act(() => trigger.click());
  const custom = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent === "Choose date and time",
  )!;
  act(() => custom.click());
  const dialog = document.querySelector(
    '[role="dialog"][aria-label="Mute project notifications"]',
  )!;
  expect(dialog).not.toBeNull();
  const cancel = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  act(() => cancel.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
  expect(loadNotificationPreferences()["repository:github.com/me/private"]).toBeUndefined();
});

it("shows unreadable saved choices as unavailable, pauses edits and recovers on retry", async () => {
  updateNotificationPreferences(["repository:github.com/me/private"], { disabled: ["issues"] });
  localStorage.setItem("bycoda.projectNotifications.v1", "{broken");
  await act(async () =>
    root.render(createElement(ProjectNotificationSettings, { cwd: "/work/target" })),
  );
  expect(container.textContent).toContain("Saved project notification choices could not be read");
  await act(async () => categoriesButton("me/private").click());
  const issues = checkbox("Issues and Linear tasks for me/private");
  expect(issues.hasAttribute("disabled")).toBe(true);
  const mute = container.querySelector<HTMLButtonElement>('[aria-label="Mute notifications"]')!;
  expect(mute.disabled).toBe(true);

  localStorage.setItem("bycoda.projectNotifications.v1", "{}");
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Retry")!
      .click();
  });
  expect(container.textContent).not.toContain("could not be read");
  expect(checkbox("Issues and Linear tasks for me/private").hasAttribute("disabled")).toBe(false);
  expect(mute.disabled).toBe(false);
});

it("names each category switch by its category and the list region without repeating the project", async () => {
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
  act(() => categoriesButton("me/private").click());
  expect(checkbox("Issues and Linear tasks for me/private").hasAttribute("aria-label")).toBe(false);
  expect(container.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe("Projects");
});

it("select-all under a search selects only the projects on screen", async () => {
  await act(async () => root.render(createElement(ProjectNotificationSettings, { cwd: "" })));
  const selectMode = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Select projects",
  )!;
  await act(async () => selectMode.click());
  const search = container.querySelector<HTMLInputElement>(".project-notification-toolbar input")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(search, "me/private");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[aria-label="Select all shown"]')!.click(),
  );
  expect(container.textContent).toContain("1 selected");
  await act(async () => {
    setValue.call(search, "");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    checked(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Select me/private (github.com)"]',
      )!,
    ),
  ).toBe(true);
  expect(
    checked(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Select work/app (github.com)"]',
      )!,
    ),
  ).toBe(false);
});
