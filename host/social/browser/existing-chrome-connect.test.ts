import { expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../src/features/social/model/social";
import type { SocialService } from "../social";
import type { ExistingChromeBindings } from "./existing-chrome-bindings";
import { connectExistingChrome } from "./existing-chrome-connect";

function fixture(savedId = "") {
  const account = {
    id: "account",
    platform: "x",
    platformId: savedId,
    connection: "browser",
    accountType: "member",
    executorId: "host",
  } as SocialAccount;
  const close = vi.fn(async () => {});
  const page = {
    goto: vi.fn(async () => {}),
    cookies: vi.fn(async () => [
      { name: "auth_token", value: "private" },
      { name: "twid", value: "u=42" },
    ]),
    evaluate: vi.fn(async (expression: string) =>
      expression.includes("AppTabBar_Profile_Link") ? "/owner" : undefined,
    ),
  };
  const bindings = {
    openSelection: vi.fn(async () => ({ page, close })),
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  };
  const connectAccount = vi.fn(
    async (_id: string, _identity: unknown, _credential: unknown, before?: () => Promise<void>) => {
      await before?.();
      return account;
    },
  );
  const service = {
    store: { environmentId: "host" },
    connectionReviewEpoch: vi.fn(async () => "original"),
    accountForOAuth: vi.fn(async () => account),
    connectAccount,
  } as unknown as SocialService;
  const input = {
    service,
    principal: { kind: "owner", actorId: "owner", provider: "owner" } as const,
    account,
    targetId: "selected",
    bindings: bindings as unknown as ExistingChromeBindings,
    recipes: [],
    directory: "unused",
    wait: vi.fn(async () => {}),
  };
  return { input, bindings, page, close, connectAccount, service };
}

it("verifies observed identity and persists only account binding before enabling the connection", async () => {
  const f = fixture();
  expect(await connectExistingChrome(f.input)).toMatchObject({
    status: "connected",
    source: "existing-chrome",
  });
  expect(f.bindings.set).toHaveBeenCalledExactlyOnceWith("account", {
    platform: "x",
    targetId: "selected",
  });
  expect(f.connectAccount).toHaveBeenCalledWith(
    "account",
    expect.objectContaining({ platformId: "42", name: "@owner", connection: "browser" }),
    { accessToken: "browser-session" },
    expect.any(Function),
  );
  expect(f.close).toHaveBeenCalledOnce();
});
it("refuses a different saved identity without persisting the selected tab", async () => {
  const f = fixture("99");
  await expect(connectExistingChrome(f.input)).rejects.toThrow("differs");
  expect(f.connectAccount).not.toHaveBeenCalled();
  expect(f.bindings.set).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});
it("does not connect from cookies without an authenticated page and bounds the identity probe", async () => {
  const f = fixture();
  f.page.evaluate.mockResolvedValue(undefined);
  await expect(connectExistingChrome(f.input)).rejects.toThrow("could not be verified");
  expect(f.input.wait).toHaveBeenCalledTimes(60);
  expect(f.connectAccount).not.toHaveBeenCalled();
});
it("restores prior binding after local account commit fails", async () => {
  const f = fixture();
  f.connectAccount.mockRejectedValue(new Error("commit failed"));
  await expect(connectExistingChrome(f.input)).rejects.toThrow("commit failed");
  expect(f.bindings.set).toHaveBeenLastCalledWith("account", undefined);
  expect(f.close).toHaveBeenCalledOnce();
});

it("rejects a disconnect during identity navigation before connection commit", async () => {
  const f = fixture();
  f.page.goto.mockImplementation(async () => {
    vi.mocked(f.service.connectionReviewEpoch).mockResolvedValue("revoked");
  });
  await expect(connectExistingChrome(f.input)).rejects.toThrow("cancelled");
  expect(f.connectAccount).not.toHaveBeenCalled();
  expect(f.bindings.set).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});

it("does not restore a revoked binding when cancellation arrives during binding persistence", async () => {
  const f = fixture();
  f.bindings.set.mockImplementationOnce(async () => {
    vi.mocked(f.service.connectionReviewEpoch).mockResolvedValue("revoked");
  });
  await expect(connectExistingChrome(f.input)).rejects.toThrow("cancelled");
  expect(f.connectAccount).not.toHaveBeenCalled();
  expect(f.bindings.set).toHaveBeenLastCalledWith("account", undefined);
});
