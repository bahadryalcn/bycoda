// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { XProfileManager } from "./XProfileManager";
import type { SocialClient } from "../model/socialClient";
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
