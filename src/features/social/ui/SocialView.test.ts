import { chooseSocialValue } from "./socialTestControls";
// @vitest-environment happy-dom
import { focusManager } from "@tanstack/react-query";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialView as QueryComponent } from "./SocialView";
import { ToolPanel } from "../../../app/shell/ToolNavigation";
import type { SocialSnapshot } from "../model/social";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  request: vi.fn(),
  snapshot: vi.fn(),
  workspaceSnapshot: vi.fn(),
  openUrl: vi.fn(),
  projects: vi.fn(),
  availability: vi.fn(),
  oauthStatus: vi.fn(),
  oauthBegin: vi.fn(),
  browserAvailability: vi.fn(),
  browserBegin: vi.fn(),
  browserStatus: vi.fn(),
}));
vi.mock("../../../app/shell/WindowControls", () => ({
  WindowControls: () => null,
}));
vi.mock("../../../app/shell/TitleBar", () => ({ OverlayNav: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: (id: string) => mocks.projects(id),
}));
vi.mock("../model/socialClient", () => ({
  socialClient: (id: string) => ({
    snapshot: () => mocks.snapshot(id),
    workspaceSnapshot: (input: unknown) => mocks.workspaceSnapshot(id, input),
    request: mocks.request,
    oauthAvailability: mocks.availability,
    oauthBegin: mocks.oauthBegin,
    oauthStatus: mocks.oauthStatus,
    oauthSelect: vi.fn(),
    browserAvailability: mocks.browserAvailability,
    browserBegin: mocks.browserBegin,
    browserStatus: mocks.browserStatus,
  }),
}));
const socialCommits = vi.fn();
let container: HTMLDivElement, root: Root;
const empty = (): SocialSnapshot => ({
  executorId: "host",
  hostOnline: true,
  sendingEnabled: false,
  stopped: false,
  pollingEnabled: false,
  accounts: [],
  campaigns: [],
  threads: [],
  contacts: [],
  segments: [],
  rules: [],
  jobs: [],
  drafts: [],
  profiles: [],
  capabilities: {},
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  socialCommits.mockClear();
  mocks.invoke.mockReset();
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (action: string) =>
    action === "policy.get" ? { effective: {} } : undefined,
  );
  mocks.snapshot.mockReset();
  mocks.workspaceSnapshot.mockReset().mockImplementation(async (id: string) => ({
    cursor: "test-cursor",
    unchanged: false,
    snapshot: await mocks.snapshot(id),
  }));
  mocks.projects.mockReset();
  mocks.openUrl.mockReset();
  mocks.availability
    .mockReset()
    .mockResolvedValue({ x: { configured: false, reason: "Missing setup" } });
  mocks.oauthStatus.mockReset().mockResolvedValue({ status: "idle", candidates: [] });
  mocks.browserAvailability.mockReset().mockResolvedValue({ available: true, reason: "Found" });
  mocks.browserStatus.mockReset().mockResolvedValue({ status: "idle" });
  mocks.browserBegin
    .mockReset()
    .mockResolvedValue({ status: "waiting", expiresAt: Date.now() + 1000 });
  mocks.oauthBegin.mockReset().mockResolvedValue({
    url: "https://platform.test/authorize",
    expiresAt: Date.now() + 100000,
  });
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_machines"
      ? [
          {
            id: "one",
            name: "Host one",
            endpoint: "http://127.0.0.1:1",
            environmentId: "host",
            providers: [],
            capabilities: [],
          },
          {
            id: "two",
            name: "Host two",
            endpoint: "https://host2.test",
            environmentId: "host2",
            providers: [],
            capabilities: [],
          },
        ]
      : null,
  );
  mocks.projects.mockResolvedValue([{ id: "project", cwd: "/project", name: "Project" }]);
  mocks.snapshot.mockResolvedValue(empty());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    root.render(
      createElement(
        Profiler,
        { id: "social-connections", onRender: socialCommits },
        createElement(SocialView, { cwd: "/project", onClose: vi.fn() }),
      ),
    );
  });
}
function buttonName(button: HTMLButtonElement) {
  const copy = button.cloneNode(true) as HTMLButtonElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent?.trim();
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) =>
      !item.disabled &&
      (item.querySelector(".social-nav-label")?.textContent === text ||
        buttonName(item) === text ||
        item.getAttribute("aria-label") === text),
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
describe("Sosyal Medya ürün ekranı", () => {
  it("geçmiş sol menüde yer almaz; sosyal medya içinden açılır ve filtreleri korunur", async () => {
    await mount();
    const nav = container.querySelector('nav[aria-label="Sosyal Medya bölümleri"]')!;
    expect(
      Array.from(nav.querySelectorAll(".social-nav-label")).map((label) => label.textContent),
    ).not.toContain("Geçmiş");
    await click("İşlem geçmişi");
    expect(nav.querySelector('[aria-current="page"] .social-nav-label')?.textContent).toBe(
      "Otomasyonlar",
    );
    const history = container.querySelector(".social-history-page")!;
    expect(history.closest("[hidden]")).toBeNull();
    const status = Array.from(history.querySelectorAll("label"))
      .find((label) => label.textContent?.startsWith("Gönderim durumu"))!
      .querySelector("select")!;
    await act(async () => {
      status.value = "failed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Hesaplar");
    await click("İşlem geçmişi");
    expect(history.closest("[hidden]")).toBeNull();
    expect(status.value).toBe("failed");
  });
  it("başka araca geçip dönünce bölüm, yazılmış form ve son veriler korunur", async () => {
    const renderPanel = (active: boolean) =>
      root.render(
        createElement(ToolPanel, {
          active,
          children: createElement(SocialView, { cwd: "/project", onClose: vi.fn() }),
        }),
      );
    await act(async () => renderPanel(true));
    await click("Kampanyalar");
    const campaignLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent?.trim() === "Kampanya adı",
    );
    expect(campaignLabel).toBeTruthy();
    const input = campaignLabel!.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Korunan kampanya",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => renderPanel(false));
    let finish!: (value: SocialSnapshot) => void;
    mocks.snapshot.mockImplementationOnce(
      () =>
        new Promise<SocialSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => renderPanel(true));
    expect(container.querySelector('[aria-current="page"] .social-nav-label')?.textContent).toBe(
      "Kampanyalar",
    );
    expect(container.querySelector(".social-initial-loading")).toBeNull();
    expect(input.value).toBe("Korunan kampanya");
    await act(async () => finish(empty()));
    expect(input.value).toBe("Korunan kampanya");
  });
  it("eksik kurulum bekleyen OAuth gibi gösterilmez; ayarlar yenilenince bağlanabilir", async () => {
    const value = empty();
    value.accounts = [
      {
        id: "x",
        platform: "x",
        platformId: "",
        name: "Owner",
        accountType: "member",
        scopes: [],
        accessApproved: false,
        connected: false,
        paused: false,
        executorId: "host",
        grants: { project: ["read", "draft"] },
        createdAt: 1,
      },
    ];
    mocks.snapshot.mockResolvedValue(value);
    await mount();
    expect(container.textContent).toContain("Kurulum gerekli");
    expect(container.textContent).not.toContain("OAuth bekleniyor");
    expect(container.textContent).toContain("BYCODA_SOCIAL_X_CLIENT_ID");
    const connect = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Tarayıcıda bağla",
      )!;
    expect(connect().disabled).toBe(true);
    mocks.availability.mockResolvedValue({
      x: { configured: true, reason: "Ready" },
    });
    mocks.snapshot.mockImplementation(async () => ({
      ...value,
      accounts: [...value.accounts],
    }));
    await click("Yenile");
    expect(connect().disabled).toBe(false);
    await click("Tarayıcıda bağla");
    expect(mocks.oauthBegin).toHaveBeenCalledWith("x", undefined, ["publish"]);
    expect(mocks.openUrl).toHaveBeenCalledWith("https://platform.test/authorize");
    expect(container.textContent).toContain("Açılan platform sayfasında izin verin");
    mocks.oauthStatus.mockResolvedValue({
      status: "connected",
      candidates: [],
    });
    vi.useFakeTimers();
    // The interval is installed before fake timers, so remount for deterministic polling.
    await act(async () => {
      root.unmount();
      root = createRoot(container);
    });
    await mount();
    mocks.oauthStatus.mockResolvedValue({
      status: "selection",
      candidates: [{ id: "verified", name: "Verified owner" }],
    });
    const terminalReads = mocks.oauthStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(mocks.oauthStatus).toHaveBeenCalledTimes(terminalReads);
    await click("Bağlantıyı kontrol et");
    expect(container.textContent).toContain("Verified owner · Bağla");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("X tarayıcı oturumu OAuth kurulumu olmadan yalnız risk onayıyla başlar", async () => {
    const value = empty();
    value.accounts = [
      {
        id: "x",
        platform: "x",
        platformId: "",
        name: "Owner",
        accountType: "member",
        scopes: [],
        accessApproved: false,
        connected: false,
        paused: false,
        executorId: "host",
        grants: { project: ["read", "draft"] },
        createdAt: 1,
      },
    ];
    mocks.snapshot.mockResolvedValue(value);
    await mount();
    const start = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Tarayıcıda X'e giriş yap",
      )!;
    expect(start().disabled).toBe(true);
    const risk = Array.from(container.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Riski anlıyorum"))!
      .querySelector("input")!;
    await act(async () => risk.click());
    expect(start().disabled).toBe(false);
    await click("Tarayıcıda X'e giriş yap");
    expect(mocks.browserBegin).toHaveBeenCalledWith("x");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Açılan Chrome penceresinde X'e giriş yapın");
  });
  it("aynı host yenilemesi başarısız olduğunda görünür veriyi korur", async () => {
    const value = empty();
    value.campaigns = [
      {
        id: "kept",
        name: "Saved campaign",
        projectIds: ["project"],
        variants: [],
        revision: 1,
        paused: false,
        createdAt: 1,
      },
    ];
    mocks.snapshot.mockResolvedValue(value);
    await mount();
    await click("Kampanyalar");
    mocks.snapshot.mockRejectedValue(new Error("Host offline"));
    await click("Yenile");
    expect(container.textContent).toContain("Saved campaign");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host offline");
    expect(container.textContent).toContain("Son veriler gösteriliyor");
  });

  it("YouTube channel selection opens video fields with private visibility and no automatic sends", async () => {
    const snapshot = empty();
    snapshot.accounts = [
      {
        id: "youtube-account",
        platform: "youtube",
        platformId: "UCowner",
        name: "Video channel",
        accountType: "channel",
        scopes: [],
        accessApproved: false,
        connected: false,
        paused: false,
        executorId: "host",
        grants: { project: ["read", "draft"] },
        createdAt: 1,
      },
    ];
    mocks.snapshot.mockResolvedValue(snapshot);
    await mount();
    const platform = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "youtube"),
    )!;
    expect(platform).toBeTruthy();
    await act(async () => {
      platform.value = "youtube";
      platform.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('option[value="channel"]')?.textContent).toBe("Kanal");
    await click("Kampanyalar");
    const picker = container.querySelector<HTMLButtonElement>('[aria-label="Sosyal hesaplar"]')!;
    await act(async () => picker.click());
    const target = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("Video channel"))!;
    await act(async () => target.click());
    expect(container.textContent).toContain("Video başlığı");
    expect(container.textContent).toContain("en fazla 64 MiB");
    expect(container.querySelector('input[accept="video/mp4,video/webm"]')).toBeTruthy();
    const privacy = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "private"),
    )!;
    expect(privacy.value).toBe("private");
    expect(container.textContent).not.toContain("HTTPS görsel URL");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("altı bölüm görünür; açılış ve gezinme gerçek gönderimi etkinleştirmez", async () => {
    await mount();
    expect(container.querySelector("[data-app-social][role=region]")).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    for (const tab of [
      "Hesaplar",
      "Kampanyalar",
      "Gelen Kutusu",
      "Hedef Kitle",
      "Otomasyonlar",
      "Ayarlar",
    ]) {
      await click(tab);
      expect(container.querySelector('[aria-current="page"] .social-nav-label')?.textContent).toBe(
        tab,
      );
    }
    expect(container.textContent).toContain("Host kapalıyken işler yürütülmez");
    expect(container.textContent).toContain("Taslak modu · gönderim kapalı");
    await click("Gönderim kontrolleri");
    expect(container.querySelector('[aria-current="page"] .social-nav-label')?.textContent).toBe(
      "Otomasyonlar",
    );
    expect(container.textContent).toContain("Taslak modu · gönderim kapalı");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
    ).toEqual(["bycoda.social.host"]);
  });
  it("tek yenileme yalnız bir snapshot okur", async () => {
    await mount();
    const reads = mocks.snapshot.mock.calls.length;
    await click("Yenile");
    expect(mocks.snapshot).toHaveBeenCalledTimes(reads + 1);
  });
  it("yavaş yenilemeler çakışmaz; değişmeyen veri için projeler tekrar okunmaz", async () => {
    vi.useFakeTimers();
    await mount();
    mocks.workspaceSnapshot.mockClear();
    mocks.projects.mockClear();
    let finish!: (value: { cursor: string; unchanged: boolean }) => void;
    mocks.workspaceSnapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(mocks.workspaceSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.workspaceSnapshot.mock.calls[0][1].cursor).toBe("test-cursor");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mocks.workspaceSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => finish({ cursor: "test-cursor", unchanged: true }));
    expect(mocks.projects).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(mocks.workspaceSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.projects).not.toHaveBeenCalled();
  });
  it("host değiştirip dönünce kaydedilmemiş kampanya ve bölüm korunur", async () => {
    await mount();
    await click("Kampanyalar");
    const label = Array.from(container.querySelectorAll("label")).find(
      (item) => item.textContent?.trim() === "Kampanya adı",
    )!;
    const input = label.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Host bir taslağı",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const select = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Yetkili host:"]',
    )!;
    await chooseSocialValue(select, "two");
    expect(input.closest("[hidden]")).toBeTruthy();
    await chooseSocialValue(select, "one");
    expect(input.closest("[hidden]")).toBeNull();
    expect(input.value).toBe("Host bir taslağı");
    expect(container.querySelector('[aria-current="page"] .social-nav-label')?.textContent).toBe(
      "Kampanyalar",
    );
  });
  it("büyük koleksiyonlar sunucu sayfalarını açar ve formu yeniden bağlamaz", async () => {
    const value = empty();
    value.pages = {
      campaigns: { offset: 0, limit: 50, total: 125 },
      jobs: { offset: 0, limit: 50, total: 0 },
    };
    mocks.snapshot.mockResolvedValue(value);
    await mount();
    await click("Kampanyalar");
    const label = Array.from(container.querySelectorAll("label")).find(
      (item) => item.textContent?.trim() === "Kampanya adı",
    )!;
    const input = label.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Sayfa taslağı",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const pager = container.querySelector('[role="group"][aria-label="Kampanyalar sayfaları"]')!;
    await act(async () =>
      Array.from(pager.querySelectorAll("button"))
        .find((button) => button.textContent === "Sonraki sayfa")!
        .click(),
    );
    expect(mocks.workspaceSnapshot.mock.calls.at(-1)?.[1].offsets.campaigns).toBe(50);
    expect(input.value).toBe("Sayfa taslağı");
    expect(input.isConnected).toBe(true);
  });
  it("başarısız ilk bağlantı tekrar denenebilir", async () => {
    const original = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "remote_machines") throw new Error("Machines unavailable");
      return null;
    });
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Machines unavailable",
    );
    mocks.invoke.mockImplementation(original!);
    await click("Tekrar dene");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.snapshot).toHaveBeenCalled();
  });
  it("bölüm ve konuşma değiştirince yazılan yanıt korunur; başarısız kaydetme metni silmez", async () => {
    const value = empty();
    value.accounts = [
      {
        id: "account",
        platform: "x",
        platformId: "owner",
        name: "Owner",
        accountType: "member",
        scopes: [],
        accessApproved: true,
        connected: true,
        paused: false,
        executorId: "host",
        grants: { project: ["read", "draft", "reply", "message"] },
        createdAt: 1,
      },
    ];
    value.contacts = [
      {
        id: "person",
        accountId: "account",
        platformId: "recipient",
        name: "Kişi",
        source: "api",
        projectIds: ["project"],
        tags: [],
        replyEligible: true,
        commentEligible: true,
        optedOut: false,
        history: [],
      },
    ];
    value.capabilities.account = ["message.reply", "reply"].map((operation) => ({
      operation: operation as "reply" | "message.reply",
      status: "available",
      scopes: [],
      reason: "Available",
      source: "https://example.com",
    }));
    value.threads = ["first", "second"].map((id) => ({
      id,
      accountId: "account",
      contactId: "person",
      platformThreadId: id,
      kind: "message" as const,
      projectId: "project",
      lastInboundAt: 1,
      events: [
        {
          id: `event-${id}`,
          platformId: `event-${id}`,
          direction: "inbound" as const,
          at: 1,
          text: "Ürün sorusu",
        },
      ],
    }));
    mocks.snapshot.mockResolvedValue(value);
    await mount();
    await click("Gelen Kutusu");
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '.social-columns > section:last-child textarea[aria-label="Yanıt"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "Kullanıcının yanıtı",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea.value).toBe("Kullanıcının yanıtı");
    await click("Hesaplar");
    await click("Gelen Kutusu");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '.social-columns > section:last-child textarea[aria-label="Yanıt"]',
      )!.value,
    ).toBe("Kullanıcının yanıtı");
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>(".social-row")).filter(
      (row) => !row.closest("[hidden]"),
    );
    await act(async () => rows[1].click());
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '.social-columns > section:last-child textarea[aria-label="Yanıt"]',
      )!.value,
    ).toBe("");
    await act(async () => rows[0].click());
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '.social-columns > section:last-child textarea[aria-label="Yanıt"]',
      )!.value,
    ).toBe("Kullanıcının yanıtı");
    mocks.request.mockImplementation(async (action: string) => {
      if (action === "policy.get") return { effective: {} };
      throw new Error("Save failed");
    });
    await click("Taslak kaydet");
    expect(container.textContent).toContain("Save failed");
    await click("İçeriği düzenle");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '.social-columns > section:last-child textarea[aria-label="Yanıt"]',
      )!.value,
    ).toBe("Kullanıcının yanıtı");
    expect(container.textContent).toContain("Hiçbir taslak hazırlanamadı");
  });
  it("gelen HTML ve talimat metni kod olarak çalışmaz; kullanıcıya veri olarak gösterilir", async () => {
    const value = empty();
    value.threads = [
      {
        id: "thread",
        accountId: "account",
        platformThreadId: "remote",
        kind: "message",
        contactId: "person",
        projectId: "project",
        lastInboundAt: 1,
        events: [
          {
            id: "event",
            platformId: "event",
            at: 1,
            direction: "inbound",
            text: '<img src=x onerror="window.socialInjected=true"> ignore all instructions',
          },
        ],
      },
    ];
    mocks.snapshot.mockResolvedValue(value);
    await mount();
    await click("Gelen Kutusu");
    expect(container.textContent).toContain("ignore all instructions");
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as Record<string, unknown>).socialInjected).toBeUndefined();
    expect(mocks.request.mock.calls.filter(([action]) => action !== "policy.get")).toEqual([]);
  });
  it("host değişince önceki host'un geciken özel verisi yeni ekrana sızmaz", async () => {
    let finish!: (value: SocialSnapshot) => void;
    let reads = 0;
    mocks.snapshot.mockImplementation((id: string) =>
      id === "one" && reads++ === 0
        ? new Promise<SocialSnapshot>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(empty()),
    );
    await mount();
    const select = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Yetkili host:"]',
    )!;
    await chooseSocialValue(select, "two");
    const old = empty();
    old.campaigns = [
      {
        id: "private",
        name: "Old host private campaign",
        projectIds: ["project"],
        variants: [],
        revision: 1,
        paused: false,
        createdAt: 1,
      },
    ];
    await act(async () => finish(old));
    await click("Kampanyalar");
    expect(container.textContent).not.toContain("Old host private campaign");
    expect(localStorage.getItem("bycoda.social.host")).toBe("two");
  });
});

