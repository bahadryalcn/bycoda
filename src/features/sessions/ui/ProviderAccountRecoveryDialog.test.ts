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
