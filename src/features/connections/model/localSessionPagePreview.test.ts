// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { HostSessionBinding } from "./sessionExecutionBinding";
import type { RemotePageSnapshot } from "./remotePageCache";
import { forgetDeletedRemotePage, readRemotePageCache } from "./remotePageCache";
import { prefetchLocalSessionPage, localSessionPagePreview } from "./localSessionPagePreview";

vi.mock("./remotePageCache", async (original) => {
  const cache = await original<typeof import("./remotePageCache")>();
  return {
    ...cache,
    get remotePageDeletionRevision() {
      return cache.remotePageDeletionRevision;
    },
    readRemotePageCache: vi.fn(),
  };
});
const owner: HostSessionBinding = {
  kind: "local-host",
  machineId: "local",
  projectId: "project",
  environmentId: "env",
  sessionId: "conversation",
  authorityGeneration: null,
  created: true,
};
const page = { session: { id: owner.sessionId }, projectId: owner.projectId } as RemotePageSnapshot;

it("joins the local page read and exposes its result only to the same live selection scope", async () => {
  let resolve!: (page: RemotePageSnapshot) => void;
  vi.mocked(readRemotePageCache).mockReturnValueOnce(new Promise((done) => (resolve = done)));
  let current = true;
  prefetchLocalSessionPage("shell", owner, () => current);
  prefetchLocalSessionPage("shell", owner, () => current);
  const preview = localSessionPagePreview("shell", owner)!;
  expect(vi.mocked(readRemotePageCache)).toHaveBeenCalledTimes(1);
  expect(preview.page).toBeUndefined();
  expect(localSessionPagePreview("other", owner)).toBeUndefined();
  expect(localSessionPagePreview("shell", { ...owner, authorityGeneration: 2 })).toBeUndefined();
  resolve(page);
  expect(await preview.read).toBe(page);
  expect(localSessionPagePreview("shell", owner)?.page).toBe(page);
  current = false;
  expect(localSessionPagePreview("shell", owner)).toBeUndefined();
});

it("discards a saved snapshot from a different project", async () => {
  vi.mocked(readRemotePageCache).mockResolvedValueOnce({ ...page, projectId: "other" });
  prefetchLocalSessionPage("another-shell", owner, () => true);
  expect(await localSessionPagePreview("another-shell", owner)?.read).toBeUndefined();
});

it("lets an opened pane finish its joined disk read after another row is hovered", async () => {
  let finish!: (value: RemotePageSnapshot) => void;
  vi.mocked(readRemotePageCache)
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    .mockResolvedValueOnce(undefined);
  prefetchLocalSessionPage("opened", owner, () => true);
  const joined = localSessionPagePreview("opened", owner)!.read;
  prefetchLocalSessionPage("hovered", { ...owner, sessionId: "other" }, () => true);
  finish(page);
  expect(await joined).toBe(page);
  expect(localSessionPagePreview("opened", owner)).toBeUndefined();
});

it("a confirmed deletion invalidates both a ready preview and a read still in flight", async () => {
  const remove = () =>
    forgetDeletedRemotePage(owner.environmentId, "sessions.delete", { sessionId: owner.sessionId });
  vi.mocked(readRemotePageCache).mockResolvedValueOnce(page);
  prefetchLocalSessionPage("deleted", owner, () => true);
  expect(await localSessionPagePreview("deleted", owner)?.read).toBe(page);
  remove();
  expect(localSessionPagePreview("deleted", owner)).toBeUndefined();
  let finish!: (page: RemotePageSnapshot) => void;
  vi.mocked(readRemotePageCache).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  prefetchLocalSessionPage("deleted", owner, () => true);
  const pending = localSessionPagePreview("deleted", owner)!.read;
  remove();
  finish(page);
  expect(await pending).toBeUndefined();
});
