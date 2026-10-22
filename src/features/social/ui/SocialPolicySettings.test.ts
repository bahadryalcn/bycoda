// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialPolicies } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { SocialPolicySettings } from "./SocialPolicySettings";

let container: HTMLDivElement, root: Root;
const request = vi.fn();
const policies: SocialPolicies = {
  global: {
    agent: { provider: "antigravity", model: "owner-model" },
    maxContentCharacters: 500,
    maxCommentCharacters: 120,
    maxMessageCharacters: 300,
  },
  platforms: { youtube: { maxCommentCharacters: 90 } },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(value?: SocialPolicies, skipRun = false) {
  await act(async () =>
    root.render(
      createElement(SocialPolicySettings, {
        policies: value,
        client: { request } as unknown as SocialClient,
        run: async (action: () => Promise<unknown>) => {
          if (skipRun) return false;
          try {
            await action();
            return true;
          } catch {
            return false;
          }
        },
      }),
    ),
  );
}
function select(label: string) {
  return Array.from(container.querySelectorAll("label"))
    .find((item) => item.textContent?.startsWith(label))!
    .querySelector("select")!;
}
async function change(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function save() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function input(field: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(`[name="${field}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("retains an unset agent when the owner saves an unrelated limit", async () => {
  await mount();
  expect(select("AI ajanı").value).toBe("");
  expect(request).not.toHaveBeenCalled();
  const input = container.querySelector<HTMLInputElement>('[name="maxMessageCharacters"]')!;
  input.value = "250";
  await save();
  expect(request).toHaveBeenCalledWith("policy.save", {
    policies: {
      global: { maxMessageCharacters: 250 },
      platforms: {},
    },
  });
});
it("saves only platform overrides, retains global policy and shows inherited effective fields", async () => {
  await mount(policies);
  await change(select("Ayar kapsamı"), "youtube");
  expect(select("AI ajanı").value).toBe("");
  expect(container.textContent).toContain("Antigravity · owner-model");
  expect(container.textContent).toContain("Kayıtlı sınır: 300 · ortak ayar");
  container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value = "80";
  await save();
  expect(request).toHaveBeenCalledWith("policy.save", {
    policies: {
      ...policies,
      platforms: { youtube: { maxCommentCharacters: 80 } },
    },
  });
});
it("clearing a platform override inherits global instead of persisting zero or copied defaults", async () => {
  await mount(policies);
  await change(select("Ayar kapsamı"), "youtube");
  container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value = "";
  await save();
  expect(request).toHaveBeenCalledWith("policy.save", {
    policies: { ...policies, platforms: { youtube: {} } },
  });
});
it("a platform agent and explicit model override global without altering global settings", async () => {
  await mount(policies);
  await change(select("Ayar kapsamı"), "x");
  await change(select("AI ajanı"), "codex");
  const input = Array.from(container.querySelectorAll("label"))
    .find((item) => item.textContent?.startsWith("AI modeli"))!
    .querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "explicit-model",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await save();
  expect(request).toHaveBeenCalledWith("policy.save", {
    policies: {
      ...policies,
      platforms: {
        ...policies.platforms,
        x: { agent: { provider: "codex", model: "explicit-model" } },
      },
    },
  });
});
it("preserves unsaved values per scope and during unrelated policy refreshes", async () => {
  await mount(policies);
  await input("maxMessageCharacters", "222");
  await change(select("Ayar kapsamı"), "youtube");
  await input("maxCommentCharacters", "77");
  await mount({
    ...policies,
    platforms: { ...policies.platforms, x: { maxContentCharacters: 90 } },
  });
  expect(container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value).toBe(
    "77",
  );
  await change(select("Ayar kapsamı"), "global");
  expect(container.querySelector<HTMLInputElement>('[name="maxMessageCharacters"]')!.value).toBe(
    "222",
  );
  await change(select("Ayar kapsamı"), "youtube");
  expect(container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value).toBe(
    "77",
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("prevents overwriting a concurrently updated scope and reloads only on explicit reset", async () => {
  await mount(policies);
  await change(select("Ayar kapsamı"), "youtube");
  await input("maxCommentCharacters", "77");
  await mount({
    ...policies,
    platforms: { youtube: { maxCommentCharacters: 70 } },
  });
  expect(container.textContent).toContain("başka bir oturumda güncellendi");
  expect(container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value).toBe(
    "77",
  );
  await save();
  expect(request).not.toHaveBeenCalled();
  const reset = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Kayıtlı ayarları yükle",
  )!;
  await act(async () => reset.click());
  expect(container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value).toBe(
    "70",
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("follows refreshed saved settings when the scope has no edits", async () => {
  await mount(policies);
  await change(select("Ayar kapsamı"), "youtube");
  await mount({
    ...policies,
    platforms: { youtube: { maxCommentCharacters: 70 } },
  });
  expect(container.querySelector<HTMLInputElement>('[name="maxCommentCharacters"]')!.value).toBe(
    "70",
  );
});
it("rejects invalid character limits locally without making a request", async () => {
  await mount(policies);
  for (const value of ["0", "1.5", "20001"]) {
    await input("maxContentCharacters", value);
    await save();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "1 ile 20000 arasında tam sayı",
    );
  }
  expect(request).not.toHaveBeenCalled();
});
it("prevents duplicate saves and reports success after the request completes", async () => {
  let finish!: () => void;
  request.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount(policies);
  await input("maxMessageCharacters", "222");
  await save();
  await save();
  expect(request).toHaveBeenCalledTimes(1);
  expect(container.querySelector("form")!.getAttribute("aria-busy")).toBe("true");
  expect(container.textContent).not.toContain("ayarlar kaydedildi");
  await act(async () => finish());
  expect(container.textContent).toContain("Ortak ayarlar kaydedildi");
  expect(container.querySelector("form")!.getAttribute("aria-busy")).toBe("false");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("retains edited values after a save failure and allows retry", async () => {
  request.mockRejectedValueOnce(new Error("Host çevrimdışı"));
  await mount(policies);
  await input("maxMessageCharacters", "222");
  await save();
  expect(container.textContent).toContain("Ayarlar kaydedilemedi: Host çevrimdışı");
  expect(container.querySelector<HTMLInputElement>('[name="maxMessageCharacters"]')!.value).toBe(
    "222",
  );
  request.mockResolvedValueOnce({});
  await save();
  expect(request).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Ortak ayarlar kaydedildi");
});
it("does not report a save when the parent runner skips a busy operation", async () => {
  await mount(policies, true);
  await input("maxMessageCharacters", "222");
  await save();
  expect(request).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Başka bir işlem sürüyor");
  expect(container.textContent).not.toContain("ayarlar kaydedildi");
});
