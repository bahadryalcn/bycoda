// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { XProfileState } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { XProfileEditor } from "./XProfileEditor";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const profile: XProfileState = { name: "Studio", bio: "Hello", location: "", website: "" };

function button(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === text);
}

it("reads the profile only when asked", async () => {
  const xProfileRead = vi.fn(async () => profile);
  const client = { xProfileRead, xProfileUpdate: vi.fn() } as unknown as SocialClient;
  act(() =>
    root.render(createElement(XProfileEditor, { client, accountId: "a1", accountName: "Studio" })),
  );
  expect(xProfileRead).not.toHaveBeenCalled();
  await act(async () => button("Read profile")?.click());
  expect(xProfileRead).toHaveBeenCalledWith("a1");
});

it("saves only the fields that changed, with the read-back of the Host", async () => {
  const xProfileUpdate = vi.fn(async () => ({ ...profile, location: "Istanbul" }));
  const client = {
    xProfileRead: vi.fn(async () => profile),
    xProfileUpdate,
  } as unknown as SocialClient;
  act(() =>
    root.render(createElement(XProfileEditor, { client, accountId: "a1", accountName: "Studio" })),
  );
  await act(async () => button("Read profile")?.click());
  const location =
    element.querySelector<HTMLInputElement>(
      'input[aria-label="Location"], input[name="location"]',
    ) ??
    [...element.querySelectorAll<HTMLInputElement>("input")].find((input) =>
      input.parentElement?.textContent?.includes("Location"),
    );
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(location, "Istanbul");
    location?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(xProfileUpdate).toHaveBeenCalledWith("a1", { location: "Istanbul" });
});

function mount(client: Record<string, unknown>) {
  act(() =>
    root.render(
      createElement(XProfileEditor, {
        client: client as unknown as SocialClient,
        accountId: "a1",
        accountName: "Studio",
      }),
    ),
  );
}

function control(label: string) {
  const owner = [...element.querySelectorAll("label")].find((node) =>
    node.textContent?.trim().startsWith(label),
  );
  expect(owner, `Missing field: ${label}`).toBeTruthy();
  return document.getElementById(owner?.htmlFor ?? "") as HTMLInputElement | HTMLTextAreaElement;
}

function typeInto(label: string, value: string) {
  const target = control(label);
  const prototype =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const submitProfile = () =>
  act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

const reasons = () =>
  [...element.querySelectorAll(".social-disabled-reason-text")].map((node) => node.textContent);

it("sends one read for a double press and offers a retry after a failed read", async () => {
  let fail!: (error: Error) => void;
  const xProfileRead = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue({ ...profile, bio: "Draft" });
  mount({ xProfileRead });
  await act(async () => {
    button("Read profile")?.click();
    button("Read profile")?.click();
  });
  expect(xProfileRead).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("The profile page did not load.")));
  expect(element.textContent).toContain("The profile page did not load.");
  expect(element.querySelector("form")).toBeNull();
  await act(async () => button("Read profile")?.click());
  expect(xProfileRead).toHaveBeenCalledTimes(2);
  expect(control("About").value).toBe("Draft");
});

it("blocks saving until something changed and says why, then until a name is entered", async () => {
  mount({ xProfileRead: vi.fn(async () => profile), xProfileUpdate: vi.fn() });
  await act(async () => button("Read profile")?.click());
  expect(button("Save profile")?.disabled).toBe(true);
  expect(reasons()).toContain("No changes to save.");
  typeInto("Profile name", "   ");
  expect(reasons()).toContain("Enter a profile name.");
});

it("does not send a save for an unchanged profile even when the form is submitted", async () => {
  const xProfileUpdate = vi.fn();
  mount({ xProfileRead: vi.fn(async () => profile), xProfileUpdate });
  await act(async () => button("Read profile")?.click());
  await submitProfile();
  expect(xProfileUpdate).not.toHaveBeenCalled();
});

it("shows what the Host read back after a save and treats it as the new saved profile", async () => {
  const xProfileUpdate = vi.fn(async () => ({ ...profile, name: "Studio Official" }));
  mount({ xProfileRead: vi.fn(async () => profile), xProfileUpdate });
  await act(async () => button("Read profile")?.click());
  typeInto("Profile name", "studio official");
  await submitProfile();
  expect(xProfileUpdate).toHaveBeenCalledExactlyOnceWith("a1", { name: "studio official" });
  expect(control("Profile name").value).toBe("Studio Official");
  expect(reasons()).toContain("No changes to save.");
});

it("keeps the owner's edits and shows the failure when the profile cannot be verified", async () => {
  const xProfileUpdate = vi.fn(async () => {
    throw new Error("The new bio was not found when the profile was read back.");
  });
  mount({ xProfileRead: vi.fn(async () => profile), xProfileUpdate });
  await act(async () => button("Read profile")?.click());
  typeInto("About", "Changed bio");
  await submitProfile();
  expect(element.textContent).toContain(
    "The new bio was not found when the profile was read back.",
  );
  expect(control("About").value).toBe("Changed bio");
  expect(button("Save profile")?.disabled).toBe(false);
});

it("follows an exact username on its own action, without touching the profile", async () => {
  const xProfileFollow = vi.fn(async (_id: string, handle: string) => ({
    handle,
    platformId: "42",
    following: true,
    changed: true,
  }));
  const xProfileUpdate = vi.fn();
  mount({ xProfileRead: vi.fn(async () => profile), xProfileUpdate, xProfileFollow });
  expect(button("Follow")?.disabled).toBe(true);
  expect(reasons()).toContain("Enter an X username of 1 to 15 letters, digits or underscores.");
  typeInto("X username to follow", "@bycoda");
  expect(button("Follow")?.disabled).toBe(false);
  await act(async () => button("Follow")?.click());
  expect(xProfileFollow).toHaveBeenCalledExactlyOnceWith("a1", "bycoda");
  expect(element.textContent).toContain("Following @bycoda");
  expect(xProfileUpdate).not.toHaveBeenCalled();
});

it("refuses a username that is not an X handle without sending it", async () => {
  const xProfileFollow = vi.fn();
  mount({ xProfileRead: vi.fn(), xProfileFollow });
  typeInto("X username to follow", "not a handle!");
  expect(button("Follow")?.disabled).toBe(true);
  await act(async () => button("Follow")?.click());
  expect(xProfileFollow).not.toHaveBeenCalled();
});
