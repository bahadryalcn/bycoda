// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copyText } from "../../../platform/tauri/clipboard";
import { PhonePairingFlow } from "./PhonePairingFlow";
import type { PhonePairingState } from "../model/phonePairingTypes";
import type { RemoteMachine } from "../model/protocol";

vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn(async () => undefined) }));
vi.mock("../../account", () => ({ watchPairingView: () => () => undefined }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const machine: RemoteMachine = {
  id: "local",
  name: "This computer",
  environmentId: "env",
  endpoint: "http://127.0.0.1:3774",
};

it("copies the same pairing code the QR shows, for the phone's Paste pairing code", async () => {
  const code = { v: 1, url: "http://192.168.1.5:61882", pairingId: "p1", secret: "s" };
  const state = {
    stage: "qr",
    machine,
    access: { state: "ready" },
    session: { pairingId: "p1", code },
    remainingSeconds: 90,
  } as unknown as PhonePairingState;
  const noop = () => undefined;
  await act(async () =>
    root.render(
      createElement(PhonePairingFlow, {
        variant: "dialog",
        machines: [machine],
        state,
        onSelect: noop,
        onMode: noop,
        onClose: noop,
        onRefresh: noop,
        onEnable: noop,
        onDisable: noop,
        onCreate: noop,
        onRegenerate: noop,
      } as unknown as Parameters<typeof PhonePairingFlow>[0]),
    ),
  );
  expect(container.textContent).toContain("choose Paste pairing code");
  const copy = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Copy code"),
  )!;
  await act(async () => copy.click());
  expect(copyText).toHaveBeenCalledWith(JSON.stringify(code));
  expect(container.textContent).toContain("Code copied");
});
