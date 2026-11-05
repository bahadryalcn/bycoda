// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mock.invoke }));
vi.mock("../../group-lock/model/roomPrivacyScope", () => ({
  readRoomPrivacyScope: () => ({ stableStorageKeys: {} }),
}));

it("does not evict a recent project before native privacy drain", async () => {
  localStorage.clear();
  mock.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_read"
      ? Promise.resolve(null)
      : Promise.resolve({ revision: 1 }),
  );
  const policy = await import("../../group-lock/model/roomPrivacyProjection");
  policy.activateRoomPrivacyProjection();
  await vi.waitFor(() => expect(policy.getRoomPrivacyStatus().pending).toBe(false));
  const previous = Array.from({ length: 200 }, (_, i) => ({ path: `/project-${i}`, openedAt: i }));
  localStorage.setItem("bycoda.recentProjects", JSON.stringify(previous));
  let release!: () => void;
  const drained = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.invoke.mockImplementation((command: string) =>
    command === "control_privacy_projection_begin" ? drained : Promise.resolve({ revision: 2 }),
  );
  const { rememberProject, loadRecents } = await import("./recents");
  const work = rememberProject("/new");
  await vi.waitFor(() =>
    expect(mock.invoke).toHaveBeenCalledWith("control_privacy_projection_begin", expect.anything()),
  );
  expect(loadRecents()).toEqual(previous);
  release();
  await work;
  expect(loadRecents()).toHaveLength(200);
  expect(loadRecents()[0].path).toBe("/new");
  expect(loadRecents().some((item) => item.path === "/project-199")).toBe(false);
});
