// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionLifecycleView } from "./sessionLifecycle";
import {
  setSessionLifecycle,
  setSessionLifecycleList,
  useSessionLifecycleSnapshot,
  useSessionLifecycleView,
} from "./sessionLifecycleClient";

vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));

const owner = [{ userId: null, role: "owner" as const }];
const settled = (sessionId: string, settledAt = 10): SessionLifecycleView => ({
  sessionId,
  state: "settled",
  participants: owner,
  settledAt,
  settledBy: "owner",
});
const autoSettle = { afterDays: 7, archiveAfterDays: 30 };

let root: Root;
let snapshots: ReturnType<typeof useSessionLifecycleSnapshot>[];
let viewA: (SessionLifecycleView | undefined)[];
function Probe() {
  snapshots.push(useSessionLifecycleSnapshot());
  viewA.push(useSessionLifecycleView("a"));
  return null;
}
const latest = () => snapshots.at(-1)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  snapshots = [];
  viewA = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(createElement(Probe)));
}

it("keeps the snapshot when a settle response repeats the stored record", async () => {
  // The module store is shared by the file, so every case starts from a known list.
  await act(async () => setSessionLifecycleList({ records: [settled("a")], autoSettle }));
  await mount();
  const before = latest();
  const renders = snapshots.length;

  await act(async () => setSessionLifecycle(settled("a")));

  expect(latest()).toBe(before);
  expect(snapshots.length).toBe(renders);
});

it("keeps the snapshot when a list refresh repeats the same records and windows", async () => {
  await act(async () => setSessionLifecycleList({ records: [settled("a")], autoSettle }));
  await mount();
  const before = latest();
  const renders = snapshots.length;

  await act(async () =>
    setSessionLifecycleList({ records: [settled("a")], autoSettle: { ...autoSettle } }),
  );

  expect(latest()).toBe(before);
  expect(snapshots.length).toBe(renders);
});

it("keeps a session's view object when a list refresh only changes another record", async () => {
  await act(async () => setSessionLifecycleList({ records: [settled("a")], autoSettle }));
  await mount();
  const viewBefore = viewA.at(-1);

  await act(async () =>
    setSessionLifecycleList({ records: [settled("a"), settled("b", 20)], autoSettle }),
  );

  expect(viewA.at(-1)).toBe(viewBefore);
  expect(latest().views.get("b")?.settledAt).toBe(20);
});

it("publishes a settling record that becomes settled", async () => {
  await act(async () =>
    setSessionLifecycleList({
      records: [{ sessionId: "a", state: "settling", participants: owner, settleRequestedAt: 5 }],
      autoSettle,
    }),
  );
  await mount();
  const before = latest();

  await act(async () => setSessionLifecycle(settled("a")));

  expect(latest()).not.toBe(before);
  expect(latest().views.get("a")?.state).toBe("settled");
});

it("publishes when a settled session drops out of the list and turns active", async () => {
  await act(async () => setSessionLifecycleList({ records: [settled("a")], autoSettle }));
  await mount();
  const before = latest();

  await act(async () => setSessionLifecycleList({ records: [], autoSettle }));

  expect(latest()).not.toBe(before);
  expect(latest().views.get("a")?.state).toBe("active");
});

it("publishes when a record's participants change", async () => {
  await act(async () => setSessionLifecycleList({ records: [settled("a")], autoSettle }));
  await mount();
  const before = latest();

  await act(async () =>
    setSessionLifecycle({ ...settled("a"), participants: [{ userId: "u1", role: "owner" }] }),
  );

  expect(latest()).not.toBe(before);
});

it("publishes when only the auto-settle windows change", async () => {
  await act(async () => setSessionLifecycleList({ records: [settled("a")], autoSettle }));
  await mount();
  const before = latest();

  await act(async () =>
    setSessionLifecycleList({
      records: [settled("a")],
      autoSettle: { afterDays: 3, archiveAfterDays: 30 },
    }),
  );

  expect(latest()).not.toBe(before);
  expect(latest().autoSettle?.afterDays).toBe(3);
});
