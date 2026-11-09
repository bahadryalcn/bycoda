// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { TelegramChannelConnect } from "./TelegramChannelConnect";

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

const account = {
  id: "t1",
  platform: "telegram",
  platformId: "",
  connected: false,
} as unknown as SocialAccount;
const review = {
  reviewId: "review-1",
  expiresAt: Date.now() + 600_000,
  channelId: "-1001",
  channelName: "Launch",
  botId: "9",
  botName: "bycoda_bot",
};

function button(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === text);
}

it("has no token field and connects only the reviewed channel by its opaque review id", async () => {
  const tokenInspect = vi.fn(async () => review);
  const tokenConnect = vi.fn(async () => ({}));
  const onRefresh = vi.fn();
  const client = { tokenInspect, tokenConnect } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(TelegramChannelConnect, { client, account, disabled: false, onRefresh }),
    ),
  );
  expect(element.querySelector('input[type="password"]')).toBeNull();
  const input = element.querySelector<HTMLInputElement>("input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, "@launch");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Inspect channel and bot")?.click());
  expect(tokenInspect).toHaveBeenCalledWith("t1", "@launch");
  await act(async () => button("Connect reviewed channel")?.click());
  expect(tokenConnect).toHaveBeenCalledWith("t1", "review-1");
  expect(onRefresh).toHaveBeenCalled();
});

function mount(
  client: Record<string, unknown>,
  patch: Partial<SocialAccount> = {},
  disabled = false,
) {
  const onRefresh = vi.fn();
  act(() =>
    root.render(
      createElement(TelegramChannelConnect, {
        client: client as unknown as SocialClient,
        account: { ...account, ...patch } as SocialAccount,
        disabled,
        onRefresh,
      }),
    ),
  );
  return onRefresh;
}

