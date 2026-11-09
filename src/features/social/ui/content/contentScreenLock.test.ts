// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialScreenProps } from "../shell/screens";
import { ContentScreen } from "./ContentScreen";

// The editor has its own tests; here it only reports the `locked` text the screen computed.
vi.mock("./ContentEditor", () => ({
  ContentEditor: (props: { locked?: string; draft: { campaignId?: string } }) =>
    createElement("div", {
      "data-testid": "editor",
      "data-locked": props.locked ?? "",
      "data-campaign": props.draft.campaignId ?? "",
    }),
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

const LOCK_TEXT = "This post was already scheduled or sent, so it can't be edited here.";

let element: HTMLDivElement;
let root: Root;

const shellState = { hostOnline: true, unreachable: false, aiStopped: false };
const account = { id: "x1", platform: "x", name: "Studio", grants: { p1: ["draft"] } };

function campaign(id: string, name: string) {
  return {
    id,
    name,
    projectIds: ["p1"],
    revision: 1,
    paused: false,
    createdAt: 1,
    variants: [{ accountId: "x1", text: name, media: [], scheduledAt: Date.now(), factIds: [] }],
  };
}

function job(id: string, campaignId: string, status: string) {
  return {
    id,
    campaignId,
    kind: "publish",
    status,
    accountId: "x1",
    scheduledAt: Date.now(),
    payload: { text: "Hi" },
  };
}

function load(jobs: unknown[]) {
  state.data = {
    snapshot: {
      accounts: [account],
      campaigns: [campaign("c1", "Launch week"), campaign("c2", "Draft only")],
      jobs,
      profiles: [],
      capabilities: {},
      sendingEnabled: true,
    },
    programs: [],
    loading: false,
    refetch: vi.fn(),
  };
}

function render() {
  act(() =>
    root.render(
      createElement(ContentScreen, {
        client: {} as never,
        machineId: "m1",
        projectId: "p1",
        shellState,
        active: true,
        onNavigate: vi.fn(),
      } as unknown as SocialScreenProps),
    ),
  );
}

function openFromList(name: string) {
  const list = [...element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "List",
  );
  act(() => list?.click());
  const row = [...element.querySelectorAll<HTMLButtonElement>("button.content-row")].find(
    (button) => button.textContent?.includes(name),
  );
  act(() => row?.click());
}

function editor() {
  const node = element.querySelector<HTMLElement>('[data-testid="editor"]');
  return node ? { locked: node.dataset.locked, campaign: node.dataset.campaign } : undefined;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

describe("ContentScreen edit lock", () => {
  it.each(["queued", "running", "succeeded", "review"])(
    "locks a saved post that has a %s publish job",
    (status) => {
      load([job("j1", "c1", status)]);
      render();
      openFromList("Launch week");
      expect(editor()).toEqual({ locked: LOCK_TEXT, campaign: "c1" });
    },
  );

  it.each(["failed", "cancelled"])(
    "leaves a saved post with a %s job open for editing",
    (status) => {
      load([job("j1", "c1", status)]);
      render();
      openFromList("Launch week");
      expect(editor()).toEqual({ locked: "", campaign: "c1" });
    },
  );

  it("locks a failed post once a retry is queued", () => {
    load([job("j1", "c1", "failed"), job("j2", "c1", "queued")]);
    render();
    openFromList("Launch week");
    expect(editor()).toEqual({ locked: LOCK_TEXT, campaign: "c1" });
  });

  it("opens a saved post without jobs for editing", () => {
    load([job("j1", "c1", "queued")]);
    render();
    openFromList("Draft only");
    expect(editor()).toEqual({ locked: "", campaign: "c2" });
  });

  it("does not lock a new post because other posts have jobs", () => {
    load([job("j1", "c1", "queued")]);
    render();
    const newPost = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "New post",
    );
    act(() => newPost?.click());
    expect(editor()).toEqual({ locked: "", campaign: "" });
  });
});
