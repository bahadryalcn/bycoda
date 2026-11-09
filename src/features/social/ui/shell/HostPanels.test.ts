// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HostPanels, type HostPanelsProps } from "./HostPanels";
import type { SocialScreenId, SocialScreenProps } from "./screens";

/**
 * Replacement for the old RetainedSocialPanel test: an opened section stays mounted, so the
 * owner's unsaved draft survives navigation and Host switches. Hidden sections are told they
 * are inactive (`active: false`) so they pause polling, instead of having their props frozen.
 */

const store = vi.hoisted(() => ({ props: {} as Record<string, SocialScreenProps> }));
const makeStub = vi.hoisted(
  () => (react: typeof import("react"), id: string) =>
    function StubScreen(props: SocialScreenProps) {
      store.props[`${props.machineId}:${id}`] = props;
      const [draft, setDraft] = react.useState("");
      return react.createElement("input", {
        "data-screen": id,
        value: draft,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      });
    },
);

vi.mock("../../model/socialClient", () => ({
  socialClient: (machineId: string) => ({ machineId }),
}));
vi.mock("../command/CommandScreen", async () => ({
  CommandScreen: makeStub(await import("react"), "command"),
}));
vi.mock("../content/ContentScreen", async () => ({
  ContentScreen: makeStub(await import("react"), "content"),
}));
vi.mock("../audience/AudienceScreen", async () => ({
  AudienceScreen: makeStub(await import("react"), "audience"),
}));
vi.mock("../inbox/InboxScreen", async () => ({
  InboxScreen: makeStub(await import("react"), "inbox"),
}));
vi.mock("../accounts/AccountsScreen", async () => ({
  AccountsScreen: makeStub(await import("react"), "accounts"),
}));

let element: HTMLDivElement, root: Root;
const onNavigate = vi.fn();
const shellState = { hostOnline: true, unreachable: false, aiStopped: false };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.props = {};
  onNavigate.mockReset();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

function render(patch: Partial<HostPanelsProps> = {}) {
  return act(async () => {
    root.render(
      createElement(HostPanels, {
        machineId: "m1",
        active: true,
        screen: "command",
        visited: ["command"],
        shellState,
        onNavigate,
        ...patch,
      }),
    );
  });
}

function input(screen: SocialScreenId): HTMLInputElement | null {
  return element.querySelector<HTMLInputElement>(`[data-screen="${screen}"]`);
}

function panelOf(screen: SocialScreenId): HTMLElement {
  return input(screen)!.parentElement!;
}

function hostElement(): HTMLElement {
  return element.firstElementChild as HTMLElement;
}

async function type(screen: SocialScreenId, value: string) {
  await act(async () => {
    const field = input(screen)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("mounts only the sections the owner has opened, in navigation order", async () => {
  await render({ visited: ["inbox", "command"], screen: "command" });
  expect(
    [...element.querySelectorAll("[data-screen]")].map((node) => node.getAttribute("data-screen")),
  ).toEqual(["command", "inbox"]);
  expect(input("audience")).toBeNull();
  expect(input("content")).toBeNull();
  expect(input("accounts")).toBeNull();
});

it("shows only the current section and marks the others inactive", async () => {
  await render({ visited: ["command", "inbox"], screen: "inbox" });
  expect(panelOf("inbox").hidden).toBe(false);
  expect(panelOf("command").hidden).toBe(true);
  expect(store.props["m1:inbox"]?.active).toBe(true);
  expect(store.props["m1:command"]?.active).toBe(false);
});

it("keeps an unsaved draft in a hidden section and restores it when the owner returns", async () => {
  await render({ visited: ["command", "content"], screen: "content" });
  await type("content", "unsaved post text");
  const before = input("content");
  await render({ visited: ["command", "content"], screen: "command" });
  expect(panelOf("content").hidden).toBe(true);
  expect(store.props["m1:content"]?.active).toBe(false);
  expect(input("content")).toBe(before);
  expect(input("content")?.value).toBe("unsaved post text");
  await render({ visited: ["command", "content"], screen: "content" });
  expect(panelOf("content").hidden).toBe(false);
  expect(store.props["m1:content"]?.active).toBe(true);
  expect(input("content")?.value).toBe("unsaved post text");
});

it("hides a Host that is not on screen, pauses all its sections and keeps their drafts", async () => {
  await render({ visited: ["command", "audience"], screen: "audience" });
  await type("audience", "half-written note");
  await render({ visited: ["command", "audience"], screen: "audience", active: false });
  expect(hostElement().hidden).toBe(true);
  expect(store.props["m1:audience"]?.active).toBe(false);
  expect(store.props["m1:command"]?.active).toBe(false);
  await render({ visited: ["command", "audience"], screen: "audience", active: true });
  expect(hostElement().hidden).toBe(false);
  expect(store.props["m1:audience"]?.active).toBe(true);
  expect(input("audience")?.value).toBe("half-written note");
});

it("passes the navigation target only to the current section", async () => {
  const target = { personId: "p1" };
  await render({ visited: ["command", "audience"], screen: "audience", target });
  expect(store.props["m1:audience"]?.target).toBe(target);
  expect(store.props["m1:command"]?.target).toBeUndefined();
});

it("gives every section its Host's client, project, shell state and navigation callback", async () => {
  await render({
    machineId: "m7",
    projectId: "p9",
    visited: ["command", "accounts"],
    screen: "accounts",
  });
  for (const id of ["command", "accounts"] as const) {
    const props = store.props[`m7:${id}`]!;
    expect(props.machineId).toBe("m7");
    expect(props.projectId).toBe("p9");
    expect(props.shellState).toBe(shellState);
    expect(props.onNavigate).toBe(onNavigate);
    expect((props.client as unknown as { machineId: string }).machineId).toBe("m7");
  }
});

it("keeps one client per Host across renders so sections do not reload", async () => {
  await render({ visited: ["command", "inbox"], screen: "command" });
  const first = store.props["m1:command"]!.client;
  await render({ visited: ["command", "inbox"], screen: "inbox" });
  expect(store.props["m1:command"]!.client).toBe(first);
  expect(store.props["m1:inbox"]!.client).toBe(first);
});
