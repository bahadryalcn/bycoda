// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../../connections/model/protocol";
import { useSocialWorkspace } from "./useSocialWorkspace";
import { SocialShell, type SocialHeaderProps, type SocialShellProps } from "./SocialShell";

// The screens, the first-run offer and the app header are stubbed: this test covers the shell.
// Keep the real platform constants (IS_WIN and friends) that the settings chain reads at load.
vi.mock("../../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../platform/tauri/platform")>()),
  IS_MAC: true,
}));
vi.mock("./SocialFirstRun", () => ({ SocialFirstRun: () => null }));
vi.mock("./useSocialWorkspace", () => ({ useSocialWorkspace: vi.fn() }));
vi.mock("../../model/socialClient", () => ({ socialClient: vi.fn(() => ({})) }));
vi.mock("../command/CommandScreen", () => ({
  CommandScreen: () => createElement("div", { "data-screen": "command" }),
}));
vi.mock("../content/ContentScreen", () => ({
  ContentScreen: () => createElement("div", { "data-screen": "content" }),
}));
vi.mock("../audience/AudienceScreen", () => ({
  AudienceScreen: () => createElement("div", { "data-screen": "audience" }),
}));
vi.mock("../inbox/InboxScreen", () => ({
  InboxScreen: () => createElement("div", { "data-screen": "inbox" }),
}));
vi.mock("../accounts/AccountsScreen", () => ({
  AccountsScreen: () => createElement("div", { "data-screen": "accounts" }),
}));

let element: HTMLDivElement, root: Root;
const stop = vi.fn(async () => ({ aiStopped: true }));
const resume = vi.fn(async () => ({ aiStopped: false }));
const client = { ai: { stop, resume } };
const machines = [
  { id: "m1", name: "Studio", endpoint: "", environmentId: "e" },
  { id: "m2", name: "Laptop", endpoint: "", environmentId: "e" },
] as unknown as RemoteMachine[];
const selectWorkspace = vi.fn();
const setAiStopped = vi.fn();
const retry = vi.fn();

type Workspace = ReturnType<typeof useSocialWorkspace>;

function workspace(patch: Partial<Workspace> = {}): Workspace {
  const shell = { hostOnline: true, unreachable: false, aiStopped: false };
  return {
    machines,
    machineId: "m1",
    projects: [],
    projectId: undefined,
    client: client as unknown as Workspace["client"],
    shell,
    loaded: true,
    error: "",
    selectWorkspace,
    setAiStopped,
    retry,
    shellFor: () => shell,
    projectFor: () => undefined,
    ...patch,
  };
}

/** Stands in for the app's header chrome; records the props the shell hands it. */
const headerSpy = vi.fn((props: SocialHeaderProps) =>
  createElement("header", { "data-header": "" }, props.children),
);

function render(patch: Partial<Workspace> = {}, props: Partial<SocialShellProps> = {}) {
  vi.mocked(useSocialWorkspace).mockReturnValue(workspace(patch));
  act(() =>
    root.render(
      createElement(SocialShell, {
        cwd: "/work/brand",
        onClose: vi.fn(),
        header: headerSpy,
        ...props,
      }),
    ),
  );
}

function navButtons(): HTMLButtonElement[] {
  const nav = element.querySelector(".social-shell-nav");
  return [...(nav?.querySelectorAll("button") ?? [])];
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

function confirmButton(text: string): HTMLButtonElement | undefined {
  const matches = [...document.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === text,
  );
  return matches.at(-1);
}

function panel(screen: string): HTMLElement | null {
  return element.querySelector(`[data-screen="${screen}"]`)?.parentElement ?? null;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  stop.mockClear();
  resume.mockClear();
  selectWorkspace.mockClear();
  setAiStopped.mockClear();
  retry.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

it("shows the five sections in order", () => {
  render();
  expect(navButtons().map((button) => button.textContent?.trim())).toEqual([
    "Command",
    "Content",
    "Audience",
    "Inbox",
    "Accounts & Settings",
  ]);
});

it("marks the open section and keeps an opened section mounted but hidden", () => {
  render();
  const inbox = navButtons().find((button) => button.textContent?.trim() === "Inbox");
  act(() => inbox?.click());
  expect(inbox?.getAttribute("aria-selected")).toBe("true");
  expect(navButtons()[0]?.getAttribute("aria-selected")).toBe("false");
  expect(panel("inbox")?.hidden).toBe(false);
  expect(panel("command")?.hidden).toBe(true);
  act(() => navButtons()[0]?.click());
  expect(panel("inbox")?.hidden).toBe(true);
  expect(panel("command")?.hidden).toBe(false);
});

it("restores each computer's own section when the workspace changes back", () => {
  render();
  act(() => navButtons()[3]?.click());
  render({ machineId: "m2" });
  expect(navButtons()[0]?.getAttribute("aria-selected")).toBe("true");
  render({ machineId: "m1" });
  expect(navButtons()[3]?.getAttribute("aria-selected")).toBe("true");
});

it("stops all AI only after the owner confirms, then records the new state", async () => {
  render();
  act(() => buttonWithText("Stop all AI")?.click());
  await flush();
  expect(stop).not.toHaveBeenCalled();
  act(() => confirmButton("Stop all AI")?.click());
  await flush();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(setAiStopped).toHaveBeenCalledWith(true);
});

it("offers Resume AI while AI is stopped and resumes only after confirmation", async () => {
  render({ shell: { hostOnline: true, unreachable: false, aiStopped: true } });
  expect(buttonWithText("Stop all AI")).toBeUndefined();
  act(() => buttonWithText("Resume AI")?.click());
  await flush();
  expect(resume).not.toHaveBeenCalled();
  act(() => confirmButton("Resume AI")?.click());
  await flush();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(setAiStopped).toHaveBeenCalledWith(false);
});

it("warns when the Host is offline and offers a retry", () => {
  render({ shell: { hostOnline: false, unreachable: false, aiStopped: false }, loaded: true });
  expect(element.textContent).toContain("Scheduling is offline");
  act(() => buttonWithText("Try again")?.click());
  expect(retry).toHaveBeenCalledTimes(1);
});

it("does not show the offline warning before the first snapshot is read", () => {
  render({ shell: { hostOnline: false, unreachable: false, aiStopped: false }, loaded: false });
  expect(element.textContent).not.toContain("Scheduling is offline");
});

it("shows the connection error with a retry when no Host is available", () => {
  render({ machineId: "", client: null, error: "Connect a bycoda Host for Social Media." });
  expect(element.textContent).toContain("Connect a bycoda Host for Social Media.");
  act(() => buttonWithText("Try again")?.click());
  expect(retry).toHaveBeenCalledTimes(1);
});

it("disables Stop all AI with its reason when no Host client exists", () => {
  render({ machineId: "", client: null });
  expect(buttonWithText("Stop all AI")?.disabled).toBe(true);
  expect(element.textContent).toContain("Connect a bycoda Host first.");
});

it("hands the app header the rail state and the close action", () => {
  const onClose = vi.fn();
  headerSpy.mockClear();
  render({}, { onClose, besideRail: true, compactRail: true });
  const props = headerSpy.mock.lastCall?.[0];
  expect(props?.besideRail).toBe(true);
  expect(props?.compactRail).toBe(true);
  expect(props?.onClose).toBe(onClose);
  expect(element.querySelector("[data-header]")?.textContent).toContain("Social Media");
});
