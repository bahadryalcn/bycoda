// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickConnect } from "./QuickConnect";
import { saveSshConnection, type ServerRecord } from "../model/serverInventory";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
const callbacks = vi.hoisted(() => ({ quick: vi.fn(), saved: vi.fn() }));
vi.mock("./ServersTerminalWorkspace", () => ({
  useOpenQuickServerTerminal: () => callbacks.quick,
  useOpenServerTerminal: () => callbacks.saved,
}));
vi.mock("../model/serverInventory", () => ({ saveSshConnection: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  resetRetainedState();
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
async function field(label: string, value: string) {
  const element = [...document.querySelectorAll("label")].find(
    (entry) => entry.textContent?.replace("*", "").trim() === label,
  )!;
  expect(element).toBeTruthy();
  const input = document.getElementById(element.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("previews an endpoint and only connects explicitly without creating a saved record by default", async () => {
  const close = vi.fn();
  await act(async () => root.render(createElement(QuickConnect, { onClose: close })));
  expect(callbacks.quick).not.toHaveBeenCalled();
  await field("Host", "example.invalid");
  await field("SSH user", "alice");
  await field("SSH port", "2200");
  expect(document.querySelector('[aria-label="Endpoint preview"]')?.textContent).toContain(
    "alice@example.invalid:2200",
  );
  await submit();
  expect(saveSshConnection).not.toHaveBeenCalled();
  expect(callbacks.quick).toHaveBeenCalledExactlyOnceWith(
    {
      host: "example.invalid",
      user: "alice",
      port: 2200,
      identityFile: undefined,
      jumpHost: undefined,
    },
    "alice@example.invalid:2200",
  );
  expect(callbacks.saved).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it("saves only by explicit opt-in and connects through the resulting canonical ID", async () => {
  const saved: ServerRecord = {
    id: "canonical-saved",
    kind: "ssh",
    name: "Preview host",
    sshEndpoint: { host: "example.invalid", port: 22 },
    metadata: { tags: [], favorite: false },
  };
  vi.mocked(saveSshConnection).mockResolvedValue(saved);
  await act(async () => root.render(createElement(QuickConnect, { onClose: vi.fn() })));
  await field("Name", "Preview host");
  await field("Host", "example.invalid");
  const saveOption = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "Save connection")!
    .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => saveOption.click());
  await submit();
  expect(saveSshConnection).toHaveBeenCalledOnce();
  expect(callbacks.saved).toHaveBeenCalledExactlyOnceWith(saved);
  expect(callbacks.quick).not.toHaveBeenCalled();
});
it("retains an unfinished endpoint draft while closing and reopening, without connecting on restore", async () => {
  const render = () => root.render(createElement(QuickConnect, { onClose: vi.fn() }));
  await act(async () => render());
  await field("Host", "draft.invalid");
  await act(async () => root.render(null));
  await act(async () => render());
  expect(
    [...document.querySelectorAll("input")].some((input) => input.value === "draft.invalid"),
  ).toBe(true);
  expect(callbacks.quick).not.toHaveBeenCalled();
  expect(saveSshConnection).not.toHaveBeenCalled();
});
it("rejects unsafe endpoints instead of connecting or saving", async () => {
  await act(async () => root.render(createElement(QuickConnect, { onClose: vi.fn() })));
  await field("Host", "-oProxyCommand=anything");
  await submit();
  expect(callbacks.quick).not.toHaveBeenCalled();
  expect(saveSshConnection).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("valid SSH endpoint");
});
