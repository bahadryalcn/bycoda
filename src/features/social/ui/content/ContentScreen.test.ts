// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialScreenProps } from "../shell/screens";
import { ContentScreen } from "./ContentScreen";

// The editor and the media-claim hook have their own tests; this file covers the screen states.
vi.mock("./ContentEditor", () => ({
  ContentEditor: () => createElement("div", { "data-testid": "editor" }),
}));
vi.mock("../../hooks/useSocialMediaEditor", () => ({
  useSocialMediaEditor: () => ({}),
}));

type DataState = {
  snapshot?: unknown;
  programs: unknown[];
  loading: boolean;
  error?: unknown;
  refetch: () => void;
};
const state: { data: DataState } = { data: { programs: [], loading: false, refetch: () => {} } };
vi.mock("./useContentData", () => ({
  useContentData: () => state.data,
}));

let element: HTMLDivElement;
let root: Root;

const shellState = { hostOnline: true, unreachable: false, aiStopped: false };
const account = { id: "x1", platform: "x", name: "Studio", grants: { p1: ["draft"] } };
const campaign = {
  id: "c1",
  name: "Launch week",
  projectIds: ["p1"],
  revision: 1,
  paused: false,
  createdAt: 1,
  variants: [{ accountId: "x1", text: "Hello", media: [], scheduledAt: Date.now(), factIds: [] }],
};
const snapshot = {
  accounts: [account],
  campaigns: [campaign],
  jobs: [],
  profiles: [],
  capabilities: {},
  sendingEnabled: true,
};

function props(patch: Partial<SocialScreenProps> = {}): SocialScreenProps {
  return {
    client: {} as SocialScreenProps["client"],
    machineId: "m1",
    projectId: "p1",
    shellState,
    active: true,
    onNavigate: vi.fn(),
    ...patch,
  } as SocialScreenProps;
}

function render(screen: SocialScreenProps) {
  act(() => root.render(createElement(ContentScreen, screen)));
}

function buttonWith(text: string): HTMLButtonElement | undefined {
  return [...element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  state.data = { snapshot, programs: [], loading: false, refetch: vi.fn() };
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("ContentScreen states", () => {
  it("asks for a project before showing posts, and disables New post", () => {
    render(props({ projectId: undefined }));
    expect(element.textContent).toContain("Choose a project at the top to see its posts.");
    expect(buttonWith("New post")?.disabled).toBe(true);
  });

  it("shows one sentence, one primary action and Fill with AI when there are no posts", () => {
    state.data = {
      snapshot: { ...snapshot, campaigns: [] },
      programs: [],
      loading: false,
      refetch: vi.fn(),
    };
    const onNavigate = vi.fn();
    render(props({ onNavigate }));
    expect(element.textContent).toContain("No posts yet.");
    expect(buttonWith("New post")).toBeDefined();
    buttonWith("Fill with AI")?.click();
    expect(onNavigate).toHaveBeenCalledWith("command", { prompt: "Plan this week's posts" });
  });

  it("offers a retry when the posts cannot be loaded", () => {
    const refetch = vi.fn();
    state.data = {
      snapshot: undefined,
      programs: [],
      loading: false,
      error: new Error("offline"),
      refetch,
    };
    render(props());
    expect(element.textContent).toContain("Could not load posts.");
    buttonWith("Try again")?.click();
    expect(refetch).toHaveBeenCalled();
  });

  it("shows loading text while the first read is in flight", () => {
    state.data = { snapshot: undefined, programs: [], loading: true, refetch: vi.fn() };
    render(props());
    expect(element.textContent).toContain("Loading…");
  });

  it("switches from the week calendar to the month calendar", () => {
    render(props());
    expect(element.querySelector(".content-calendar")?.getAttribute("data-view")).toBe("week");
    act(() => buttonWith("Month")?.click());
    expect(element.querySelector(".content-calendar")?.getAttribute("data-view")).toBe("month");
  });

  it("lists saved posts by name in the list view", () => {
    render(props());
    act(() => buttonWith("List")?.click());
    expect(element.textContent).toContain("Launch week");
    expect(element.querySelector(".content-rows")).not.toBeNull();
  });
});
