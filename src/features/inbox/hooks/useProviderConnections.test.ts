// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useProviderConnections,
  UNKNOWN_PROVIDER_CONNECTIONS,
  type ProviderConnectionSnapshot,
} from "./useProviderConnections";

const { githubStatus, linearConnected, jiraConnected, gitlabConnected, azureDevOpsConnected } =
  vi.hoisted(() => ({
    githubStatus: vi.fn(),
    linearConnected: vi.fn(),
    jiraConnected: vi.fn(),
    gitlabConnected: vi.fn(),
    azureDevOpsConnected: vi.fn(),
  }));
vi.mock("../model/githubTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/githubTasks")>()),
  githubStatus,
}));
vi.mock("../model/linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/linear")>()),
  linearConnected,
}));
vi.mock("../model/jira", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/jira")>()),
  jiraConnected,
}));
vi.mock("../model/gitlab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/gitlab")>()),
  gitlabConnected,
}));
vi.mock("../model/azureDevOps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/azureDevOps")>()),
  azureDevOpsConnected,
}));

import { LINEAR_CHANGE_EVENT } from "../model/linear";
import { JIRA_CHANGE_EVENT } from "../model/jira";
import { GITLAB_CHANGE_EVENT } from "../model/gitlab";
import { AZUREDEVOPS_CHANGE_EVENT } from "../model/azureDevOps";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const statusMocks = [
  githubStatus,
  linearConnected,
  jiraConnected,
  gitlabConnected,
  azureDevOpsConnected,
];
const status = (connected: boolean) => ({ connected, installed: true });

/** Make every provider answer `connected` (immediately) on its next call. */
function answerAll(connected: boolean) {
  for (const mock of statusMocks) mock.mockResolvedValueOnce(status(connected));
}

