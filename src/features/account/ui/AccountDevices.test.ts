// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDevices } from "./AccountDevices";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  revokeOthers: vi.fn(),
  devices: [] as object[],
}));
vi.mock("../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: mocks.confirm, dialog: null }),
}));
vi.mock("../hooks/useAccountData", () => ({
  useDevices: () => ({
    query: { data: mocks.devices, isPending: false, isError: false },
    rename: { mutateAsync: vi.fn() },
    revoke: { mutateAsync: vi.fn(), isPending: false },
    revokeOthers: { mutateAsync: mocks.revokeOthers, isPending: false },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const device = (id: string) => ({
  id,
  name: id,
  platform: "windows",
  osVersion: "11",
  appVersion: "1",
  lastSeenAt: "2026-11-08T10:00:00Z",
  revokedAt: null,
});
let root: Root;
let container: HTMLDivElement;
const bulk = () =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Sign out of all other devices",
  );
const render = async () => {
  await act(async () =>
    root.render(
      createElement(AccountDevices, { currentDeviceId: "a", onSignOutThisDevice: vi.fn() }),
    ),
  );
};

describe("AccountDevices sign out of other devices", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.confirm.mockReset();
    mocks.revokeOthers.mockReset().mockResolvedValue({ revoked: 1 });
  });
  afterEach(() => act(() => root.unmount()));

  it("is offered only with more than one device", async () => {
    mocks.devices = [device("a")];
    await render();
    expect(bulk()).toBeUndefined();
  });

  it("revokes the others after confirmation", async () => {
    mocks.devices = [device("a"), device("b")];
    mocks.confirm.mockResolvedValue(true);
    await render();
    await act(async () => bulk()!.click());
    expect(mocks.revokeOthers).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the confirmation is declined", async () => {
    mocks.devices = [device("a"), device("b")];
    mocks.confirm.mockResolvedValue(false);
    await render();
    await act(async () => bulk()!.click());
    expect(mocks.revokeOthers).not.toHaveBeenCalled();
  });
});
