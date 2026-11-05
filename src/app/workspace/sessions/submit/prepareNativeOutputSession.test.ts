import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../../../features/sessions/model/session";
const mocks = vi.hoisted(() => ({
  native: true,
  headless: false,
  persistable: true,
  upsert: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }));
vi.mock("../../../../integrations/harness/core/child", () => ({
  hasHeadlessChildBackend: () => mocks.headless,
}));
vi.mock("../../../../features/sessions/data/sessionStore", () => ({
  shouldPersistSession: () => mocks.persistable,
  saveSessionBeforeSend: mocks.upsert,
}));
beforeEach(() => {
  vi.resetModules();
  mocks.native = true;
  mocks.headless = false;
  mocks.persistable = true;
  mocks.upsert.mockReset();
});
async function fixture() {
  const model = await import("../../../../features/sessions/model/sessionsStore");
  const session: Session = {
    id: "native-preparation",
    cwd: "/fixture",
    harness: "antigravity",
    model: "fixture",
    title: "Fixture",
    blocks: [{ id: "user", role: "user", text: "hello" }],
  };
  model.resetSessionsStore([session]);
  const { prepareNativeOutputSession } = await import("./prepareNativeOutputSession");
  return { model, session, prepareNativeOutputSession };
}
it("waits for the actual local row-save acknowledgement before exposing a locator", async () => {
  const f = await fixture();
  let resolve!: (value: unknown) => void;
  mocks.upsert.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  let settled = false;
  const pending = f
    .prepareNativeOutputSession(f.session.id, () => true)
    .then((value) => {
      settled = true;
      return value;
    });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(mocks.upsert).toHaveBeenCalledWith(f.session);
  resolve(true);
  expect(await pending).toBe(f.session.id);
});
it("requires durable current local ownership for a Room send", async () => {
  const { requireRoomNativeOutput } = await import("./prepareNativeOutputSession");
  await expect(requireRoomNativeOutput(undefined, () => true)).rejects.toThrow(
    "local durable session owner",
  );
  await expect(
    requireRoomNativeOutput({ sessionId: "s", ready: Promise.resolve(undefined) }, () => true),
  ).rejects.toThrow("durably recorded");
  await expect(
    requireRoomNativeOutput({ sessionId: "s", ready: Promise.resolve("s") }, () => false),
  ).rejects.toThrow("Turn changed");
  await expect(
    requireRoomNativeOutput({ sessionId: "s", ready: Promise.resolve("s") }, () => true),
  ).resolves.toBeUndefined();
});
it.each(["web", "headless", "ephemeral", "remote"])(
  "preserves %s callers without creating a local row or hint",
  async (kind) => {
    const f = await fixture();
    if (kind === "web") mocks.native = false;
    if (kind === "headless") mocks.headless = true;
    if (kind === "ephemeral") mocks.persistable = false;
    if (kind === "remote") f.model.setSessions([{ ...f.session, cwd: "remote://machine/project" }]);
    expect(await f.prepareNativeOutputSession(f.session.id, () => true)).toBeUndefined();
    expect(mocks.upsert).not.toHaveBeenCalled();
  },
);
it.each([false, undefined])(
  "an unconfirmed save cannot supply a hint and does not block the turn",
  async (ack) => {
    const f = await fixture();
    mocks.upsert.mockResolvedValue(ack);
    await expect(f.prepareNativeOutputSession(f.session.id, () => true)).resolves.toBeUndefined();
  },
);
it("a retired turn cannot proceed after a late successful save", async () => {
  const f = await fixture();
  let current = true;
  let resolve!: (value: unknown) => void;
  mocks.upsert.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const pending = f.prepareNativeOutputSession(f.session.id, () => current);
  current = false;
  resolve(true);
  expect(await pending).toBeUndefined();
});
it("identical-ID model reset cannot rebind an older preparation", async () => {
  const f = await fixture();
  let resolve!: (value: unknown) => void;
  mocks.upsert.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const pending = f.prepareNativeOutputSession(f.session.id, () => true);
  f.model.resetSessionsStore([{ ...f.session }]);
  resolve(true);
  await expect(pending).resolves.toBeUndefined();
});
it("ordinary accepted edits in the same model lifetime do not block preparation", async () => {
  const f = await fixture();
  let resolve!: (value: unknown) => void;
  mocks.upsert.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const pending = f.prepareNativeOutputSession(f.session.id, () => true);
  f.model.setSessions([{ ...f.session, title: "New title" }]);
  resolve(true);
  expect(await pending).toBe(f.session.id);
});
it("starts the save without waiting so dispatch can overlap it", async () => {
  const f = await fixture();
  const { startNativeOutputSession } = await import("./prepareNativeOutputSession");
  let resolve!: (value: unknown) => void;
  mocks.upsert.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const started = startNativeOutputSession(f.session.id, () => true);
  expect(started?.sessionId).toBe(f.session.id);
  expect(mocks.upsert).toHaveBeenCalledOnce();
  resolve(true);
  expect(await started?.ready).toBe(f.session.id);
});
