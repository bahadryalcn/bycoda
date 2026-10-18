// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../shared/hooks/useRetainedState";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "../../platform/tauri/fs";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
import { registerLogsComposer } from "./logsComposer";
import { RuntimeLogsPanel } from "./RuntimeLogsPanel";
import type { RuntimeLogEntry, RuntimeLogSnapshot } from "./runtimeLogTypes";
import type { HostToolTarget } from "../connections/model/hostToolTarget";
import type { OpenFileFn } from "../search/model/search";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform/tauri/fs")>()),
  writeTextFile: vi.fn(),
}));
vi.mock("../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform/tauri/platform")>()),
  IS_WIN: false,
}));
vi.mock("../connections/model/hostFeatureClient", () => ({
  hostToolRequest: vi.fn(),
  hostFeatureRequest: vi.fn(),
}));
vi.mock("../../shared/i18n/technical", () => ({
  getLocale: () => "en",
  useLocale: vi.fn(),
  t: (message: string, values?: Record<string, unknown>) =>
    message.replace(/\{([^}]+)\}/g, (token, name: string) =>
      values?.[name] === undefined ? token : String(values[name]),
    ),
}));

let root: Root;
let container: HTMLDivElement;
const base: RuntimeLogEntry = {
  id: "1",
  cursor: 1,
  timestamp: 1_750_000_000_000,
  sourceId: "browser-one",
  source: "browser",
  level: "error",
  message: "Failed to fetch account",
  stack: "Error: fetch\n  at loadAccount (src/account.ts:8:2)",
  location: { file: "src/account.ts", line: 8, column: 2 },
};
const browser = { id: "browser-one", kind: "browser" as const, label: "Preview", available: true };
const server = { id: "server-one", kind: "server" as const, label: "Vite", available: true };
const external = {
  id: "external",
  kind: "server" as const,
  label: "External node",
  available: false,
  reason: "Start through Servers to capture output.",
};
const entries: RuntimeLogEntry[] = [
  base,
  { ...base, id: "2", cursor: 2, timestamp: base.timestamp + 1000 },
  {
    ...base,
    id: "3",
    cursor: 3,
    level: "info",
    message: "Account response",
    details: { payload: { answer: 42 } },
    stack: undefined,
    location: undefined,
  },
  {
    ...base,
    id: "4",
    cursor: 4,
    source: "server",
    sourceId: "server-one",
    level: "warn",
    message: "Cache miss",
    stack: undefined,
    location: undefined,
  },
];
const result = (events = entries, cursor = 4): RuntimeLogSnapshot => ({
  entries: events,
  cursor,
  dropped: 0,
  sources: [browser, server, external],
});
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label || node.getAttribute("aria-label") === label,
  )!;
const rows = () => [...container.querySelectorAll<HTMLElement>(".runtime-log-row")];
// Groups are ordered by their latest occurrence, so find rows by content.
const rowIndex = (text: string) => rows().findIndex((row) => row.textContent?.includes(text));
const mount = async (
  props: { target?: HostToolTarget; onOpenFile?: OpenFileFn } = {},
  start = true,
) => {
  await act(async () =>
    root.render(
      createElement(RuntimeLogsPanel, {
        cwd: "/repo",
        sessionId: "host-session",
        composerSessionId: "composer-session",
        ...props,
      }),
    ),
  );
  if (start && button("Read logs")) await act(async () => button("Read logs").click());
};
const edit = (label: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const expand = async (index = 0) => {
  const details = rows()[index].querySelector<HTMLDetailsElement>("details")!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
};

beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.useFakeTimers();
  vi.mocked(hostToolRequest)
    .mockReset()
    .mockImplementation(async (_cwd, _capability, _method, params) =>
      result(params?.after ? [] : entries),
    );
  vi.mocked(hostFeatureRequest).mockReset().mockResolvedValue([]);
  vi.mocked(save).mockReset().mockResolvedValue(null);
  vi.mocked(writeTextFile).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("restores log view filters on remount and keeps a different machine's view independent", async () => {
  await mount();
  await act(async () => edit("Search logs", "failure"));
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Search logs"]')!.value).toBe(
    "failure",
  );
  await mount({ target: { kind: "machine", machineId: "other" } });
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Search logs"]')!.value).toBe(
    "",
  );
  await mount();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Search logs"]')!.value).toBe(
    "failure",
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("pauses hidden-page reads and catches up from the retained cursor without changing owner pause", async () => {
  await mount();
  const hidden = vi.spyOn(document, "hidden", "get");
  hidden.mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(hostToolRequest).toHaveBeenCalledOnce();
  expect(rows()).toHaveLength(3);
  expect(button("Pause")).toBeDefined();
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(hostToolRequest).mock.calls.at(-1)?.[3]).toEqual({ after: 4, limit: 1_000 });
  await act(async () => button("Pause").click());
  hidden.mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
  expect(button("Resume")).toBeDefined();
});