describe("useProviderConnections", () => {
  let host: HTMLElement;
  let root: Root;
  let renders: ProviderConnectionSnapshot[];
  let view: ProviderConnectionSnapshot;

  let persisted: ReturnType<typeof vi.fn> | undefined;
  function Consumer() {
    view = useProviderConnections(undefined, persisted);
    renders.push(view);
    return null;
  }
  const mount = () => act(async () => root.render(createElement(Consumer)));
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const fire = (event: string) =>
    act(async () => {
      window.dispatchEvent(new Event(event));
    });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    for (const mock of statusMocks) mock.mockReset();
    renders = [];
    persisted = undefined;
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("hands the newest read to the persist callback, not a dropped older one", async () => {
    persisted = vi.fn();
    const older = deferred<ReturnType<typeof status>>();
    for (const mock of statusMocks) mock.mockReturnValueOnce(older.promise);
    await mount();
    answerAll(false);
    await fire(LINEAR_CHANGE_EVENT);
    await settle();
    expect(persisted!).toHaveBeenCalledTimes(1);
    expect(Object.values(persisted!.mock.calls[0]![0]).every((value) => value === false)).toBe(
      true,
    );
    await act(async () => older.resolve(status(true)));
    expect(persisted!).toHaveBeenCalledTimes(1);
  });

  it("starts unknown and flags nothing unavailable before the first read settles", async () => {
    const gate = deferred<ReturnType<typeof status>>();
    for (const mock of statusMocks) mock.mockReturnValueOnce(gate.promise);
    await mount();
    expect(view.connections).toEqual(UNKNOWN_PROVIDER_CONNECTIONS);
    expect(Object.values(view.unavailable).every((flag) => flag === false)).toBe(true);
    await act(async () => gate.resolve(status(true)));
    expect(Object.values(view.connections).every((value) => value === true)).toBe(true);
  });

  it("drops an older read that resolves after a newer one", async () => {
    const first = statusMocks.map(() => deferred<ReturnType<typeof status>>());
    const second = statusMocks.map(() => deferred<ReturnType<typeof status>>());
    statusMocks.forEach((mock, index) => {
      mock.mockReturnValueOnce(first[index]!.promise).mockReturnValueOnce(second[index]!.promise);
    });
    await mount(); // read #1 starts
    await fire(LINEAR_CHANGE_EVENT); // read #2 starts and is the newest

    // Newer read settles first: connected.
    await act(async () => second.forEach((entry) => entry.resolve(status(true))));
    expect(view.connections.github).toBe(true);
    expect(view.connections.azuredevops).toBe(true);

    // Older read settles afterwards with the opposite answer: must not win.
    await act(async () => first.forEach((entry) => entry.resolve(status(false))));
    expect(view.connections.github).toBe(true);
    expect(view.connections.linear).toBe(true);
    expect(view.connections.jira).toBe(true);
    expect(view.connections.gitlab).toBe(true);
    expect(view.connections.azuredevops).toBe(true);
    expect(view.unavailable.github).toBe(false);
  });

  it("drops an older rejection that settles after a newer success", async () => {
    const first = statusMocks.map(() => deferred<ReturnType<typeof status>>());
    statusMocks.forEach((mock, index) => {
      mock.mockReturnValueOnce(first[index]!.promise).mockResolvedValueOnce(status(true));
    });
    await mount();
    await fire(JIRA_CHANGE_EVENT);
    await settle();
    expect(view.connections.jira).toBe(true);

    await act(async () => first.forEach((entry) => entry.reject(new Error("late failure"))));
    expect(view.connections.jira).toBe(true);
    expect(Object.values(view.unavailable).every((flag) => flag === false)).toBe(true);
  });

  it("keeps the last-known value and marks only the rejected provider unavailable", async () => {
    answerAll(true);
    await mount();
    await settle();
    expect(view.connections.github).toBe(true);
    expect(view.connections.gitlab).toBe(true);

    githubStatus.mockRejectedValueOnce(new Error("gh offline"));
    linearConnected.mockResolvedValueOnce(status(false));
    jiraConnected.mockResolvedValueOnce(status(true));
    gitlabConnected.mockRejectedValueOnce(new Error("timeout"));
    azureDevOpsConnected.mockResolvedValueOnce(status(true));
    await fire(JIRA_CHANGE_EVENT);
    await settle();

    expect(view.connections.github).toBe(true); // kept, not flipped to false
    expect(view.connections.gitlab).toBe(true);
    expect(view.connections.linear).toBe(false); // fresh answers still apply
    expect(view.unavailable).toEqual({
      github: true,
      linear: false,
      jira: false,
      gitlab: true,
      azuredevops: false,
    });
  });

  it("keeps a never-read provider null (not false) when its first read rejects", async () => {
    githubStatus.mockRejectedValueOnce(new Error("no gh"));
    linearConnected.mockResolvedValueOnce(status(true));
    jiraConnected.mockResolvedValueOnce(status(false));
    gitlabConnected.mockResolvedValueOnce(status(false));
    azureDevOpsConnected.mockResolvedValueOnce(status(false));
    await mount();
    await settle();
    expect(view.connections.github).toBeNull();
    expect(view.unavailable.github).toBe(true);
    expect(view.connections.linear).toBe(true);
  });

  it("clears the unavailable flag when the next read succeeds", async () => {
    githubStatus.mockRejectedValueOnce(new Error("flaky"));
    for (const mock of statusMocks.slice(1)) mock.mockResolvedValueOnce(status(false));
    await mount();
    await settle();
    expect(view.unavailable.github).toBe(true);

    answerAll(true);
    await fire(GITLAB_CHANGE_EVENT);
    await settle();
    expect(view.unavailable.github).toBe(false);
    expect(view.connections.github).toBe(true);
  });

  it("starts a new read for each provider-change event", async () => {
    for (let read = 0; read < 5; read += 1) answerAll(false);
    await mount();
    await settle();
    expect(githubStatus).toHaveBeenCalledTimes(1);

    let expected = 1;
    for (const event of [
      LINEAR_CHANGE_EVENT,
      JIRA_CHANGE_EVENT,
      GITLAB_CHANGE_EVENT,
      AZUREDEVOPS_CHANGE_EVENT,
    ]) {
      await fire(event);
      await settle();
      expected += 1;
      for (const mock of statusMocks) expect(mock).toHaveBeenCalledTimes(expected);
    }
  });

  it("reflects a connect/disconnect transition delivered by a change event", async () => {
    answerAll(false);
    await mount();
    await settle();
    expect(view.connections.linear).toBe(false);

    answerAll(true);
    await fire(LINEAR_CHANGE_EVENT);
    await settle();
    expect(view.connections.linear).toBe(true);
  });

  it("does not re-render when a repeat read returns the same answer", async () => {
    answerAll(true);
    await mount();
    await settle();
    const snapshot = view;

    answerAll(true);
    await fire(LINEAR_CHANGE_EVENT);
    await settle();
    expect(view).toBe(snapshot);
  });

  it("ignores in-flight reads after unmount and removes its listeners", async () => {
    const pending = statusMocks.map(() => deferred<ReturnType<typeof status>>());
    statusMocks.forEach((mock, index) => mock.mockReturnValueOnce(pending[index]!.promise));
    await mount();
    const rendersBeforeUnmount = renders.length;
    await act(async () => root.unmount());
    root = createRoot(host); // afterEach unmounts this empty root

    await act(async () => pending.forEach((entry) => entry.resolve(status(true))));
    expect(renders.length).toBe(rendersBeforeUnmount);

    const callsBefore = githubStatus.mock.calls.length;
    for (const event of [
      LINEAR_CHANGE_EVENT,
      JIRA_CHANGE_EVENT,
      GITLAB_CHANGE_EVENT,
      AZUREDEVOPS_CHANGE_EVENT,
    ]) {
      await fire(event);
    }
    expect(githubStatus.mock.calls.length).toBe(callsBefore);
  });
});
