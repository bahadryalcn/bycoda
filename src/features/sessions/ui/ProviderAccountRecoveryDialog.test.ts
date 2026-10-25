// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveProviderAccount, removeProviderAccount } from "../../providers/model/providerAccounts";
import { ProviderAccountRecoveryDialog } from "./ProviderAccountRecoveryDialog";
import { ProviderAccountMenu } from "./ProviderAccountMenu";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  saveProviderAccount({ id: "replacement", provider: "claude", label: "Work", isDefault: true });
  removeProviderAccount("claude", "default");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("silinen hesabın yerine kalan tek hesabı seçtirir ve konuşmayı kurtarır", async () => {
  const onSelect = vi.fn(async () => true);
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(ProviderAccountRecoveryDialog, {
        provider: "claude",
        onSelect,
        onClose,
        onManage: vi.fn(),
      }),
    ),
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === "Work",
  )!;
  await act(async () => button.click());
  expect(onSelect).toHaveBeenCalledWith("replacement");
  expect(onClose).toHaveBeenCalledOnce();
});

it("hesap geçişi başarısızsa pencereyi açık tutar", async () => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(ProviderAccountRecoveryDialog, {
        provider: "claude",
        onSelect: vi.fn(async () => {
          throw new Error("Transfer failed");
        }),
        onClose,
        onManage: vi.fn(),
      }),
    ),
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === "Work",
  )!;
  await act(async () => button.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Transfer failed");
  expect(onClose).not.toHaveBeenCalled();
});

it("shows pending only on the selected account and keeps retry available on failure", async () => {
  saveProviderAccount({ id: "second", provider: "claude", label: "Personal", isDefault: false });
  let reject!: (cause: Error) => void;
  const onSelect = vi.fn(
    () =>
      new Promise<boolean>((_resolve, failure) => {
        reject = failure;
      }),
  );
  act(() =>
    root.render(
      createElement(ProviderAccountRecoveryDialog, {
        provider: "claude",
        onSelect,
        onClose: vi.fn(),
        onManage: vi.fn(),
      }),
    ),
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === "Work",
  )!;
  button.focus();
  act(() => {
    button.click();
    button.click();
  });
  expect(onSelect).toHaveBeenCalledOnce();
  expect(document.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(button);
  await act(async () => reject(new Error("Transfer unavailable")));
  expect(button.hasAttribute("aria-busy")).toBe(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Transfer unavailable");
});

it("silinen hesap kullanılırken tek hesap olsa da seçiciyi gösterir", () => {
  act(() =>
    root.render(
      createElement(ProviderAccountMenu, {
        variant: "pill",
        provider: "claude",
        accountId: "removed",
        onSelect: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector("button")).not.toBeNull();
});