it("keeps automatic refresh out of the user-action busy indicator", async () => {
  await mount();
  let finish!: (value: RuntimeLogSnapshot) => void;
  vi.mocked(hostToolRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
  expect(button("Refresh").disabled).toBe(false);
  expect(rows()).toHaveLength(3);
  await act(async () => finish(result([], 4)));
});

it("sends the retained stream generation and replaces equal-cursor history after restart", async () => {
  vi.mocked(hostToolRequest).mockResolvedValueOnce({ ...result(entries, 4), streamId: "old" });
  await mount({}, false);
  vi.mocked(hostToolRequest).mockResolvedValueOnce({
    ...result([{ ...base, id: "fresh-event", cursor: 4, message: "Fresh host" }], 4),
    streamId: "new",
  });
  await act(async () => button("Refresh").click());
  expect(vi.mocked(hostToolRequest).mock.calls.at(-1)?.[3]).toEqual({
    after: 4,
    streamId: "old",
    limit: 1_000,
  });
  expect(container.textContent).toContain("Fresh host");
  expect(container.textContent).not.toContain("Failed to fetch account");
});

it("starts live reads on mount and exposes capture and compact filters without opening a browser", async () => {
  await mount({}, false);
  expect(hostToolRequest).toHaveBeenCalledWith(
    "/repo",
    "runtime.logs",
    "runtimeLogs.read",
    { limit: 1_000 },
    { kind: "project" },
  );
  expect(container.textContent).toContain("Live");
  expect(container.querySelector(".runtime-logs-monitor-setup")!.tagName).toBe("SECTION");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector(".runtime-logs-options")).toBeNull();
  await act(async () => button("Filters").click());
  expect(document.querySelector('[role="dialog"][aria-label="Log filters"]')).not.toBeNull();
  expect(document.querySelector('button[aria-label="Log level: All levels"]')).not.toBeNull();
  await act(async () => button("Filters").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/repo",
    "runtime.logs.monitors",
    "runtimeLogs.monitors.list",
  );
  expect(
    vi
      .mocked(hostFeatureRequest)
      .mock.calls.every((call) => call[2] === "runtimeLogs.monitors.list"),
  ).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
});

it("stops automatic retries after a missing session or disconnected host error", async () => {
  vi.mocked(hostToolRequest).mockRejectedValueOnce(new Error("Session not found on this machine"));
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(hostToolRequest).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Disconnected");
  await act(async () => button("Resume").click());
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
});

it("explains an unavailable website while retaining technical details and the entered URL", async () => {
  await mount({}, false);
  vi.mocked(hostFeatureRequest).mockRejectedValueOnce(
    new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/"),
  );
  const input = container.querySelector<HTMLInputElement>(".runtime-logs-monitor-setup input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "3000");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.querySelector('[role="alert"] p')?.textContent).toBe(
    "Website is not running. Start it in Development servers, then try again.",
  );
  expect(container.querySelector('[role="alert"] pre')?.textContent).toContain(
    "ERR_CONNECTION_REFUSED",
  );
  expect(container.querySelector<HTMLDetailsElement>('[role="alert"] details')?.open).toBe(false);
  expect(input.value).toBe("3000");
  expect(hostToolRequest).toHaveBeenCalledOnce();
});

it("starts independent URL monitors explicitly and displays their target and stop action", async () => {
  await mount({}, false);
  vi.mocked(hostFeatureRequest)
    .mockResolvedValueOnce({ id: "watch", url: "http://localhost:5173/" })
    .mockResolvedValueOnce([
      { id: "watch", url: "http://localhost:5173/", sourceId: "browser-one" },
    ]);
  const input = container.querySelector<HTMLInputElement>(".runtime-logs-monitor-setup input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "5173");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/repo",
    "runtime.logs.monitors",
    "runtimeLogs.monitors.start",
    { url: "5173" },
  );
  expect(container.textContent).toContain("http://localhost:5173/");
  expect(
    container.querySelector('button[aria-label="Filters"]')?.getAttribute("data-selected"),
  ).not.toBe("true");
  expect(rows().some((row) => row.textContent?.includes("Cache miss"))).toBe(true);
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".runtime-logs-monitor-name")!.click(),
  );
  await act(async () => button("Filters").click());
  expect(
    document.querySelector('button[aria-label^="Log source:"]')?.getAttribute("aria-label"),
  ).toBe("Log source: Preview");
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({ stopped: true }).mockResolvedValueOnce([]);
  await act(async () => button("Stop monitor").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/repo",
    "runtime.logs.monitors",
    "runtimeLogs.monitors.stop",
    { id: "watch" },
  );
});

