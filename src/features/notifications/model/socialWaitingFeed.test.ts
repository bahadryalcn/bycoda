// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../connections/public/protocol";
import { readSocialWaiting } from "./socialWaitingFeed";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  projects: vi.fn(async () => [] as { id: string }[]),
  cwd: vi.fn(() => "/p1"),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../automations/public/hostMachines", () => ({
  machineProjects: mocks.projects,
  hostProjectCwd: mocks.cwd,
}));
vi.mock("../../social/public/waiting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../social/public/waiting")>()),
  socialClient: mocks.client,
}));

type Account = {
  id: string;
  platform: "x";
  connected: boolean;
  paused: boolean;
  connection: "api" | "browser";
  expiresAt?: number;
  grants: Record<string, string[]>;
};

const MINUTE = 60_000;
const clients = new Map<string, ReturnType<typeof fakeClient>>();
let seq = 0;

/** A Host with its own fake Social client; each test uses a fresh id, so the cache starts empty. */
function nextMachine(): RemoteMachine {
  return { id: `host-${++seq}` } as RemoteMachine;
}

function fakeClient(id: string, accounts: Account[], requests: unknown[] = []) {
  const client = {
    accountRequests: { list: vi.fn(async () => ({ items: requests })) },
    browser: { needsHuman: { list: vi.fn(async () => ({ items: [] as unknown[] })) } },
    sectionSnapshot: vi.fn(async () => ({ snapshot: { accounts } })),
  };
  clients.set(id, client);
  return client;
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-19T10:00:00Z") });
  vi.clearAllMocks();
  mocks.projects.mockResolvedValue([]);
  mocks.client.mockImplementation((id: string) => clients.get(id));
});

afterEach(() => {
  vi.useRealTimers();
});

it("reuses a quiet accounts snapshot and skips the project read while nothing waits", async () => {
  const machine = nextMachine();
  const client = fakeClient(machine.id, []);
  expect(await readSocialWaiting(machine)).toEqual([]);
  expect(await readSocialWaiting(machine)).toEqual([]);
  expect(client.sectionSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.projects).not.toHaveBeenCalled();
});

it("reads the accounts snapshot again once it is older than the TTL", async () => {
  const machine = nextMachine();
  const client = fakeClient(machine.id, []);
  await readSocialWaiting(machine);
  vi.advanceTimersByTime(5 * MINUTE + 1);
  await readSocialWaiting(machine);
  expect(client.sectionSnapshot).toHaveBeenCalledTimes(2);
});

it("reads fresh inside the TTL when an account expiry is near", async () => {
  const machine = nextMachine();
  const expiresAt = Date.now() + MINUTE;
  const client = fakeClient(machine.id, [
    {
      id: "a",
      platform: "x",
      connected: true,
      paused: false,
      connection: "api",
      expiresAt,
      grants: {},
    },
  ]);
  await readSocialWaiting(machine);
  vi.advanceTimersByTime(MINUTE);
  await readSocialWaiting(machine);
  expect(client.sectionSnapshot).toHaveBeenCalledTimes(2);
});

it("still counts a sign-in that is due, with the project read it needs", async () => {
  const machine = nextMachine();
  const expiresAt = Date.now() - 1_000;
  fakeClient(machine.id, [
    {
      id: "a",
      platform: "x",
      connected: true,
      paused: false,
      connection: "browser",
      expiresAt,
      grants: {},
    },
  ]);
  const items = await readSocialWaiting(machine);
  expect(items?.map((item) => item.id)).toEqual([`signin:a:${expiresAt}`]);
  expect(mocks.projects).toHaveBeenCalledOnce();
});

it("still reports a pending account request with its project path", async () => {
  const machine = nextMachine();
  mocks.projects.mockResolvedValue([{ id: "p1" }]);
  fakeClient(
    machine.id,
    [],
    [{ id: "r1", status: "pending", projectId: "p1", platform: "x", createdAt: 5 }],
  );
  const items = await readSocialWaiting(machine);
  expect(items).toEqual([
    { id: "request:r1", kind: "accountRequest", platform: "x", paths: ["/p1"], at: 5 },
  ]);
  expect(mocks.projects).toHaveBeenCalledOnce();
});

it("never shares one Host's accounts snapshot with another Host", async () => {
  const first = nextMachine();
  const second = nextMachine();
  const firstClient = fakeClient(first.id, []);
  const secondClient = fakeClient(second.id, []);
  await readSocialWaiting(first);
  await readSocialWaiting(second);
  expect(firstClient.sectionSnapshot).toHaveBeenCalledOnce();
  expect(secondClient.sectionSnapshot).toHaveBeenCalledOnce();
});

it("does not cache a failed accounts read", async () => {
  const machine = nextMachine();
  const client = fakeClient(machine.id, []);
  client.sectionSnapshot.mockRejectedValueOnce(new Error("offline"));
  await readSocialWaiting(machine);
  await readSocialWaiting(machine);
  expect(client.sectionSnapshot).toHaveBeenCalledTimes(2);
});