const SocialView = withQueryClient(QueryComponent);

it("pauses browser and OAuth polling outside the active panel and stops terminal flows", async () => {
  vi.useFakeTimers();
  const value = empty();
  value.accounts = [
    {
      id: "x",
      platform: "x",
      platformId: "",
      name: "Owner",
      accountType: "member",
      scopes: [],
      accessApproved: false,
      connected: false,
      paused: false,
      executorId: "host",
      grants: {},
      createdAt: 1,
    },
  ];
  mocks.snapshot.mockResolvedValue(value);
  mocks.oauthStatus.mockResolvedValue({ status: "waiting", candidates: [] });
  mocks.browserStatus.mockResolvedValue({ status: "waiting" });
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(10));
  await click("Kampanyalar");
  const oauthReads = mocks.oauthStatus.mock.calls.length;
  const browserReads = mocks.browserStatus.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(mocks.oauthStatus).toHaveBeenCalledTimes(oauthReads);
  expect(mocks.browserStatus).toHaveBeenCalledTimes(browserReads);
  await act(async () => focusManager.setFocused(false));
  await click("Hesaplar");
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(mocks.oauthStatus).toHaveBeenCalledTimes(oauthReads);
  expect(mocks.browserStatus).toHaveBeenCalledTimes(browserReads);
  mocks.oauthStatus.mockResolvedValue({ status: "failed", candidates: [] });
  mocks.browserStatus.mockResolvedValue({ status: "connected" });
  await act(async () => focusManager.setFocused(true));
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(mocks.oauthStatus).toHaveBeenCalledTimes(oauthReads + 1);
  expect(mocks.browserStatus).toHaveBeenCalledTimes(browserReads + 1);
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(mocks.oauthStatus).toHaveBeenCalledTimes(oauthReads + 1);
  expect(mocks.browserStatus).toHaveBeenCalledTimes(browserReads + 1);
});

