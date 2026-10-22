// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { SocialBrowserWorkspace } from "./SocialBrowserWorkspace";
import { SocialPanelActiveContext } from "./socialContext";

const status = vi.fn(),
  begin = vi.fn(),
  cancel = vi.fn(),
  monitoring = vi.fn();
const client = {
  browserWorkflowStatus: status,
  browserWorkflowBegin: begin,
  browserWorkflowCancel: cancel,
  monitoringStatus: monitoring,
} as unknown as SocialClient;
const Component = withQueryClient(SocialBrowserWorkspace);
let element: HTMLDivElement, root: Root;
const account = { id: "tiktok", platform: "tiktok" } as SocialAccount;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status.mockReset().mockResolvedValue({ available: true, reason: "Ready", workflows: [] });
  begin.mockReset().mockResolvedValue({ status: "awaiting_owner" });
  cancel.mockReset().mockResolvedValue(undefined);
  monitoring.mockReset().mockResolvedValue({ status: "idle", pollingEnabled: false });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
it("shows the specific encrypted Chat setup blocker", async () => {
  monitoring.mockResolvedValue({
    status: "partial",
    pollingEnabled: true,
    accountActive: true,
    coverage: [{ channel: "messages", status: "unavailable", reason: "chat_setup_required" }],
  });
  await act(async () =>
    root.render(
      createElement(Component, {
        account: { ...account, platform: "x", connected: true },
        client,
      }),
    ),
  );
  await open();
  expect(element.textContent).toContain("erişim kodu kurulumu gerekiyor");
});
async function open() {
  const details = element.querySelector("details")!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}
it("loads on disclosure, requires owner acknowledgement and tracks signup separately from connection", async () => {
  await act(async () => root.render(createElement(Component, { account, client })));
  expect(status).not.toHaveBeenCalled();
  await open();
  expect(status).toHaveBeenCalledWith("tiktok");
  expect(button("Tarayıcıda aç").disabled).toBe(true);
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
  );
  const signup = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (item) => item.textContent === "Kayıt ol",
  )!;
  await act(async () => signup.click());
  expect(element.textContent).toContain("CAPTCHA");
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => button("Tarayıcıda aç").click());
  expect(begin).toHaveBeenCalledExactlyOnceWith("tiktok", "signup", undefined);
  expect(element.textContent).not.toContain("hesap bağlandı");
});
it("shows interrupted work and gives an explicit retry without relaunching it", async () => {
  status.mockResolvedValue({
    available: true,
    workflows: [{ id: "old", intent: "signup", status: "interrupted" }],
  });
  await act(async () => root.render(createElement(Component, { account, client })));
  await open();
  expect(element.textContent).toContain("Host yeniden başladı; yeniden açın");
  expect(begin).not.toHaveBeenCalled();
});
it("prevents another window while work is active and allows cancellation", async () => {
  status.mockResolvedValue({
    available: true,
    workflows: [{ id: "active", intent: "login", status: "awaiting_owner" }],
  });
  await act(async () => root.render(createElement(Component, { account, client })));
  await open();
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("Tarayıcıda aç").disabled).toBe(true);
  await act(async () => button("İşlemi iptal et").click());
  expect(cancel).toHaveBeenCalledExactlyOnceWith("tiktok");
});
it("disables reads when the panel is inactive and exposes read failures with retry", async () => {
  const render = (active: boolean) =>
    createElement(
      SocialPanelActiveContext.Provider,
      { value: active },
      createElement(Component, { account, client }),
    );
  await act(async () => root.render(render(false)));
  await open();
  expect(status).not.toHaveBeenCalled();
  status.mockRejectedValue(new Error("Unavailable"));
  await act(async () => root.render(render(true)));
  expect(element.querySelector('[role="alert"]')?.textContent).toContain("Host sürümünü");
  status.mockResolvedValue({ available: true, workflows: [] });
  await act(async () => button("Durumu yenile").click());
  expect(element.querySelector('[role="alert"]')).toBeNull();
});
it("distinguishes disabled polling from successful historical reads and refreshes partial channel status", async () => {
  monitoring.mockResolvedValue({ status: "healthy", pollingEnabled: false, accountActive: true });
  await act(async () =>
    root.render(createElement(Component, { account: { ...account, connected: true }, client })),
  );
  await open();
  expect(element.textContent).toContain("Kapalı");
  expect(element.textContent).not.toContain("Son kontrol başarılı");
  monitoring.mockResolvedValue({ status: "partial", pollingEnabled: true, accountActive: true });
  await act(async () => button("Durumu yenile").click());
  expect(element.textContent).toContain("bazı kanallar okunamadı");
});
it("offers mobile setup guidance instead of a non-working WhatsApp registration", async () => {
  await act(async () =>
    root.render(
      createElement(Component, { account: { ...account, platform: "whatsapp" }, client }),
    ),
  );
  await open();
  expect(element.textContent).toContain("mobil uygulamada");
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
  );
  expect(
    [...document.body.querySelectorAll('[role="option"]')].some(
      (item) => item.textContent === "Kayıt ol",
    ),
  ).toBe(false);
});
