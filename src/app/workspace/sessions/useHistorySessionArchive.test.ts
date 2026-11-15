// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../../features/sessions/data/sessionStore";
import {
  useHistorySessionArchive,
  type HistorySessionArchiveDeps,
} from "./useHistorySessionArchive";

const { archive, message } = vi.hoisted(() => ({ archive: vi.fn(), message: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({ setSessionArchived: archive }));
vi.mock("../../../shared/ui/ToastRegion", () => ({ toast: { show: message } }));

let root: Root;
let deps: HistorySessionArchiveDeps;
let result: ReturnType<typeof useHistorySessionArchive>;
let history: SessionSummary[];
const ref = <T>(current: T) => ({ current });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  archive.mockReset();
  message.mockReset().mockResolvedValue(undefined);
  history = [{ id: "session", archived: true } as SessionSummary];
  deps = {
    onRemoveHistorySession: vi.fn(async () => false),
    removingSessionIds: ref(new Set()),
    setHistory: (update) => {
      history = typeof update === "function" ? update(history) : update;
    },
    sessionsRef: ref([]),
    activeTabIdRef: ref("tab"),
    tabsRef: ref([]),
    projectTerminalFocusedRef: ref(false),
    searchViewOpenRef: ref(false),
    inboxViewOpenRef: ref(false),
    notesViewOpenRef: ref(false),
    automationsViewOpenRef: ref(false),
    settingsOpenRef: ref(false),
    filePickerOpenRef: ref(false),
    whatsNewVersionRef: ref(null),
  };
  function Probe() {
    result = useHistorySessionArchive(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("claims the shared lifecycle slot until restore completes and rejects a duplicate", async () => {
  let finish!: () => void;
  archive.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = result.onArchiveHistorySession("session", false);
  expect(deps.removingSessionIds.current.has("session")).toBe(true);
  expect(await result.onArchiveHistorySession("session", false)).toBe(false);
  expect(archive).toHaveBeenCalledExactlyOnceWith("session", false);
  expect(history[0].archived).toBe(true);
  finish();
  expect(await first).toBe(true);
  expect(history[0].archived).toBe(false);
  expect(deps.removingSessionIds.current.has("session")).toBe(false);
});

it("releases a failed restore for retry without altering other lifecycle slots", async () => {
  let fail!: (reason: Error) => void;
  archive.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  deps.removingSessionIds.current.add("other");
  const first = result.onArchiveHistorySession("session", false);
  expect(deps.removingSessionIds.current.has("session")).toBe(true);
  fail(new Error("Restore unavailable"));
  expect(await first).toBe(false);
  expect(history[0].archived).toBe(true);
  expect([...deps.removingSessionIds.current]).toEqual(["other"]);
  expect(message).toHaveBeenCalledOnce();
  archive.mockResolvedValueOnce(undefined);
  expect(await result.onArchiveHistorySession("session", false)).toBe(true);
  expect(history[0].archived).toBe(false);
  expect([...deps.removingSessionIds.current]).toEqual(["other"]);
});

it("leaves an existing removal owner untouched and performs no restore", async () => {
  deps.removingSessionIds.current.add("session");
  expect(await result.onArchiveHistorySession("session", false)).toBe(false);
  expect(archive).not.toHaveBeenCalled();
  expect(deps.removingSessionIds.current.has("session")).toBe(true);
  expect(history[0].archived).toBe(true);
});