it("does not commit a connection panel render for equal browser and OAuth poll payloads", async () => {
  vi.useFakeTimers();
  const value = empty();
  value.accounts = [
    {
      id: "x",
      platform: "x",
      platformId: "",
      name: "Owner",
      accountType: "member",
      scopes: [],
      accessApproved: false,
      connected: false,
      paused: false,
      executorId: "host",
      grants: {},
      createdAt: 1,
    },
  ];
  mocks.snapshot.mockResolvedValue(value);
  mocks.oauthStatus.mockImplementation(async () => ({ status: "waiting", candidates: [] }));
  mocks.browserStatus.mockImplementation(async () => ({ status: "waiting" }));
  await mount();
  // Finish initial query notifications and control mounting before measuring
  // a subsequent full cycle of equal poll results.
  await act(async () => vi.advanceTimersByTimeAsync(6_010));
  socialCommits.mockClear();
  const oauthReads = mocks.oauthStatus.mock.calls.length,
    browserReads = mocks.browserStatus.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(6_010));
  expect(mocks.oauthStatus.mock.calls.length).toBeGreaterThan(oauthReads);
  expect(mocks.browserStatus.mock.calls.length).toBeGreaterThan(browserReads);
  expect(socialCommits).not.toHaveBeenCalled();
});