function typeTarget(value: string) {
  const input = element.querySelector<HTMLInputElement>("input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function inspected(client: Record<string, unknown>, patch: Partial<SocialAccount> = {}) {
  const onRefresh = mount(client, patch);
  typeTarget("@launch");
  await act(async () => button("Inspect channel and bot")?.click());
  return onRefresh;
}

it("shows the reviewed channel and bot and connects nothing until the owner confirms", async () => {
  const tokenConnect = vi.fn(async () => ({}));
  await inspected({ tokenInspect: vi.fn(async () => review), tokenConnect });
  expect(button("Connect reviewed channel")).toBeTruthy();
  expect(element.textContent).toContain("Launch (-1001)");
  expect(element.textContent).toContain("bycoda_bot (9)");
  expect(tokenConnect).not.toHaveBeenCalled();
});

it("offers Inspect only once a channel is entered", () => {
  mount({ tokenInspect: vi.fn(), tokenConnect: vi.fn() });
  expect(button("Inspect channel and bot")?.disabled).toBe(true);
  expect(button("Connect reviewed channel")).toBeUndefined();
  typeTarget("   ");
  expect(button("Inspect channel and bot")?.disabled).toBe(true);
});

it("drops the review when the target is changed and connects only the newly inspected channel", async () => {
  const tokenInspect = vi
    .fn()
    .mockResolvedValueOnce(review)
    .mockResolvedValueOnce({
      ...review,
      reviewId: "review-2",
      channelId: "-1002",
      channelName: "Other",
    });
  const tokenConnect = vi.fn(async () => ({}));
  await inspected({ tokenInspect, tokenConnect });
  typeTarget("@other");
  expect(button("Connect reviewed channel")).toBeUndefined();
  expect(tokenConnect).not.toHaveBeenCalled();
  await act(async () => button("Inspect channel and bot")?.click());
  expect(tokenInspect).toHaveBeenLastCalledWith("t1", "@other");
  await act(async () => button("Connect reviewed channel")?.click());
  expect(tokenConnect).toHaveBeenCalledExactlyOnceWith("t1", "review-2");
});

it("does not mark the channel connected when the Host rejects a stale or mismatched review", async () => {
  const tokenConnect = vi.fn(async () => {
    throw new Error("Channel ownership or posting rights changed");
  });
  const onRefresh = await inspected({ tokenInspect: vi.fn(async () => review), tokenConnect });
  await act(async () => button("Connect reviewed channel")?.click());
  expect(onRefresh).not.toHaveBeenCalled();
  expect(element.textContent).toContain("The channel could not be verified.");
  // The review is spent: connecting again needs a fresh inspection.
  expect(button("Connect reviewed channel")).toBeUndefined();
  expect(button("Inspect channel and bot")?.disabled).toBe(false);
});

it("says so and offers no connection when the channel cannot be inspected", async () => {
  const tokenInspect = vi.fn(async () => {
    throw new Error("The bot is not an administrator.");
  });
  await inspected({ tokenInspect, tokenConnect: vi.fn() });
  expect(element.textContent).toContain("The channel could not be verified.");
  expect(button("Connect reviewed channel")).toBeUndefined();
});

it("sends only one inspection and one connection when a button is pressed twice", async () => {
  let finishInspect!: (value: typeof review) => void;
  let finishConnect!: () => void;
  const tokenInspect = vi.fn(
    () =>
      new Promise<typeof review>((resolve) => {
        finishInspect = resolve;
      }),
  );
  const tokenConnect = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishConnect = resolve;
      }),
  );
  const onRefresh = mount({ tokenInspect, tokenConnect });
  typeTarget("@launch");
  await act(async () => {
    button("Inspect channel and bot")?.click();
    button("Inspect channel and bot")?.click();
  });
  expect(tokenInspect).toHaveBeenCalledTimes(1);
  await act(async () => finishInspect(review));
  await act(async () => {
    button("Connect reviewed channel")?.click();
    button("Connect reviewed channel")?.click();
  });
  expect(tokenConnect).toHaveBeenCalledTimes(1);
  expect(onRefresh).not.toHaveBeenCalled();
  await act(async () => finishConnect());
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it("expires an idle review and never connects with it afterwards", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const tokenConnect = vi.fn(async () => ({}));
    const tokenInspect = vi.fn(async () => ({ ...review, expiresAt: Date.now() + 1000 }));
    await inspected({ tokenInspect, tokenConnect });
    expect(button("Connect reviewed channel")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1001));
    expect(button("Connect reviewed channel")).toBeUndefined();
    expect(element.textContent).toContain(
      "The channel review expired. Inspect it again before connecting.",
    );
    expect(tokenConnect).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("refuses a connection whose deadline passed even before the expiry timer ran", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const tokenConnect = vi.fn(async () => ({}));
    const tokenInspect = vi.fn(async () => ({ ...review, expiresAt: Date.now() + 1000 }));
    const onRefresh = await inspected({ tokenInspect, tokenConnect });
    // The clock moves past the deadline without the timer callback running yet.
    vi.setSystemTime(new Date("2026-11-07T12:00:02Z"));
    await act(async () => button("Connect reviewed channel")?.click());
    expect(tokenConnect).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(element.textContent).toContain(
      "The channel review expired. Inspect it again before connecting.",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("starts from the connected channel and says Reconnect for an account that is already connected", async () => {
  const tokenConnect = vi.fn(async () => ({}));
  mount(
    { tokenInspect: vi.fn(async () => review), tokenConnect },
    { connected: true, platformId: "-1001" },
  );
  expect(element.querySelector<HTMLInputElement>("input")?.value).toBe("-1001");
  await act(async () => button("Inspect channel and bot")?.click());
  expect(button("Reconnect reviewed channel")).toBeTruthy();
  expect(button("Connect reviewed channel")).toBeUndefined();
});

it("keeps private messages and monitoring apart from channel publishing in its wording", async () => {
  await inspected({ tokenInspect: vi.fn(async () => review), tokenConnect: vi.fn() });
  expect(element.textContent).toContain(
    "This connection publishes to the reviewed channel. Private messages and channel monitoring stay separate.",
  );
});

it("locks the field and the inspection while the Host is offline", () => {
  const tokenInspect = vi.fn();
  mount({ tokenInspect, tokenConnect: vi.fn() }, {}, true);
  expect(element.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
  expect(button("Inspect channel and bot")?.disabled).toBe(true);
  expect(tokenInspect).not.toHaveBeenCalled();
});

it("drops the reviewed channel when the owner switches to another account", async () => {
  const client = { tokenInspect: vi.fn(async () => review), tokenConnect: vi.fn(async () => ({})) };
  mount(client);
  typeTarget("@launch");
  await act(async () => button("Inspect channel and bot")?.click());
  expect(button("Connect reviewed channel")).toBeDefined();
  mount(client, { id: "t2" });
  expect(button("Connect reviewed channel")).toBeUndefined();
  expect(element.textContent).not.toContain("Launch");
});