it("filters the unified retained timeline without sending view filters to cursor reads", async () => {
  await mount();
  expect(rows()).toHaveLength(3);
  expect(container.querySelector(".runtime-log-count")?.textContent).toBe("×2");
  await act(async () => button("Filters").click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((node) => node.textContent?.includes("Server"))!
      .click(),
  );
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain("Cache miss");
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((node) => node.textContent?.startsWith("All"))!
      .click(),
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Log level: All levels"]')!
      .click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((node) => node.textContent === "INFO")!
      .click(),
  );
  await act(async () => {
    edit("Search logs", "42");
  });
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain("Account response");
  expect(hostToolRequest).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(vi.mocked(hostToolRequest).mock.calls.at(-1)).toEqual([
    "/repo",
    "runtime.logs",
    "runtimeLogs.read",
    { after: 4, limit: 1_000 },
    { kind: "project" },
  ]);
});

it("adds selected grouped errors as an untrusted draft only after an explicit click", async () => {
  const receive = vi.fn((_text: string) => true);
  const stop = registerLogsComposer("/repo", "composer-session", receive);
  try {
    await mount();
    expect(receive).not.toHaveBeenCalled();
    await act(async () =>
      rows()
        [rowIndex("Failed to fetch account")].querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        )!
        .click(),
    );
    expect(container.textContent).toContain("2 selected logs");
    await act(async () => button("Add to conversation").click());
    expect(receive).toHaveBeenCalledOnce();
    const draft = receive.mock.calls[0][0];
    const payload = JSON.parse(draft.slice(draft.indexOf("{")));
    expect(payload.trust).toBe("untrusted-runtime-log-data");
    expect(payload.entries).toHaveLength(2);
    expect(payload.workspace).toBe("/repo");
    expect(container.textContent).toContain(
      "Logs added to conversation draft. Review and send when ready.",
    );
    expect(
      vi.mocked(hostToolRequest).mock.calls.every((call) => call[2] === "runtimeLogs.read"),
    ).toBe(true);
  } finally {
    stop();
  }
});

it("retains the clear watermark through replayed host history and shows only new events", async () => {
  await mount();
  await act(async () => button("Clear view").click());
  expect(rows()).toHaveLength(0);
  vi.mocked(hostToolRequest).mockResolvedValueOnce(
    result([...entries, { ...base, id: "5", cursor: 5, message: "New event after clear" }], 5),
  );
  await act(async () => button("Refresh").click());
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain("New event after clear");
  expect(container.textContent).not.toContain("Failed to fetch account");
});

it("serializes polling and discards a late response from a previously selected computer", async () => {
  let release!: (value: RuntimeLogSnapshot) => void;
  vi.mocked(hostToolRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(9_000));
  expect(hostToolRequest).toHaveBeenCalledOnce();
  expect(button("Refresh").disabled).toBe(true);
  vi.mocked(hostToolRequest).mockResolvedValueOnce(
    result([{ ...base, message: "New computer event" }], 1),
  );
  await mount({ target: { kind: "machine", machineId: "macbook" } });
  await act(async () => release(result([{ ...base, message: "Late old computer event" }])));
  expect(container.textContent).toContain("New computer event");
  expect(container.textContent).not.toContain("Late old computer event");
  expect(vi.mocked(hostToolRequest).mock.calls[1][4]).toEqual({
    kind: "machine",
    machineId: "macbook",
  });
  await act(async () => root.unmount());
  await act(async () => vi.advanceTimersByTimeAsync(9_000));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
});

