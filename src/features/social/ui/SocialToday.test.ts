// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialJob, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { SocialToday } from "./SocialToday";

const Component = withQueryClient(SocialToday);
let element: HTMLDivElement, root: Root;
const sectionSnapshot = vi.fn();
const request = vi.fn();
const onNavigate = vi.fn();
const client = { sectionSnapshot, request } as unknown as SocialClient;
const snapshot = (patch: Partial<SocialSnapshot> = {}): SocialSnapshot => ({
  executorId: "host",
  hostOnline: true,
  sendingEnabled: true,
  stopped: false,
  pollingEnabled: false,
  accounts: [
    {
      id: "a",
      platform: "x",
      platformId: "1",
      name: "Brand X",
      accountType: "member",
      scopes: [],
      accessApproved: true,
      connected: true,
      paused: false,
      executorId: "host",
      grants: { p: ["read", "draft"] },
      createdAt: 1,
    },
  ],
  campaigns: [],
  contacts: [],
  threads: [],
  segments: [],
  rules: [],
  jobs: [],
  drafts: [],
  profiles: [],
  capabilities: {},
  ...patch,
});
const failedJob = (id: string): SocialJob => ({
  id,
  operationId: id,
  dedupeKey: id,
  accountId: "a",
  projectIds: ["p"],
  provider: "owner",
  kind: "publish",
  payload: { text: "Launch post", media: [] },
  status: "failed",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
  actorId: "owner",
  error: "Rate limited",
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sectionSnapshot.mockReset();
  request.mockReset();
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

async function mount() {
  await act(async () =>
    root.render(
      createElement(Component, {
        client,
        snapshot: snapshot(),
        projects: [{ id: "p", cwd: "/p", name: "Project" }],
        projectFilter: "",
        machineLabel: "This computer",
        run: vi.fn(async () => true),
        onNavigate,
        onOpenProgram: vi.fn(),
      }),
    ),
  );
  await act(async () => undefined);
}

it("shows real failures with the reason and opens Activity", async () => {
  sectionSnapshot.mockImplementation(async (input: { section: string }) => ({
    cursor: "",
    unchanged: false,
    snapshot:
      input.section === "history"
        ? snapshot({ jobs: [failedJob("1"), failedJob("2")], jobCounts: { failed: 2 } })
        : snapshot(),
  }));
  await mount();
  expect(element.textContent).toContain("2 sends need your attention");
  expect(element.textContent).toContain("Rate limited ×2");
  const open = [...element.querySelectorAll("button")].find(
    (item) => item.textContent === "Review",
  )!;
  await act(async () => open.click());
  expect(onNavigate).toHaveBeenCalledWith("Activity");
});

it("names a failed read instead of reporting that nothing needs attention", async () => {
  sectionSnapshot.mockImplementation(async (input: { section: string }) => {
    if (input.section === "history") throw new Error("Host unreachable");
    return { cursor: "", unchanged: false, snapshot: snapshot() };
  });
  await mount();
  expect(element.textContent).toContain("Some data could not be read");
  expect(element.textContent).toContain("Host unreachable");
  expect(element.textContent).not.toContain("Nothing needs your attention");
});

it("says nothing needs attention only after every read succeeded", async () => {
  sectionSnapshot.mockImplementation(async () => ({
    cursor: "",
    unchanged: false,
    snapshot: snapshot(),
  }));
  await mount();
  expect(element.textContent).toContain(
    "Nothing needs your attention in the data read from This computer.",
  );
  expect(element.textContent).toContain("No posts or plans are scheduled.");
});
