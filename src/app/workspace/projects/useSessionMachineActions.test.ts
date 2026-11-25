// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PROJECTLESS_SESSIONS_CAPABILITY } from "../../../shared/model/host-contracts/projectless-sessions";
import { newDefaultSession } from "../../../features/sessions/model/session";
import {
  getSessions,
  resetSessionsStore,
  sessionsRef,
} from "../../../features/sessions/model/sessionsStore";
import { useSessionMachineActions } from "./useSessionMachineActions";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), outbox: vi.fn(), toast: vi.fn() }));
vi.mock("../../../features/connections/model/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/connections/model/connections")>()),
  loadRemoteCapabilities: mocks.preview,
}));
vi.mock("../../../features/connections/model/remoteOutbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/connections/model/remoteOutbox")>()),
  readDurableRemoteCommand: mocks.outbox,
}));
vi.mock("../../../features/group-lock/model/roomPrivacyProjection", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../features/group-lock/model/roomPrivacyProjection")
  >()),
  withRoomPrivacyMutation: async (run: () => void) => run(),
}));
vi.mock("../../../shared/ui/ToastRegion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/ToastRegion")>()),
  toast: { show: mocks.toast },
}));

let root: Root;
let choose: ReturnType<typeof useSessionMachineActions>;
const capabilities = [PROJECTLESS_SESSIONS_CAPABILITY];
const onCwdChange = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionsStore([newDefaultSession("~")]);
  root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      createElement(function Fixture() {
        choose = useSessionMachineActions({ sessionsRef, onCwdChange });
        return null;
      }),
    ),
  );
});

afterEach(() => act(() => root.unmount()));

it("keeps the latest machine choice when an older Host lookup finishes late", async () => {
  let resolveOffice!: (value: string[]) => void;
  mocks.preview.mockImplementation((environmentId: string) =>
    environmentId === "office"
      ? new Promise<string[]>((resolve) => {
          resolveOffice = resolve;
        })
      : Promise.resolve(capabilities),
  );
  const id = getSessions()[0].id;
  await act(async () => {
    choose(id, "office");
    choose(id, "build");
  });
  await act(async () => resolveOffice(capabilities));
  expect(getSessions()[0]).toMatchObject({ id, cwd: "~", remoteExecutionEnvironmentId: "build" });
  expect(onCwdChange).not.toHaveBeenCalled();
});

it("holds the original machine when the first turn is in its durable outbox", async () => {
  const original = { ...getSessions()[0], remoteExecutionEnvironmentId: "office" };
  resetSessionsStore([original]);
  mocks.outbox.mockResolvedValue({ command: { type: "create" } });
  await act(async () => choose(original.id, undefined));
  expect(getSessions()[0]).toBe(original);
  expect(mocks.outbox).toHaveBeenCalledWith(expect.any(String), "office", null, original.id);
  expect(mocks.toast).toHaveBeenCalled();
});
