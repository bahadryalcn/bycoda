// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxAvatar } from "./InboxPresentation";
import { fetchInboxMedia } from "../model/inboxMedia";
import { inboxAvatarColor } from "../model/inboxAvatar";

vi.mock("../model/inboxMedia", () => ({
  fetchInboxMedia: vi.fn(),
  sniffInboxMedia: () => ({ kind: "image", mime: "image/png" }),
}));

it("loads private Jira pictures through media, falls back on decode failure, and revokes blobs", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:jira-avatar");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.mocked(fetchInboxMedia).mockResolvedValue(new Uint8Array([1, 2, 3]));
  const container = document.createElement("div");
  const root = createRoot(container);
  const avatarUrl = "https://acme.atlassian.net/secure/useravatar?avatarId=42";
  try {
    await act(async () => root.render(createElement(InboxAvatar, { name: "Ada", avatarUrl })));
    expect(fetchInboxMedia).toHaveBeenCalledWith(avatarUrl);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:jira-avatar");
    act(() => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("A");
    expect(container.querySelector("span")?.style.getPropertyValue("--inbox-avatar-color")).toBe(
      inboxAvatarColor("Ada"),
    );
  } finally {
    act(() => root.unmount());
    expect(revoke).toHaveBeenCalledWith("blob:jira-avatar");
    create.mockRestore();
    revoke.mockRestore();
  }
});

it("keeps the colored initial when authenticated loading fails", async () => {
  vi.mocked(fetchInboxMedia).mockRejectedValue(new Error("Media request failed (401)"));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(InboxAvatar, {
          name: "Utku",
          avatarUrl: "https://acme.atlassian.net/secure/useravatar?avatarId=7",
        }),
      ),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("U");
  } finally {
    act(() => root.unmount());
  }
});

it("ignores an obsolete authenticated avatar response after identity changes", async () => {
  let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
  vi.mocked(fetchInboxMedia).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const create = vi.spyOn(URL, "createObjectURL");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(InboxAvatar, {
          name: "Ada",
          avatarUrl: "https://acme.atlassian.net/secure/useravatar?avatarId=1",
        }),
      ),
    );
    await act(async () =>
      root.render(
        createElement(InboxAvatar, { name: "Bob", avatarUrl: "https://example.com/bob.png" }),
      ),
    );
    await act(async () => finish(new Uint8Array([1, 2, 3])));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/bob.png");
    expect(create).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    create.mockRestore();
  }
});
