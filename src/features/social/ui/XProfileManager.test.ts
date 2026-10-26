// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { XProfileManager } from "./XProfileManager";
import type { SocialClient } from "../model/socialClient";

it.each(["linkedin", "facebook", "instagram"] as const)(
  "edits %s Page branding through the owner profile route without exposing unsupported actions",
  async (platform) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    const profile = { name: "Bycoda", bio: "Open source", location: "", website: "" };
    const read = vi.fn(async () => profile);
    const update = vi.fn(async (_id, _platform, patch) => ({ ...profile, ...patch }));
    const upload = vi.fn(async () => ({ uploadId: "11111111-1111-4111-8111-111111111111" }));
    try {
      await act(async () =>
        root.render(
          createElement(XProfileManager, {
            accountId: "page",
            platform,
            accountName: "Bycoda",
            client: {
              browserProfileRead: read,
              browserProfileUpdate: update,
              upload,
            } as unknown as SocialClient,
          }),
        ),
      );
      expect(read).not.toHaveBeenCalled();
      await act(async () =>
        [...element.querySelectorAll("button")]
          .find((e) => e.textContent === "Read profile")!
          .click(),
      );
      expect(read).toHaveBeenCalledWith("page");
      expect(element.querySelectorAll('input[type="file"]')).toHaveLength(1);
      expect(element.querySelector("input[pattern]")).toBeNull();
      expect(element.textContent).not.toContain("Follow this account");
      expect(element.textContent).not.toContain("Cover image");
      if (platform === "linkedin") expect(element.querySelector("textarea")?.maxLength).toBe(120);
      else if (platform === "facebook") {
        expect(element.textContent).toContain("saving may also create a Page post");
        expect(element.querySelector("textarea")).toBeNull();
        expect(element.querySelector('input:not([type="file"])')).toBeNull();
      } else {
        expect(element.querySelector("textarea")?.maxLength).toBe(150);
        expect(element.querySelector('input:not([type="file"])')).toBeNull();
        expect(element.textContent).toContain("Synced profile photos require a separate review");
      }
      const fileInput = element.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(fileInput, "files", {
        value: [new File(["image"], "logo.png", { type: "image/png" })],
      });
      await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
      expect(update).not.toHaveBeenCalled();
      await act(async () =>
        element
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(update).toHaveBeenCalledWith("page", platform, {
        avatarUploadId: "11111111-1111-4111-8111-111111111111",
      });
      expect(element.textContent).toContain("verified by reading it back");
    } finally {
      await act(async () => root.unmount());
      element.remove();
      vi.unstubAllGlobals();
    }
  },
);

it("shows only the requested profile action pending, prevents repeated clicks, and permits recovery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let reject!: (error: Error) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue({ name: "bycoda", bio: "Draft", location: "", website: "" });
  try {
    await act(async () =>
      root.render(
        createElement(XProfileManager, {
          accountId: "account",
          client: { xProfileRead: read } as unknown as SocialClient,
        }),
      ),
    );
    const button = [...element.querySelectorAll("button")].find(
      (el) => el.textContent === "Read profile",
    )!;
    button.focus();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(element.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(element.querySelector<HTMLInputElement>("input[pattern]")!.disabled).toBe(true);
    await act(async () => reject(new Error("Fixture failure")));
    expect(element.querySelector('[role="alert"]')).toBeTruthy();
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    await act(async () => button.click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelector("textarea")?.value).toBe("Draft");
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
it("reads only on request, applies a public field diff and keeps exact follow actions separate", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const original = { name: "bycoda", bio: "Old", location: "", website: "" };
  const read = vi.fn(async () => original),
    update = vi.fn(async (_id, patch) => ({ ...original, ...patch })),
    follow = vi.fn(async (_id, handle) => ({ handle, changed: false }));
  try {
    await act(async () =>
      root.render(
        createElement(XProfileManager, {
          accountId: "account",
          client: {
            xProfileRead: read,
            xProfileUpdate: update,
            xProfileFollow: follow,
          } as unknown as SocialClient,
        }),
      ),
    );
    expect(read).not.toHaveBeenCalled();
    const click = async (text: string) =>
      act(async () =>
        [...element.querySelectorAll("button")].find((el) => el.textContent === text)!.click(),
      );
    await click("Read profile");
    expect(read).toHaveBeenCalledWith("account");
    const bio = element.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        bio,
        "New",
      );
      bio.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      element
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(update).toHaveBeenCalledWith("account", { bio: "New" });
    expect(element.textContent).toContain("verified by reading it back");
    expect(follow).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