it("keeps pause stable during an in-flight read and resumes from the last accepted cursor", async () => {
  await mount();
  let release!: (value: RuntimeLogSnapshot) => void;
  vi.mocked(hostToolRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  await act(async () => button("Pause").click());
  const fresh = { ...base, id: "5", cursor: 5, message: "Paused in-flight event" };
  await act(async () => release(result([fresh], 5)));
  expect(container.textContent).not.toContain("Paused in-flight event");
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
  vi.mocked(hostToolRequest).mockResolvedValueOnce(result([fresh], 5));
  await act(async () => button("Resume").click());
  expect(container.textContent).toContain("Paused in-flight event");
  expect(vi.mocked(hostToolRequest).mock.calls[2][3]).toMatchObject({ after: 4 });
});

it("keeps retained logs readable when the host disconnects and recovers with Refresh", async () => {
  await mount();
  vi.mocked(hostToolRequest).mockRejectedValueOnce(new Error("Host is offline"));
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(container.textContent).toContain("Disconnected");
  expect(container.querySelector('[role="alert"] p')?.textContent).toBe(
    "Could not read logs. Check the host connection and retry.",
  );
  expect(container.querySelector('[role="alert"] pre')?.textContent).toBe("Host is offline");
  expect(container.querySelector<HTMLDetailsElement>('[role="alert"] details')?.open).toBe(false);
  expect(rows()).toHaveLength(3);
  await act(async () => button("Refresh").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Paused");
});

it("opens a source line through the existing editor callback only for the project host", async () => {
  const openFile = vi.fn();
  await mount({ onOpenFile: openFile });
  await expand(rowIndex("Failed to fetch account"));
  const jump = button("src/account.ts:8:2");
  expect(jump).toBeDefined();
  await act(async () => jump.click());
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/repo/src/account.ts", { line: 8, column: 2 });
  await mount({ target: { kind: "machine", machineId: "other" }, onOpenFile: openFile });
  await expand(rowIndex("Failed to fetch account"));
  expect(button("src/account.ts:8:2")).toBeUndefined();
  expect(container.querySelector(".runtime-log-location")?.textContent).toBe("src/account.ts:8:2");
});

it("expands structured objects and stack traces without treating values as markup", async () => {
  vi.mocked(hostToolRequest).mockResolvedValueOnce(
    result(
      [{ ...base, details: { nested: { html: "<script>attack()</script>", answer: 42 } } }],
      1,
    ),
  );
  await mount();
  await expand();
  expect(container.querySelector(".runtime-log-detail-body")?.textContent).toContain(
    "<script>attack()</script>",
  );
  expect(container.querySelector(".runtime-log-detail-body")?.textContent).toContain("Stack trace");
  expect(container.querySelector("script")).toBeNull();
});

it("exports the selected events through a save dialog and does not write when canceled", async () => {
  await mount();
  await act(async () => button("Export logs").click());
  expect(save).toHaveBeenCalledOnce();
  expect(writeTextFile).not.toHaveBeenCalled();
  await act(async () =>
    rows()
      [rowIndex("Cache miss")].querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  vi.mocked(save).mockResolvedValueOnce("/logs/runtime.jsonl");
  await act(async () => button("Export logs").click());
  const [path, content] = vi.mocked(writeTextFile).mock.calls[0];
  expect(path).toBe("/logs/runtime.jsonl");
  const records = content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records).toHaveLength(2);
  expect(records[0].sources.map((value: { id: string }) => value.id)).toEqual(["server-one"]);
  expect(records[1]).toMatchObject({ source: "server", message: "Cache miss" });
});

it("appends live events from the cursor and stops reading while paused", async () => {
  await mount();
  const fresh = { ...base, id: "5", cursor: 5, level: "info" as const, message: "Live event" };
  vi.mocked(hostToolRequest).mockResolvedValueOnce(result([fresh], 5));
  await act(async () => vi.advanceTimersByTimeAsync(1_500));
  expect(container.textContent).toContain("Live event");
  expect(vi.mocked(hostToolRequest).mock.calls.at(-1)?.[3]).toEqual({ after: 4, limit: 1_000 });
  await act(async () => button("Pause").click());
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(hostToolRequest).toHaveBeenCalledTimes(2);
});

it("loads existing monitors and ignores a late inventory after a new capture starts", async () => {
  let release!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await mount();
  vi.mocked(hostFeatureRequest)
    .mockResolvedValueOnce({ id: "new" })
    .mockResolvedValueOnce([{ id: "new", url: "http://localhost:3000/", sourceId: "browser-one" }]);
  await act(async () => edit("Website port or URL", "3000"));
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await act(async () => release([]));
  expect(container.textContent).toContain("http://localhost:3000/");
  expect(button("Stop monitor")).toBeDefined();
});
