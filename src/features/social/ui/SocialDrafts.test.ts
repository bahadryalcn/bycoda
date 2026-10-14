// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftList } from "./SocialDrafts";
import type { SocialClient } from "../model/socialClient";
import type { SocialDraft, SocialSnapshot } from "../model/social";

let container: HTMLDivElement, root: Root;
const request = vi.fn();
const draft: SocialDraft = {
  id: "draft",
  accountId: "account",
  projectId: "project",
  contactId: "contact",
  kind: "message",
  text: "Yanıt",
  factIds: [],
  createdAt: 1,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  request.mockImplementation(async (action) =>
    action === "policy.get" ? { effective: {} } : { ...draft },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(value = draft, snapshot?: Partial<SocialSnapshot>) {
  await act(async () =>
    root.render(
      createElement(DraftList, {
        drafts: [value],
        snapshot: snapshot
          ? ({
              executorId: "host",
              hostOnline: true,
              sendingEnabled: false,
              stopped: false,
              pollingEnabled: false,
              accounts: [],
              campaigns: [],
              contacts: [],
              threads: [],
              segments: [],
              rules: [],
              jobs: [],
              drafts: [],
              profiles: [],
              capabilities: {},
              ...snapshot,
            } as SocialSnapshot)
          : undefined,
        client: { request } as unknown as SocialClient,
        run: async (action) => {
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
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  )!;
  await act(async () => button.click());
}
it("inceleme isteyen taslak düzenlenebilir; başarısız kaydetme editörü kapatmaz", async () => {
  await mount({ ...draft, reviewReason: "Metni inceleyin" });
  expect(
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith("Onayla"),
    )?.disabled,
  ).toBe(true);
  await click("Düzenle");
  request.mockImplementation(async (action) => {
    if (action === "policy.get") return { effective: {} };
    throw new Error("Save failed");
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(request).toHaveBeenCalledWith("drafts.update", {
    id: "draft",
    text: "Yanıt",
    factIds: [],
  });
  expect(container.querySelector("textarea")).toBeTruthy();
  request.mockImplementation(async (action) =>
    action === "policy.get" ? { effective: {} } : { ...draft },
  );
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(container.querySelector("textarea")).toBeNull();
});
it("silinmiş bilgi kaynağı kaldırıldıktan sonra inceleme taslağı tekrar kaydedilebilir", async () => {
  await mount({ ...draft, factIds: ["removed"], reviewReason: "Bilgi kaynağı değişti" }, {});
  await click("Düzenle");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Değişiklikleri kaydet",
    )?.disabled,
  ).toBe(true);
  await click("Bilgi bağlantılarını kaldır");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Değişiklikleri kaydet",
    )?.disabled,
  ).toBe(false);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(request).toHaveBeenCalledWith("drafts.update", {
    id: "draft",
    text: "Yanıt",
    factIds: [],
  });
});
it("gönderim kapalı veya taslak zaten kuyruktaysa gönderme düğmesi kapalıdır", async () => {
  await mount(draft, {
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    accounts: [],
    threads: [],
    contacts: [],
    jobs: [],
  });
  const approval = () =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith("Onayla"),
    )!;
  expect(approval().disabled).toBe(true);
  await mount(draft, {
    hostOnline: true,
    sendingEnabled: true,
    stopped: false,
    accounts: [],
    threads: [],
    contacts: [],
    jobs: [
      {
        id: "job",
        draftId: "draft",
        status: "queued",
      } as SocialSnapshot["jobs"][number],
    ],
  });
  expect(approval().disabled).toBe(true);
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Düzenle",
    )?.disabled,
  ).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("güncel politika sınırını aşan taslak gönderim onayı alamaz", async () => {
  await mount(draft, {
    sendingEnabled: true,
    accounts: [
      {
        id: "account",
        name: "Owner",
        platform: "x",
        connected: true,
        paused: false,
      } as SocialSnapshot["accounts"][number],
    ],
  });
  request.mockResolvedValue({ effective: { maxMessageCharacters: 2 } });
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.startsWith("Onayla"),
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(request).toHaveBeenCalledWith("policy.get", { accountId: "account" });
  expect(
    request.mock.calls.some((call) => call[0] === "drafts.approve" || call[0] === "messages.send"),
  ).toBe(false);
});