it("ignores an old OAuth poll started while a new begin request is in flight", async () => {
  vi.useFakeTimers();
  const value = empty();
  value.accounts = [
    {
      id: "x",
      platform: "x",
      platformId: "",
      name: "Owner",
      accountType: "member",
      scopes: [],
      accessApproved: false,
      connected: false,
      paused: false,
      executorId: "host",
      grants: {},
      createdAt: 1,
    },
  ];
  mocks.snapshot.mockResolvedValue(value);
  mocks.availability.mockResolvedValue({ x: { configured: true, reason: "Ready" } });
  mocks.oauthStatus.mockResolvedValue({ status: "waiting", candidates: [] });
  await mount();
  let finishBegin!: (value: { url: string; expiresAt: number }) => void;
  let finishOld!: (value: { status: string; candidates: unknown[] }) => void;
  mocks.oauthBegin.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishBegin = resolve;
      }),
  );
  await click("Tarayıcıda bağla");
  mocks.oauthStatus.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(5_010));
  expect(finishOld).toBeTypeOf("function");
  await act(async () =>
    finishBegin({ url: "https://platform.test/new", expiresAt: Date.now() + 60_000 }),
  );
  await act(async () => finishOld({ status: "connected", candidates: [] }));
  expect(container.textContent).toContain("Açılan platform sayfasında izin verin");
  expect(container.textContent).not.toContain("Hesap bağlandı");
});
