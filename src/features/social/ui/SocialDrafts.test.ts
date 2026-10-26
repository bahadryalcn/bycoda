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
const browserAccount = (platform: "whatsapp" | "telegram" | "instagram" | "x", connected = true) =>
  ({
    id: "account",
    platform,
    name: "Owner",
    connection: "browser",
    connected,
    paused: false,
  }) as SocialSnapshot["accounts"][number];
const messagingMediaCapabilities = [
  { operation: "media", status: "available" },
  { operation: "message.reply", status: "available" },
] as SocialSnapshot["capabilities"][string];
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
it("shows the exact uploaded reply image before approval without sending", async () => {
  const png = {
    mime: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8zUAAAAASUVORK5CYII=",
  };
  request.mockResolvedValue(png);
  await mount({
    ...draft,
    media: [{ kind: "image", uploadId: "reply-image", alt: "Bycoda artwork" }],
  });
  expect(request).not.toHaveBeenCalled();
  const attachments = container.querySelector("details")!;
  await act(async () => {
    attachments.open = true;
    attachments.dispatchEvent(new Event("toggle"));
  });
  expect(request).toHaveBeenCalledExactlyOnceWith("programs.media-preview", {
    uploadId: "reply-image",
  });
  expect(container.querySelector("img")?.getAttribute("src")).toBe(
    `data:image/png;base64,${png.base64}`,
  );
  expect(container.querySelector("img")?.alt).toBe("Bycoda artwork");
  await act(async () => {
    attachments.open = false;
    attachments.dispatchEvent(new Event("toggle"));
  });
  expect(container.querySelector("img")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not fetch remote images or videos as owner-uploaded image previews", async () => {
  await mount({
    ...draft,
    media: [
      { kind: "image", url: "https://example.com/image.png" },
      { kind: "video", uploadId: "reply-video" },
    ],
  });
  await act(async () => {
    const attachments = container.querySelector("details")!;
    attachments.open = true;
    attachments.dispatchEvent(new Event("toggle"));
  });
  expect(request).not.toHaveBeenCalled();
  expect(container.querySelector("img")).toBeNull();
});
it.each(["whatsapp", "telegram"] as const)(
  "edits %s browser message attachments without losing draft content",
  async (platform) => {
    const value = { ...draft, media: [{ kind: "image" as const, uploadId: "old-image" }] };
    await mount(value, {
      accounts: [browserAccount(platform)],
      capabilities: { account: messagingMediaCapabilities },
    });
    await click("Edit");
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    await click("Remove attachments");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(request).toHaveBeenCalledWith("drafts.update", {
      id: "draft",
      text: draft.text,
      factIds: [],
      media: [],
    });
    expect(value.media).toEqual([{ kind: "image", uploadId: "old-image" }]);
  },
);
it.each(["whatsapp", "telegram"] as const)(
  "edits %s API media using current capabilities without browser-specific instructions",
  async (platform) => {
    await mount(
      { ...draft, media: [{ kind: "image", uploadId: "stored-image" }] },
      {
        accounts: [{ ...browserAccount(platform), connection: "oauth" }],
        capabilities: { account: messagingMediaCapabilities },
      },
    );
    await click("Edit");
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.textContent).toContain(
      `${platform === "whatsapp" ? "WhatsApp" : "Telegram"} attachments`,
    );
    expect(container.textContent).not.toContain("attached through the browser");
    await click("Remove attachments");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(request).toHaveBeenCalledWith("drafts.update", {
      id: "draft",
      text: draft.text,
      factIds: [],
      media: [],
    });
  },
);
it.each([browserAccount("x"), browserAccount("instagram"), browserAccount("whatsapp", false)])(
  "does not expose unsupported or disconnected browser message media for $platform",
  async (account) => {
    await mount(draft, {
      accounts: [account],
      capabilities: { account: messagingMediaCapabilities },
    });
    await click("Edit");
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(request).toHaveBeenCalledWith("drafts.update", {
      id: "draft",
      text: draft.text,
      factIds: [],
    });
  },
);
it("allows an approved API attachment draft to save with no caption", async () => {
  await mount(
    { ...draft, text: "", media: [{ kind: "image", uploadId: "stored-image" }] },
    {
      accounts: [{ ...browserAccount("telegram"), connection: "token" }],
      capabilities: { account: messagingMediaCapabilities },
    },
  );
  expect(container.textContent).not.toContain("Preparing draft");
  await click("Edit");
  expect(container.querySelector("textarea")?.required).toBe(false);
  const save = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ).find((button) => button.textContent?.includes("Save"));
  expect(save?.disabled).toBe(false);
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(request).toHaveBeenCalledWith("drafts.update", {
    id: "draft",
    text: "",
    factIds: [],
    media: [{ kind: "image", uploadId: "stored-image" }],
  });
});
it("counts API media captions in UTF-16 so emoji cannot bypass the provider limit", async () => {
  await mount(
    { ...draft, text: "🙂".repeat(513), media: [{ kind: "image", uploadId: "stored-image" }] },
    {
      accounts: [{ ...browserAccount("whatsapp"), connection: "token" }],
      capabilities: { account: messagingMediaCapabilities },
    },
  );
  await click("Edit");
  expect(container.textContent).toContain("1026 / 1024");
  const save = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ).find((button) => button.textContent?.includes("Save"));
  expect(save?.disabled).toBe(true);
  expect(container.textContent).toContain("MP4 up to 16 MiB");
  expect(container.textContent).not.toContain("tweet");
});
it("inceleme isteyen taslak düzenlenebilir; başarısız kaydetme editörü kapatmaz", async () => {
  await mount({ ...draft, reviewReason: "Metni inceleyin" });
  expect(
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith("Approve"),
    )?.disabled,
  ).toBe(true);
  await click("Edit");
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
  await click("Edit");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save changes",
    )?.disabled,
  ).toBe(true);
  await click("Remove fact links");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save changes",
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
      button.textContent?.startsWith("Approve"),
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
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit")
      ?.disabled,
  ).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it.each(["browser", "oauth"] as const)(
  "applies stored API reply deadlines only to API connections: %s",
  async (connection) => {
    await mount(
      { ...draft, kind: "reply", threadId: "thread" },
      {
        sendingEnabled: true,
        accounts: [{ ...browserAccount("instagram"), connection }],
        threads: [
          {
            id: "thread",
            accountId: "account",
            kind: "message",
            replyUntil: 1,
            replyAllowed: true,
          } as SocialSnapshot["threads"][number],
        ],
      },
    );
    const approve = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith("Approve"),
    )!;
    expect(approve.disabled).toBe(connection !== "browser");
    expect(
      container.textContent?.includes("The reply window for this conversation has expired."),
    ).toBe(connection !== "browser");
    expect(request).not.toHaveBeenCalled();
  },
);

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
    item.textContent?.startsWith("Approve"),
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(request).toHaveBeenCalledWith("policy.get", { accountId: "account" });
  expect(
    request.mock.calls.some((call) => call[0] === "drafts.approve" || call[0] === "messages.send"),
  ).toBe(false);
});

