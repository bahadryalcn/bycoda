// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePhoneApprovalRequest } from "./PhoneApprovalRequest";
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({
    title,
    children,
    footer,
    onClose,
  }: {
    title?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
  }) =>
    createElement(
      "div",
      null,
      createElement("h2", null, title),
      children,
      footer,
      createElement("button", { onClick: onClose }, "Close"),
    ),
  ModalActions: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let control!: ReturnType<typeof usePhoneApprovalRequest>;
  function Harness() {
    control = usePhoneApprovalRequest();
    return control.dialog;
  }
  act(() => root.render(createElement(Harness)));
  const unmount = () => act(() => root.unmount());
  cleanup = () => {
    unmount();
    host.remove();
  };
  return { host, read: () => control, unmount };
}
const request = (onConfirm: () => Promise<unknown>) => ({
  title: "Allow this phone to connect?",
  message: "Phone, code 123456",
  confirmLabel: "Allow",
  cancelLabel: "Deny",
  pendingLabel: "Connecting…",
  onConfirm,
});
it("blocks duplicate approval, denial and close while connecting, then settles", async () => {
  const { host, read } = mount();
  let finish!: () => void;
  const approve = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let answer!: Promise<boolean>;
  act(() => {
    answer = read().confirm(request(approve));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-button-variant="primary"]')!.click(),
  );
  const buttons = host.querySelectorAll("button");
  act(() => buttons.forEach((button) => button.click()));
  expect(approve).toHaveBeenCalledOnce();
  const allowButton = host.querySelector<HTMLButtonElement>('[data-button-variant="primary"]')!;
  const denyButton = [...buttons].find((button) => button.textContent === "Deny")!;
  expect(allowButton.getAttribute("aria-busy")).toBe("true");
  expect(denyButton.disabled).toBe(true);
  await act(async () => finish());
  await expect(answer).resolves.toBe(true);
});
it("shows retry error, resets replacement state and resolves abandoned requests", async () => {
  const { host, read, unmount } = mount();
  const approve = vi.fn().mockRejectedValue(new Error("Host unavailable"));
  let first!: Promise<boolean>;
  act(() => {
    first = read().confirm(request(approve));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-button-variant="primary"]')!.click(),
  );
  expect(host.textContent).toContain("Host unavailable");
  expect(
    host
      .querySelector<HTMLButtonElement>('[data-button-variant="primary"]')!
      .getAttribute("aria-busy"),
  ).toBeNull();
  let second!: Promise<boolean>;
  act(() => {
    second = read().confirm(request(approve));
  });
  await expect(first).resolves.toBe(false);
  expect(host.textContent).not.toContain("Host unavailable");
  unmount();
  await expect(second).resolves.toBe(false);
});

it("does not let an old async completion settle a replacement request", async () => {
  const { host, read } = mount();
  let finish!: () => void;
  const oldApprove = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const nextApprove = vi.fn().mockResolvedValue(undefined);
  let oldAnswer!: Promise<boolean>;
  let nextAnswer!: Promise<boolean>;
  act(() => {
    oldAnswer = read().confirm(request(oldApprove));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-button-variant="primary"]')!.click(),
  );
  act(() => {
    nextAnswer = read().confirm(request(nextApprove));
  });
  await expect(oldAnswer).resolves.toBe(false);
  await act(async () => finish());
  expect(host.textContent).toContain("Allow this phone to connect?");
  const deny = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Deny",
  )!;
  act(() => deny.click());
  await expect(nextAnswer).resolves.toBe(false);
  expect(nextApprove).not.toHaveBeenCalled();
});
