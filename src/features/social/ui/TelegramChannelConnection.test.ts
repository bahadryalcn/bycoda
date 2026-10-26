// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TelegramChannelConnection } from "./TelegramChannelConnection";
import type { SocialAccount, SocialTelegramChannelReview } from "../model/social";
import type { SocialClient } from "../model/socialClient";

let element: HTMLDivElement, root: Root;
const inspect = vi.fn(),
  connect = vi.fn(),
  refresh = vi.fn();
const client = { tokenInspect: inspect, tokenConnect: connect } as unknown as SocialClient;
const account = {
  id: "channel",
  platform: "telegram",
  platformId: "",
  name: "Bycoda channel",
  accountType: "channel",
  connection: "token",
  connected: false,
  executorId: "host",
} as SocialAccount;
const reviewed = (): SocialTelegramChannelReview => ({
  reviewId: "opaque-channel-review",
  expiresAt: Date.now() + 60_000,
  channelId: "-1001234567890",
  channelName: "Bycoda announcements",
  username: "bycodaofficial",
  botId: "12345678",
  botName: "Bycoda publisher",
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  inspect.mockReset().mockImplementation(async () => reviewed());
  connect.mockReset().mockResolvedValue(undefined);
  refresh.mockReset().mockResolvedValue(undefined);
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
const render = async (selected = account) =>
  act(async () =>
    root.render(
      createElement(TelegramChannelConnection, { account: selected, client, onRefresh: refresh }),
    ),
  );
const button = (name: string) =>
  [...element.querySelectorAll("button")].find((el) => el.textContent === name);
const click = async (name: string) => act(async () => button(name)!.click());
async function target(value: string) {
  const input = element.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function review() {
  await target("@bycodaofficial");
  await click("Inspect channel and bot");
}

it("requires inspection and explicit connection of the exact reviewed channel and bot without a token input", async () => {
  await render();
  expect(element.querySelector('input[type="password"]')).toBeNull();
  expect(element.querySelectorAll("input")).toHaveLength(1);
  expect(button("Connect reviewed channel")).toBeUndefined();
  await review();
  expect(inspect).toHaveBeenCalledWith("channel", "@bycodaofficial");
  expect(element.textContent).toContain("Bycoda announcements (-1001234567890)");
  expect(element.textContent).toContain("Bycoda publisher (12345678)");
  expect(connect).not.toHaveBeenCalled();
  await click("Connect reviewed channel");
  expect(connect).toHaveBeenCalledExactlyOnceWith("channel", "opaque-channel-review");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(button("Connect reviewed channel")).toBeUndefined();
});
it("invalidates an inspected target when it is retargeted and sends only the opaque review ID to connect", async () => {
  await render();
  await review();
  await target("@anotherchannel");
  expect(button("Connect reviewed channel")).toBeUndefined();
  expect(connect).not.toHaveBeenCalled();
  inspect.mockResolvedValueOnce({
    ...reviewed(),
    reviewId: "new-review",
    channelId: "-1009999999999",
    channelName: "Another reviewed channel",
  });
  await click("Inspect channel and bot");
  expect(element.textContent).toContain("Another reviewed channel (-1009999999999)");
  await click("Connect reviewed channel");
  expect(connect).toHaveBeenCalledExactlyOnceWith("channel", "new-review");
});
it.each([
  { executorId: "other-host" },
  { connected: true, platformId: "-1009999999999" },
  { telegramBotId: "another-bot" },
])("invalidates the review when connected identity or executor changes: %j", async (patch) => {
  await render();
  await review();
  await render({ ...account, ...patch } as SocialAccount);
  expect(button("Connect reviewed channel")).toBeUndefined();
  expect(connect).not.toHaveBeenCalled();
});
it("does not surface a delayed inspection for an account that is no longer selected", async () => {
  let resolve!: (value: SocialTelegramChannelReview) => void;
  inspect.mockImplementationOnce(
    () =>
      new Promise<SocialTelegramChannelReview>((done) => {
        resolve = done;
      }),
  );
  await render();
  await target("@bycodaofficial");
  await click("Inspect channel and bot");
  await render({ ...account, id: "new-channel" });
  await act(async () => resolve(reviewed()));
  expect(element.textContent).not.toContain("Bycoda announcements");
  expect(button("Connect reviewed channel")).toBeUndefined();
});
it("prevents duplicate inspection and connection while their individual operations are pending", async () => {
  let inspectDone!: (value: SocialTelegramChannelReview) => void, connectDone!: () => void;
  inspect.mockImplementationOnce(
    () =>
      new Promise<SocialTelegramChannelReview>((done) => {
        inspectDone = done;
      }),
  );
  connect.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        connectDone = done;
      }),
  );
  await render();
  await target("@bycodaofficial");
  await act(async () => {
    button("Inspect channel and bot")!.click();
    button("Inspect channel and bot")!.click();
  });
  expect(inspect).toHaveBeenCalledTimes(1);
  await act(async () => inspectDone(reviewed()));
  await act(async () => {
    button("Connect reviewed channel")!.click();
    button("Connect reviewed channel")?.click();
  });
  expect(connect).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => connectDone());
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("expires an idle review and never connects after its expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  inspect.mockResolvedValueOnce({ ...reviewed(), expiresAt: Date.now() + 1000 });
  await render();
  await review();
  expect(button("Connect reviewed channel")?.disabled).toBe(false);
  await act(async () => vi.advanceTimersByTime(1001));
  const expired = button("Connect reviewed channel");
  expect(!expired || expired.disabled).toBe(true);
  await act(async () => expired?.click());
  expect(connect).not.toHaveBeenCalled();
});
it("does not optimistically grant channel access when the Host rejects a stale or mismatched review", async () => {
  connect.mockRejectedValueOnce(new Error("Channel ownership or posting rights changed"));
  await render();
  await review();
  await click("Connect reviewed channel");
  expect(refresh).not.toHaveBeenCalled();
  expect(account.connected).toBe(false);
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  expect(button("Connect reviewed channel")).toBeUndefined();
  expect(button("Inspect channel and bot")).toBeDefined();
});
