import { afterEach, expect, it, vi } from "vitest";
import {
  EXITED_TERMINAL_GRACE_MS,
  HostTerminals,
  TERMINAL_CREATION_RECEIPT_TTL_MS,
} from "./terminals";

const services: HostTerminals[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(async (service) => await service.close()));
});
const project = { id: "project", cwd: "/project" };

/** Terminals over an injected monotonic clock; every launch owns its own exit callback. */
function setup() {
  let now = 1_000;
  const exits = new Map<string, (code: number | null) => void>();
  let sequence = 0;
  const launch = vi.fn((_profile, _cwd, _onOutput, onExit) => {
    const key = `child-${++sequence}`;
    exits.set(key, onExit);
    return { write: vi.fn(async () => {}), stop: vi.fn(async () => exits.get(key)?.(0)) };
  });
  const service = new HostTerminals(
    launch,
    () => ({
      profiles: [{ id: "shell", name: "Shell", path: "/shell", kind: "sh" }],
      defaultId: "shell",
      chosenId: null,
    }),
    async (root: string) => root,
    () => now,
  );
  services.push(service);
  return {
    service,
    launch,
    advance: (ms: number) => {
      now += ms;
    },
    exitAll: () => {
      for (const exit of exits.values()) exit(0);
    },
    create: (requestId: string, params: Record<string, unknown> = {}) =>
      service.create(project, { requestId, ...params }, "owner", () => true),
  };
}

it("returns the same settled result for a receipt inside the TTL and evicts it only after", async () => {
  const s = setup();
  const first = await s.create("receipt-01", { name: "Build" });
  s.advance(TERMINAL_CREATION_RECEIPT_TTL_MS - 1);
  expect((await s.create("receipt-01", { name: "Build" })).id).toBe(first.id);
  await expect(s.create("receipt-01", { name: "Other" })).rejects.toThrow("different options");
  expect(s.launch).toHaveBeenCalledTimes(1);
  s.advance(1);
  // Past the TTL the receipt is gone: the same requestId with other options is a new request.
  const fresh = await s.create("receipt-01", { name: "Other" });
  expect(fresh.id).not.toBe(first.id);
  expect(s.launch).toHaveBeenCalledTimes(2);
});

it("keeps a pending receipt beyond the TTL until it settles", async () => {
  const s = setup();
  let finish!: () => void;
  s.service.setActivityGate(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(async () => {});
      }),
  );
  const pending = s.create("pending-01");
  await vi.waitFor(() => expect(finish).toBeDefined());
  s.advance(TERMINAL_CREATION_RECEIPT_TTL_MS * 2);
  const retry = s.create("pending-01");
  finish();
  expect((await retry).id).toBe((await pending).id);
  expect(s.launch).toHaveBeenCalledTimes(1);
});

it("drops the receipt of a creation that failed before any process was spawned", async () => {
  const s = setup();
  await expect(
    s.service.create(project, { requestId: "denied-01" }, "owner", () => false),
  ).rejects.toThrow("revoked");
  expect(s.launch).not.toHaveBeenCalled();
  // Nothing was mutated, so the same requestId may retry at once with any options.
  const terminal = await s.service.create(
    project,
    { requestId: "denied-01", name: "Retry" },
    "owner",
    () => true,
  );
  expect(terminal.state).toBe("running");
  expect(s.launch).toHaveBeenCalledTimes(1);
});

it("counts only running terminals against the cap and reaps exited ones after the grace period", async () => {
  const s = setup();
  const terminals = await Promise.all(
    Array.from({ length: 32 }, (_, index) => s.create(`cap-${String(index).padStart(2, "0")}`)),
  );
  await expect(s.create("cap-overflow")).rejects.toThrow("Close a terminal");
  s.exitAll();
  const extra = await s.create("cap-extra");
  expect(extra.state).toBe("running");
  // Exited terminals stay listed and readable during the grace period.
  expect(s.service.list(project.id).terminals).toHaveLength(33);
  expect(s.service.read(project.id, { id: terminals[0].id }).terminal.state).toBe("exited");
  s.advance(EXITED_TERMINAL_GRACE_MS);
  const listed = s.service.list(project.id).terminals;
  expect(listed).toHaveLength(1);
  expect(listed[0].id).toBe(extra.id);
  expect(() => s.service.read(project.id, { id: terminals[0].id })).toThrow("unavailable");
  // The exited terminal's receipt remains a valid idempotency fence within its TTL.
  expect((await s.create("cap-00")).id).toBe(terminals[0].id);
});

it("does not count creations that exceeded the 256 receipt cap once their receipts expired", async () => {
  const s = setup();
  for (let index = 0; index < 256; index++) {
    const terminal = await s.create(`many-${index}`);
    await s.service.remove(project.id, terminal.id);
  }
  await expect(s.create("many-overflow")).rejects.toThrow("creation limit");
  s.advance(TERMINAL_CREATION_RECEIPT_TTL_MS);
  expect((await s.create("many-overflow")).state).toBe("running");
});
