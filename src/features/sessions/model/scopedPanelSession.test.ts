import { expect, it, vi } from "vitest";
import type { Session } from "./session";
import { openPanelSession } from "./scopedPanelSession";

const scope = { key: "social:host:project", cwd: "/project", title: "Social Media" };
function setup() {
  const session = {
    id: "s1",
    cwd: "/project",
    busy: true,
    blocks: [{ id: "draft", role: "user", text: "Keep this draft" }],
  } as unknown as Session;
  const dependencies = {
    read: vi.fn((): string | null => null),
    write: vi.fn(),
    find: vi.fn((): Session | undefined => undefined),
    load: vi.fn(async (): Promise<Session | null> => null),
    create: vi.fn(async () => session),
    attach: vi.fn(),
  };
  return { session, dependencies };
}
it("reopens the running session without replacing its draft or creating another conversation", async () => {
  const { session, dependencies } = setup();
  dependencies.read.mockReturnValue(session.id);
  dependencies.find.mockReturnValue(session);
  expect(await openPanelSession(scope, dependencies)).toBe(session.id);
  expect(dependencies.create).not.toHaveBeenCalled();
  expect(dependencies.attach).toHaveBeenCalledWith(session);
  expect(session.blocks[0]?.text).toBe("Keep this draft");
});
it("deduplicates concurrent opens while persistence is loading", async () => {
  const { dependencies } = setup();
  const [first, second] = await Promise.all([
    openPanelSession(scope, dependencies),
    openPanelSession(scope, dependencies),
  ]);
  expect(first).toBe(second);
  expect(dependencies.create).toHaveBeenCalledTimes(1);
});
it("does not attach a conversation from another project", async () => {
  const { dependencies, session } = setup();
  dependencies.read.mockReturnValue("other");
  dependencies.load.mockResolvedValue({ ...session, id: "other", cwd: "/private" });
  await openPanelSession(scope, dependencies);
  expect(dependencies.create).toHaveBeenCalledTimes(1);
  expect(dependencies.attach).toHaveBeenCalledWith(session);
});
it("retains the stored identity when hydration fails instead of creating an empty replacement", async () => {
  const { dependencies } = setup();
  dependencies.read.mockReturnValue("existing");
  dependencies.load.mockRejectedValue(new Error("Host offline"));
  await expect(openPanelSession(scope, dependencies)).rejects.toThrow("Host offline");
  expect(dependencies.create).not.toHaveBeenCalled();
  expect(dependencies.write).not.toHaveBeenCalled();
});
