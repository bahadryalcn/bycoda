// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NeedsHumanItem } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { NeedsHumanList } from "./NeedsHumanList";

/**
 * Safety contract of recognised blocking screens (CAPTCHA, "I am not a robot", SMS or email
 * verification, suspicious sign-in): the app only recognises them. The list shows a human-needed
 * state and the owner decides; nothing resolves, types or clicks on its own.
 */

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const REASONS = [
  ["challenge", "Security check"],
  ["verification", "Verification code"],
  ["login", "Sign-in needed"],
  ["unexpected_screen", "Unexpected page"],
] as const;

function waiting(
  id: string,
  reason: NeedsHumanItem["reason"],
  accountId = `acc-${id}`,
): NeedsHumanItem {
  return { id, accountId, platform: "instagram", reason, at: 1 };
}

function clientWith(items: NeedsHumanItem[]) {
  const list = vi.fn(async () => ({ items }));
  const resolve = vi.fn(async () => undefined);
  const browserViewFrame = vi.fn(async () => ({ jpegBase64: "QUFB", width: 10, height: 10 }));
  const browserViewInput = vi.fn(async () => undefined);
  const client = {
    browser: { needsHuman: { list, resolve } },
    browserViewFrame,
    browserViewInput,
  } as unknown as SocialClient;
  return { client, list, resolve, browserViewFrame, browserViewInput };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function mount(client: SocialClient, active = true) {
  await act(async () => {
    root.render(createElement(NeedsHumanList, { client, machineId: "m", active }));
  });
  await settle();
}

function buttons(text: string): HTMLButtonElement[] {
  return [...element.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    button.textContent?.includes(text),
  );
}

function isBlocked(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute("aria-disabled") === "true";
}

it.each(REASONS)(
  "shows a human-needed state for a recognised %s screen without raw codes",
  async (reason, label) => {
    const { client } = clientWith([waiting("n1", reason)]);
    await mount(client);
    expect(element.textContent).toContain("Instagram");
    expect(element.textContent).toContain(label);
    expect(element.textContent).not.toContain(reason);
    expect(buttons("Open live view")).toHaveLength(1);
    expect(buttons("I'm done")).toHaveLength(1);
    expect(element.textContent).not.toContain("Nothing is waiting for you.");
  },
);

it("never resolves, types or clicks by itself while the owner has not acted", async () => {
  const items = REASONS.map(([reason], index) => waiting(`n${index}`, reason));
  const { client, list, resolve, browserViewFrame, browserViewInput } = clientWith(items);
  await mount(client);
  await advance(60_000);
  expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(resolve).not.toHaveBeenCalled();
  expect(browserViewInput).not.toHaveBeenCalled();
  expect(browserViewFrame).not.toHaveBeenCalled();
  expect(buttons("I'm done")).toHaveLength(4);
});

it("resolves only the item whose I'm done button the owner pressed", async () => {
  const { client, resolve } = clientWith([
    waiting("first", "challenge"),
    waiting("second", "verification"),
  ]);
  await mount(client);
  await act(async () => buttons("I'm done")[1]!.click());
  await settle();
  expect(resolve).toHaveBeenCalledExactlyOnceWith("second");
});

it("blocks a second I'm done press while the first is still pending", async () => {
  const { client, resolve } = clientWith([waiting("n1", "challenge")]);
  let finish!: () => void;
  resolve.mockImplementation(
    () =>
      new Promise<undefined>((done) => {
        finish = () => done(undefined);
      }),
  );
  await mount(client);
  await act(async () => buttons("I'm done")[0]!.click());
  expect(isBlocked(buttons("I'm done")[0]!)).toBe(true);
  await act(async () => buttons("I'm done")[0]!.click());
  expect(resolve).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await settle();
});

it("removes the item after the owner confirms and the Host no longer lists it", async () => {
  const { client, list } = clientWith([waiting("n1", "challenge")]);
  list
    .mockResolvedValueOnce({ items: [waiting("n1", "challenge")] })
    .mockResolvedValue({ items: [] });
  await mount(client);
  await act(async () => buttons("I'm done")[0]!.click());
  await settle();
  expect(element.textContent).toContain("Nothing is waiting for you.");
  expect(buttons("I'm done")).toHaveLength(0);
});

it("keeps the item listed and shows a failure when the Host rejects I'm done", async () => {
  const { client, resolve } = clientWith([waiting("n1", "verification")]);
  resolve.mockRejectedValue(new Error("offline"));
  await mount(client);
  await act(async () => buttons("I'm done")[0]!.click());
  await settle();
  expect(element.textContent).toContain("Verification code");
  expect(buttons("I'm done")).toHaveLength(1);
  expect(isBlocked(buttons("I'm done")[0]!)).toBe(false);
  expect(element.textContent).toContain("Could not mark this as done.");
  expect(element.textContent).not.toContain("Waiting items could not be");
  expect(element.textContent).not.toContain("Nothing is waiting for you.");
});

it("keeps the last known items and warns when a later refresh fails", async () => {
  const { client, list } = clientWith([waiting("n1", "login")]);
  list
    .mockResolvedValueOnce({ items: [waiting("n1", "login")] })
    .mockRejectedValue(new Error("offline"));
  await mount(client);
  await advance(15_000);
  expect(element.textContent).toContain("Sign-in needed");
  expect(element.textContent).toContain("Waiting items could not be refreshed.");
});

it("does not report an empty queue when the first read fails", async () => {
  const { client, list } = clientWith([]);
  list.mockRejectedValue(new Error("offline"));
  await mount(client);
  expect(element.textContent).toContain("Waiting items could not be loaded.");
  expect(element.textContent).not.toContain("Nothing is waiting for you.");
});

it("shows a loading state until the first read returns", async () => {
  const { client, list } = clientWith([]);
  list.mockImplementation(() => new Promise(() => undefined));
  await mount(client);
  expect(element.textContent).toContain("Loading…");
  expect(element.textContent).not.toContain("Nothing is waiting for you.");
});

it("pauses polling while the screen is hidden and resumes when it is active again", async () => {
  const { client, list } = clientWith([waiting("n1", "challenge")]);
  await mount(client, false);
  await advance(60_000);
  expect(list).not.toHaveBeenCalled();
  await mount(client, true);
  expect(list).toHaveBeenCalledTimes(1);
  await mount(client, false);
  const calls = list.mock.calls.length;
  await advance(60_000);
  expect(list.mock.calls.length).toBe(calls);
});

it("opens the live view for the chosen account only, without resolving or sending input", async () => {
  const { client, resolve, browserViewFrame, browserViewInput } = clientWith([
    waiting("n1", "challenge", "acc-one"),
    waiting("n2", "verification", "acc-two"),
  ]);
  await mount(client);
  expect(element.querySelector('section[aria-label="Live browser view"]')).toBeNull();
  await act(async () => buttons("Open live view")[1]!.click());
  await settle();
  expect(element.querySelector('section[aria-label="Live browser view"]')).not.toBeNull();
  expect(browserViewFrame).toHaveBeenCalledWith("acc-two");
  expect(browserViewFrame).not.toHaveBeenCalledWith("acc-one");
  expect(resolve).not.toHaveBeenCalled();
  expect(browserViewInput).not.toHaveBeenCalled();
});

it("stops requesting frames once the owner closes the live view and leaves the item waiting", async () => {
  const { client, resolve, browserViewFrame, browserViewInput } = clientWith([
    waiting("n1", "challenge"),
  ]);
  await mount(client);
  await act(async () => buttons("Open live view")[0]!.click());
  await settle();
  await act(async () => buttons("Close view")[0]!.click());
  await settle();
  expect(element.querySelector('section[aria-label="Live browser view"]')).toBeNull();
  const frames = browserViewFrame.mock.calls.length;
  await advance(5_000);
  expect(browserViewFrame.mock.calls.length).toBe(frames);
  expect(resolve).not.toHaveBeenCalled();
  expect(browserViewInput).not.toHaveBeenCalled();
  expect(buttons("I'm done")).toHaveLength(1);
});