it.each([false, true])(
  "binds the pre-policy reviewed preview and stops sending if it changed: %s",
  async (replaceDuringPolicy) => {
    const preview = { ...draft, factIds: [...draft.factIds] };
    let finishPolicy!: (value: unknown) => void;
    let currentDraft = { ...preview };
    request.mockImplementation(async (action, input) => {
      if (action === "policy.get")
        return new Promise((resolve) => {
          finishPolicy = resolve;
        });
      if (
        action === "drafts.approve" &&
        JSON.stringify(input.reviewedDraft) !== JSON.stringify(currentDraft)
      )
        throw new Error("Draft preview changed. Refresh and review.");
      return currentDraft;
    });
    const snapshot = {
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
    };
    await mount(preview, snapshot);
    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.startsWith("Approve"),
    )!;
    await act(async () => button.click());
    expect(request).toHaveBeenCalledWith("policy.get", { accountId: "account" });
    if (replaceDuringPolicy) {
      currentDraft = { ...preview, text: "Unseen replacement B", contactId: "different-recipient" };
      await mount(currentDraft, snapshot);
    }
    await act(async () => finishPolicy({ effective: {} }));
    expect(request).toHaveBeenCalledWith("drafts.approve", {
      id: preview.id,
      reviewedDraft: preview,
    });
    expect(request.mock.calls.some((call) => call[0] === "messages.send")).toBe(
      !replaceDuringPolicy,
    );
  },
);
