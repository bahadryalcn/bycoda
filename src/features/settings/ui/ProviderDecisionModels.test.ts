// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";
import { ProviderDecisionModels } from "./ProviderDecisionModels";

type Machine = { id: string; name: string };
type Entry = {
  id: string;
  isLocal: boolean;
  name: string;
  status: "connected" | "checking" | "offline" | "pair-again" | "update-needed";
  reason?: string;
  machine?: Machine;
};

const state = vi.hoisted(() => ({
  loading: false,
  entry: undefined as unknown,
  selected: undefined as unknown,
  missing: false,
  clientFor: [] as string[],
}));

// The scope owns which Host is chosen; this suite checks only what the page does with it.
vi.mock("../../connections/public/settingsHosts", async (importActual) => ({
  ...(await importActual<typeof import("../../connections/public/settingsHosts")>()),
  useSettingsHostScope: () => ({
    loading: state.loading,
    checking: false,
    local: undefined,
    entries: [],
    entry: state.entry,
    missing: state.missing,
    selected: state.selected,
    error: undefined,
    options: [],
    value: "",
    select: () => {},
    retry: () => {},
  }),
  SettingsHostPicker: () => null,
}));
vi.mock("../../decision-models", () => ({
  decisionModelsClient: vi.fn((machineId: string) => {
    state.clientFor.push(machineId);
    return { machineId };
  }),
  DecisionModelsSettings: (props: {
    client: { machineId: string };
    hostName: string;
    remote: boolean;
  }) => {
    // Stands for an open dialog or an edit in progress that belongs to the Host.
    const [draft, setDraft] = useState("");
    return createElement(
      "div",
      { "data-decision-settings": props.client.machineId },
      createElement("span", { "data-host": "" }, `${props.hostName}:${props.remote}`),
      createElement("input", {
        "data-draft": "",
        value: draft,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      }),
    );
  },
}));

let element: HTMLDivElement, root: Root;

const rendered = () =>
  element.querySelector("[data-decision-settings]")?.getAttribute("data-decision-settings") ?? null;

const local = (status: Entry["status"], reason?: string): Entry => ({
  id: "local-1",
  isLocal: true,
  name: "This computer",
  status,
  reason,
  machine: { id: "local-1", name: "This computer" },
});
const remote = (status: Entry["status"]): Entry => ({
  id: "remote-1",
  isLocal: false,
  name: "Remote",
  status,
  machine: { id: "remote-1", name: "Remote" },
});

/** The scope's view when `entry` is the chosen machine: selected only while it is connected. */
function choose(entry: Entry | undefined) {
  state.entry = entry;
  state.selected = entry?.status === "connected" ? entry.machine : undefined;
}

const render = () => act(() => root.render(createElement(ProviderDecisionModels)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  state.loading = false;
  state.entry = undefined;
  state.selected = undefined;
  state.missing = false;
  state.clientFor = [];
});

it("keeps the search anchor and reports a loading Host without binding to any machine", () => {
  vi.useFakeTimers();
  state.loading = true;
  void render();
  act(() => {
    vi.advanceTimersByTime(LOADING_DELAY_MS);
  });
  expect(rendered()).toBeNull();
  expect(element.querySelector('[data-setting-id="decision-models"]')).not.toBeNull();
  expect(element.textContent).toContain("Loading");
  expect(state.clientFor).toEqual([]);
});

it("reports this computer's offline Host and never falls back to a listed remote machine", () => {
  // A remote machine is listed first while the local Host has no record: the scope still names
  // this computer, and the page must not create a client for anything else.
  choose(local("offline", "Connection refused"));
  void render();
  expect(rendered()).toBeNull();
  expect(element.textContent).toContain("This computer is offline.");
  expect(state.clientFor).toEqual([]);
});

it("runs on this computer's Host once it is connected", () => {
  choose(local("connected"));
  void render();
  expect(rendered()).toBe("local-1");
  expect(element.querySelector("[data-host]")?.textContent).toBe("This computer:false");
  expect(state.clientFor).toEqual(["local-1"]);
});

it("runs on a remote Host only when the owner chose it, and marks it remote", () => {
  choose(remote("connected"));
  void render();
  expect(rendered()).toBe("remote-1");
  expect(element.querySelector("[data-host]")?.textContent).toBe("Remote:true");
});

it("reports a chosen remote Host that went offline instead of switching to another machine", () => {
  choose(remote("connected"));
  void render();
  choose(remote("offline"));
  void render();
  expect(rendered()).toBeNull();
  expect(element.textContent).toContain("Remote is offline.");
  expect(state.clientFor).toEqual(["remote-1"]);
});

it("reports a chosen machine that was removed and keeps nothing selected", () => {
  state.missing = true;
  void render();
  expect(rendered()).toBeNull();
  expect(element.textContent).toContain("This machine is no longer available.");
  expect(state.clientFor).toEqual([]);
});

it("keeps one Host's draft across renders and drops it only when another Host is chosen", () => {
  choose(local("connected"));
  void render();
  const input = () => element.querySelector<HTMLInputElement>("[data-draft]")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), "half-typed");
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input().value).toBe("half-typed");
  // The same Host described by a fresh machine object (a list refresh) keeps the draft.
  choose(local("connected"));
  void render();
  expect(input().value).toBe("half-typed");
  expect(state.clientFor).toEqual(["local-1"]);
  // An explicit change of Host is the only thing that replaces the page.
  choose(remote("connected"));
  void render();
  expect(rendered()).toBe("remote-1");
  expect(input().value).toBe("");
});
