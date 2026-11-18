// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LINKEDIN_LIVE_CONFIRM,
  LINKEDIN_LIVE_STUDIO,
} from "../../../../integrations/social/live-linkedin";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { LinkedInLive } from "./LinkedInLive";

const streamKey = "fixture-key";
const streamUrl = "rtmps://live-ingest.linkedin.com:443/path";
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

const fixtureAccount: SocialAccount = {
  id: "account-1",
  platform: "linkedin",
  platformId: "urn:li:organization:890",
  accountType: "organization",
  connection: "oauth",
  name: "Example",
  connected: true,
  scopes: [],
  paused: false,
  accessApproved: true,
  executorId: "host",
  grants: {},
  createdAt: 0,
};

function render(request: SocialClient["request"], account = fixtureAccount) {
  act(() =>
    root.render(
      createElement(LinkedInLive, {
        client: { request } as SocialClient,
        account,
        disabled: false,
      }),
    ),
  );
}

function enter(name: string, value: string) {
  const field = element.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  field.value = value;
  return field;
}

it("masks both credential values and clears input after confirmed vault custody", async () => {
  const request = vi.fn(async () => ({
    state: "stored",
    eventId: "124",
    studioUrl: LINKEDIN_LIVE_STUDIO,
    storedAt: 0,
  })) as unknown as SocialClient["request"];
  render(request);
  enter("eventId", "124");
  const url = enter("streamUrl", streamUrl);
  const key = enter("streamKey", streamKey);
  expect(url.type).toBe("password");
  expect(key.type).toBe("password");
  await act(async () => element.querySelector("form")!.requestSubmit());
  expect(request).toHaveBeenCalledWith("linkedin.live.credentials.save", {
    accountId: "account-1",
    eventId: "124",
    streamUrl,
    streamKey,
    confirm: LINKEDIN_LIVE_CONFIRM,
  });
  expect([url.value, key.value]).toEqual(["", ""]);
  expect(element.textContent).toContain("Credentials stored for event 124.");
  expect(element.textContent).not.toContain(streamKey);
});

it("isolates drafts by connected identity and does not echo secret-bearing errors", async () => {
  const request = vi.fn(async () => {
    throw new Error(streamKey);
  }) as unknown as SocialClient["request"];
  render(request);
  enter("eventId", "124");
  enter("streamUrl", streamUrl);
  const key = enter("streamKey", streamKey);
  await act(async () => element.querySelector("form")!.requestSubmit());
  expect(element.textContent).toContain("Could not save LinkedIn Live credentials.");
  expect(element.textContent).not.toContain(streamKey);
  expect(key.value).toBe(streamKey);
  render(request, { ...fixtureAccount, platformId: "urn:li:organization:891" });
  expect(element.querySelector<HTMLInputElement>('input[name="streamKey"]')?.value).toBe("");
});
